import fs from "node:fs"
import fsPromises from "node:fs/promises"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  listAgentToolCalls,
  recordAgentToolCall
} from "@/main/agents/agent-event-store"
import {
  appendAgentSessionModelMessageEvents,
  appendAgentSessionQueuedSteeringEvent
} from "@/main/agents/agent-session-events"

import { createAgentRuntimeHarness } from "./agent-runtime-harness"
import {
  createFauxGenerateTextResponse,
  createFauxTextResponse
} from "./faux-provider"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-approval-execution-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

const findRequiredModelMessage = ({
  messages,
  role
}: {
  messages: ModelMessage[]
  role: ModelMessage["role"]
}): ModelMessage => {
  const message = messages.find((candidate) => candidate.role === role)

  if (!message) {
    throw new Error(`Expected ${role} message.`)
  }

  return message
}

describe("agent approval execution", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("executes an approved local tool before continuing the model stream", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "approved",
        path: "approved.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })

    harness.faux.setResponses([
      createFauxTextResponse("done", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approval.toModelMessages({
        approved: true
      })
    })

    await result.consumeStream()

    const written = await fsPromises.readFile(
      path.join(harness.projectPath, "approved.txt"),
      "utf-8"
    )
    const [modelCall] = harness.faux.model.doStreamCalls
    const toolCalls = await listAgentToolCalls({
      db: harness.db,
      runId: approval.run.id
    })

    expect(written).toBe("approved")
    expect(modelCall?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: [
            expect.objectContaining({
              toolCallId: "tool-call-1",
              toolName: "write",
              type: "tool-result"
            })
          ],
          role: "tool"
        })
      ])
    )
    expect(toolCalls).toMatchObject([
      {
        approvalState: "approved",
        id: "tool-call-1",
        state: "finished",
        toolName: "write"
      }
    ])
  })

  it("turns approved tool execution failures into provider-visible tool results", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const targetPath = path.join(harness.projectPath, "existing.txt")

    await fsPromises.writeFile(targetPath, "current", "utf-8")

    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        edits: [
          {
            newText: "next",
            oldText: "missing"
          }
        ],
        path: "existing.txt"
      },
      profileId: "coder",
      toolCallId: "edit:18",
      toolName: "edit"
    })

    harness.faux.setResponses([
      createFauxTextResponse("handled failed edit", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approval.toModelMessages({
        approved: true
      })
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(promptJson).toContain("edit:18")
    expect(promptJson).toContain("Expected exactly one match")
    expect(promptJson).not.toContain("tool-approval-response")
  })

  it("keeps split approval resume messages provider-contiguous", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "approved",
        path: "approved.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })
    const [assistantMessage, responseMessage] = approval.toModelMessages({
      approved: true
    })
    const assistantParts = Array.isArray(assistantMessage?.content)
      ? assistantMessage.content
      : []
    const splitMessages = [
      {
        content: assistantParts.filter(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            part.type === "tool-call"
        ),
        role: "assistant"
      },
      {
        content: assistantParts.filter(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            part.type === "tool-approval-request"
        ),
        role: "assistant"
      },
      responseMessage
    ] satisfies ModelMessage[]

    harness.faux.setResponses([
      createFauxTextResponse("resumed split approval", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: splitMessages
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls
    const prompt = modelCall?.prompt ?? []
    const promptJson = JSON.stringify(prompt)
    const toolCallIndex = prompt.findIndex(
      (message) =>
        message.role === "assistant" &&
        JSON.stringify(message).includes("tool-call-1")
    )
    const toolResultIndex = prompt.findIndex(
      (message) =>
        message.role === "tool" &&
        JSON.stringify(message).includes("tool-call-1")
    )

    expect(promptJson).not.toContain(
      "Tool execution did not complete before the next user message."
    )
    expect(promptJson).not.toContain("tool-approval-request")
    expect(promptJson).not.toContain("tool-approval-response")
    expect(toolCallIndex).toBeGreaterThan(-1)
    expect(toolResultIndex).toBe(toolCallIndex + 1)
  })

  it("adds a model-visible tool error when approval is denied", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "denied",
        path: "denied.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })

    harness.faux.setResponses([
      createFauxTextResponse("recovered", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approval.toModelMessages({
        approved: false,
        reason: "Denied in chat UI."
      })
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls
    const toolCalls = await listAgentToolCalls({
      db: harness.db,
      runId: approval.run.id
    })
    const events = await harness.session.listEvents()

    await expect(
      fsPromises.readFile(path.join(harness.projectPath, "denied.txt"), "utf-8")
    ).rejects.toThrow()
    expect(modelCall?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: [
            expect.objectContaining({
              output: {
                reason: "Denied in chat UI.",
                type: "execution-denied"
              },
              toolCallId: "tool-call-1",
              toolName: "write",
              type: "tool-result"
            })
          ],
          role: "tool"
        })
      ])
    )
    expect(toolCalls).toMatchObject([
      {
        approvalState: "denied",
        errorMessage: "Denied in chat UI.",
        id: "tool-call-1",
        state: "failed",
        toolName: "write"
      }
    ])
    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        id: approval.run.id,
        status: "succeeded"
      })
    ])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            approvalId: "approval-1",
            approved: false,
            reason: "Denied in chat UI.",
            toolCallId: "tool-call-1"
          }),
          type: "tool_call_denied"
        })
      ])
    )
  })

  it("rebuilds resumed provider context from persisted session events", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "approved",
        path: "approved.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })
    const approvalMessages = approval.toModelMessages({
      approved: true
    })
    const approvalRequestMessage = findRequiredModelMessage({
      messages: approvalMessages,
      role: "assistant"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Persisted user request.",
          role: "user"
        },
        approvalRequestMessage
      ],
      run: approval.run
    })
    harness.faux.setResponses([
      createFauxTextResponse("resumed", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approvalMessages
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls
    const prompt = modelCall?.prompt ?? []
    const persistedUserIndex = prompt.findIndex(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message).includes("Persisted user request.")
    )
    const approvalResultIndex = prompt.findIndex(
      (message) =>
        message.role === "tool" &&
        JSON.stringify(message).includes("tool-call-1")
    )

    expect(persistedUserIndex).toBeGreaterThan(-1)
    expect(approvalResultIndex).toBeGreaterThan(persistedUserIndex)
    expect(prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant"
        }),
        expect.objectContaining({
          content: [
            expect.objectContaining({
              toolCallId: "tool-call-1",
              toolName: "write",
              type: "tool-result"
            })
          ],
          role: "tool"
        })
      ])
    )
  })

  it("replays pending queued session messages when resuming a run", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "queued",
        path: "queued.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })
    const approvalMessages = approval.toModelMessages({
      approved: false,
      reason: "No write."
    })
    const approvalRequestMessage = findRequiredModelMessage({
      messages: approvalMessages,
      role: "assistant"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Persisted user request.",
          role: "user"
        },
        approvalRequestMessage
      ],
      run: approval.run
    })
    await appendAgentSessionQueuedSteeringEvent({
      message: "Recovered steering.",
      run: approval.run
    })
    harness.faux.setResponses([
      createFauxTextResponse("queued replayed", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approvalMessages
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls
    const queuedMessage = modelCall?.prompt?.at(-1)

    expect(queuedMessage).toEqual(expect.objectContaining({ role: "user" }))
    expect(JSON.stringify(queuedMessage)).toContain("Recovered steering.")
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: "Recovered steering.",
          role: "user",
          type: "model"
        }
      ])
    )
  })

  it("appends only missing session context when resuming a suspended run", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const userMessage = {
      content: "Please update the file.",
      role: "user"
    } satisfies ModelMessage
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "approved",
        path: "approved.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })
    const approvalMessages = approval.toModelMessages({
      approved: true
    })
    const approvalRequestMessage = findRequiredModelMessage({
      messages: approvalMessages,
      role: "assistant"
    })
    const approvalResponseMessage = findRequiredModelMessage({
      messages: approvalMessages,
      role: "tool"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [userMessage],
      run: approval.run
    })
    harness.faux.setResponses([
      createFauxTextResponse("missing context appended", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: [userMessage, ...approvalMessages]
    })

    await result.consumeStream()

    const modelMessages = await harness.session.listModelMessages()
    const persistedUserMessages = modelMessages.filter(
      (message) =>
        message.content === "Please update the file." && message.role === "user"
    )

    expect(persistedUserMessages).toHaveLength(1)
    expect(modelMessages).toEqual(
      expect.arrayContaining([
        {
          ...approvalRequestMessage,
          type: "model"
        },
        {
          ...approvalResponseMessage,
          type: "model"
        }
      ])
    )
  })

  it("keeps a resumed run suspended while another approval is still pending", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "current-approval",
      input: {
        content: "current",
        path: "current.txt"
      },
      profileId: "coder",
      toolCallId: "current-tool-call",
      toolName: "write"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: harness.db,
      id: "other-tool-call",
      input: {
        command: "vp install"
      },
      runId: approval.run.id,
      state: "approval_requested",
      toolName: "bash"
    })
    await approval.run.appendEvent({
      payload: {
        approvalId: "other-approval",
        toolCallId: "other-tool-call"
      },
      type: "tool_call_approval_requested"
    })
    harness.faux.setResponses([
      createFauxTextResponse("current handled", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approval.toModelMessages({
        approved: false,
        reason: "Leave the other approval pending."
      })
    })

    await result.consumeStream()

    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        id: approval.run.id,
        status: "suspended"
      })
    ])
    expect(await harness.session.listPendingApprovals()).toEqual([
      expect.objectContaining({
        approvalId: "other-approval",
        id: "other-tool-call",
        runId: approval.run.id,
        state: "approval_requested"
      })
    ])
  })

  it("ignores approval responses owned by another chat session", async () => {
    const ownerHarness = await createAgentRuntimeHarness({
      modelId: "owner-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const otherHarness = await createAgentRuntimeHarness({
      modelId: "other-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const ownerApproval = await ownerHarness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "owner only",
        path: "owner-only.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })

    otherHarness.faux.setResponses([
      createFauxTextResponse("not resumed", {
        modelId: otherHarness.modelId
      })
    ])

    const result = await otherHarness.stream({
      messages: ownerApproval.toModelMessages({
        approved: true
      })
    })

    await result.consumeStream()

    expect(otherHarness.faux.model.doStreamCalls).toEqual([])
    expect(await ownerHarness.session.listPendingApprovals()).toEqual([
      expect.objectContaining({
        approvalId: "approval-1",
        id: "tool-call-1",
        runId: ownerApproval.run.id
      })
    ])
  })

  it("resumes only approval responses that still match a pending run", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "current-approval",
      input: {
        content: "current",
        path: "current.txt"
      },
      profileId: "coder",
      toolCallId: "current-tool-call",
      toolName: "write"
    })

    harness.faux.setResponses([
      createFauxTextResponse("resumed current approval", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: [
            {
              input: {
                content: "old",
                path: "old.txt"
              },
              toolCallId: "old-tool-call",
              toolName: "write",
              type: "tool-call"
            },
            {
              approvalId: "old-approval",
              toolCallId: "old-tool-call",
              type: "tool-approval-request"
            },
            {
              input: {
                content: "current",
                path: "current.txt"
              },
              toolCallId: "current-tool-call",
              toolName: "write",
              type: "tool-call"
            },
            {
              approvalId: "current-approval",
              toolCallId: "current-tool-call",
              type: "tool-approval-request"
            }
          ],
          role: "assistant"
        },
        {
          content: [
            {
              approvalId: "old-approval",
              approved: true,
              type: "tool-approval-response"
            },
            {
              approvalId: "current-approval",
              approved: false,
              reason: "Current only.",
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(promptJson).toContain("current-tool-call")
    expect(promptJson).toContain("Current only.")
    expect(promptJson).not.toContain("old-tool-call")
    expect(promptJson).not.toContain("old-approval")
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        approvalState: "denied",
        errorMessage: "Current only.",
        id: "current-tool-call",
        runId: approval.run.id,
        state: "failed",
        toolName: "write"
      })
    ])
  })

  it("completes unresolved prior tool calls with a normal follow-up", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("continued", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Inspect files first.",
          role: "user"
        },
        {
          content: [
            {
              input: {
                path: "src/value.ts"
              },
              toolCallId: "readFile:18",
              toolName: "readFile",
              type: "tool-call"
            },
            {
              input: {
                edits: [],
                path: "src/value.ts"
              },
              toolCallId: "editFile:18",
              toolName: "editFile",
              type: "tool-call"
            },
            {
              approvalId: "approval-18",
              toolCallId: "editFile:18",
              type: "tool-approval-request"
            }
          ],
          role: "assistant"
        },
        {
          content: "Continue without approving that tool batch.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    const errors: unknown[] = []

    await result.consumeStream({
      onError: (error) => {
        errors.push(error)
      }
    })

    const [modelCall] = harness.faux.model.doStreamCalls
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(errors).toEqual([])
    expect(promptJson).toContain("Continue without approving")
    expect(promptJson).toContain("editFile:18")
    expect(promptJson).toContain("readFile:18")
    expect(promptJson).toContain("Tool execution did not complete")
  })

  it("resumes with the suspended run profile tool scope", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "general-purpose",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "scoped",
        path: "scoped.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })

    harness.faux.setResponses([
      createFauxTextResponse("scoped", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approval.toModelMessages({
        approved: false,
        reason: "Scope test."
      })
    })

    await result.consumeStream()

    const [modelCall] = harness.faux.model.doStreamCalls

    expect(modelCall?.tools?.map((tool) => tool.name).toSorted()).toEqual([
      "bash",
      "delete",
      "edit",
      "find",
      "grep",
      "ls",
      "mkdir",
      "processOutput",
      "read",
      "requestAccess",
      "smartEdit",
      "stat",
      "stopProcess",
      "write"
    ])
  })

  it("restores coder tools for an approved plan execute handoff child run", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "general-purpose",
          enabled: true
        }
      })
    })
    const approval = await harness.session.suspendForToolApproval({
      approvalId: "coder-approval-1",
      input: {
        context: "Plan:\n1. Update tests\n2. Implement the change",
        expectedOutput: "A patch and validation summary.",
        task: "Execute the confirmed plan."
      },
      profileId: "plan",
      toolCallId: "coder-call-1",
      toolName: "agentCoder"
    })

    harness.faux.setGenerateResponses([
      createFauxGenerateTextResponse("Coder child summary.", {
        modelId: harness.modelId
      })
    ])
    harness.faux.setResponses([
      createFauxTextResponse("Parent resumed after handoff.", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: approval.toModelMessages({
        approved: true
      })
    })

    await result.consumeStream()

    const runs = await harness.session.listRuns()
    const childRun = runs.find((run) => run.profileId === "coder")
    const childGenerateCall = harness.faux.model.doGenerateCalls.at(-1)
    const childPromptJson = JSON.stringify(childGenerateCall?.prompt)

    expect(runs).toEqual([
      expect.objectContaining({
        id: approval.run.id,
        parentRunId: null,
        profileId: "plan",
        status: "succeeded"
      }),
      expect.objectContaining({
        parentRunId: approval.run.id,
        profileId: "coder",
        status: "succeeded"
      })
    ])
    expect(
      childGenerateCall?.tools?.map((tool) => tool.name).toSorted()
    ).toEqual([
      "bash",
      "delete",
      "edit",
      "find",
      "grep",
      "ls",
      "mkdir",
      "processOutput",
      "read",
      "requestAccess",
      "smartEdit",
      "stat",
      "stopProcess",
      "write"
    ])
    expect(childPromptJson).toContain("Execute the confirmed plan.")
    expect(childPromptJson).toContain("Plan:\\n1. Update tests")
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        approvalState: "approved",
        id: "coder-call-1",
        output: expect.objectContaining({
          profileId: "coder",
          subRunId: childRun?.id,
          summary: "Coder child summary."
        }),
        runId: approval.run.id,
        state: "finished",
        toolName: "agentCoder"
      })
    ])
  })
})
