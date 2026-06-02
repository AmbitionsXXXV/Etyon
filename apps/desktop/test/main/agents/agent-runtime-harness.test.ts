import fs from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult
} from "@ai-sdk/provider"
import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"
import * as z from "zod"

import { stopActiveAgentRun } from "@/main/agents/active-agent-runs"
import { readAgentArtifactTextContent } from "@/main/agents/agent-artifacts"
import {
  createAgentRun,
  getAgentRun,
  listAgentArtifacts,
  updateAgentRun
} from "@/main/agents/agent-event-store"
import { createAgentExtensionRunner } from "@/main/agents/agent-extensions"
import type { AgentExtensionLifecycleEvent } from "@/main/agents/agent-extensions"
import {
  appendAgentSessionQueuedFollowUpEvent,
  appendAgentSessionQueuedSteeringEvent
} from "@/main/agents/agent-session-events"
import { createAgentRuntimeState } from "@/main/agents/agent-state"
import type { AgentStreamHooks } from "@/main/agents/agent-stream-hooks"

import {
  collectUiStream,
  createAgentRuntimeHarness,
  createTempWorkspace,
  expectEventSequence
} from "./agent-runtime-harness"
import {
  createFauxGenerateTextResponse,
  createFauxGenerateToolCallResponse,
  createFauxProviderToolResultResponse,
  createFauxTextResponse,
  createFauxToolCallResponse,
  createFauxToolInputDeltaResponse
} from "./faux-provider"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-runtime-harness-test-${Date.now()}-${Math.random()
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

const beforeExploreProviderPayloadHook: NonNullable<
  AgentStreamHooks["beforeProviderPayload"]
> = ({ payload }) =>
  payload.profileId === "explore"
    ? {
        messages: [
          {
            content: "hooked child task",
            role: "user"
          }
        ],
        system: "Hooked child system"
      }
    : undefined

const beforeExploreProviderRequestHook: NonNullable<
  AgentStreamHooks["beforeProviderRequest"]
> = ({ payload }) =>
  payload.profileId === "explore"
    ? {
        headers: {
          "x-child-run": "patched"
        },
        metadata: {
          source: "child-hook"
        }
      }
    : undefined

const waitForCondition = async (
  predicate: () => boolean | Promise<boolean>
): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return
    }

    await delay(5)
  }

  throw new Error("Timed out waiting for condition.")
}

const createControlledTextStreamResponse = (): {
  close: () => void
  response: LanguageModelV3StreamResult
} => {
  let closed = false
  let controllerRef:
    | ReadableStreamDefaultController<LanguageModelV3StreamPart>
    | undefined

  return {
    close: () => {
      if (!controllerRef || closed) {
        return
      }

      closed = true
      controllerRef.enqueue({
        id: "controlled-response-text",
        type: "text-end"
      })
      controllerRef.enqueue({
        finishReason: {
          raw: "stop",
          unified: "stop"
        },
        type: "finish",
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined,
            total: 0
          },
          outputTokens: {
            reasoning: undefined,
            text: 0,
            total: 0
          }
        }
      })
      controllerRef.close()
    },
    response: {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        cancel: () => {
          closed = true
        },
        start: (controller) => {
          controllerRef = controller
          controller.enqueue({
            type: "stream-start",
            warnings: []
          })
          controller.enqueue({
            id: "controlled-response",
            modelId: "mock-model",
            timestamp: new Date("2026-05-24T00:00:00.000Z"),
            type: "response-metadata"
          })
          controller.enqueue({
            id: "controlled-response-text",
            type: "text-start"
          })
          controller.enqueue({
            delta: "partial",
            id: "controlled-response-text",
            type: "text-delta"
          })
        }
      })
    } satisfies LanguageModelV3StreamResult
  }
}

describe("agent runtime harness", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("creates an isolated temp workspace fixture", async () => {
    const workspace = await createTempWorkspace({
      files: {
        "src/example.ts": "export const value = 1\n"
      }
    })

    try {
      expect(workspace.projectPath).toContain(workspace.rootPath)
      expect(fs.readFileSync(workspace.path("src/example.ts"), "utf-8")).toBe(
        "export const value = 1\n"
      )

      const writtenPath = await workspace.writeFile(
        "nested/output.txt",
        "ready"
      )

      expect(writtenPath).toBe(workspace.path("nested/output.txt"))
      expect(fs.readFileSync(writtenPath, "utf-8")).toBe("ready")
    } finally {
      await workspace.cleanup()
    }

    expect(fs.existsSync(workspace.rootPath)).toBe(false)
  })

  it("creates a project session and streams through the faux provider", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("hello", {
        modelId: "mock-model"
      })
    ])
    const liveEventTypes: string[] = []
    const unsubscribe = harness.session.subscribe((event) => {
      liveEventTypes.push(event.type)
    })

    const result = await harness.stream({
      messages: [
        {
          content: "Say hello.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    try {
      await result.consumeStream()
    } finally {
      unsubscribe()
    }

    expect(harness.session.projectPath).toBe(harness.projectPath)
    expect(harness.faux.model.doStreamCalls).toHaveLength(1)
    expect(harness.faux.model.doStreamCalls[0]?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user"
        })
      ])
    )

    const events = await harness.session.listEvents()

    expect(() =>
      expectEventSequence(
        events,
        [
          "agent_run_started",
          "agent_session_entry_appended",
          "agent_session_save_point_created",
          "agent_session_runtime_started",
          "agent_loop_event",
          "agent_session_entry_appended",
          "agent_session_save_point_created",
          "agent_run_finished"
        ],
        {
          mode: "containsInOrder"
        }
      )
    ).not.toThrow()
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_loop_event",
        "agent_run_started",
        "agent_run_finished"
      ])
    )
    expect(liveEventTypes).toEqual(
      expect.arrayContaining(["agent_run_started", "agent_run_finished"])
    )
  })

  it("writes agent provider text deltas to the UI stream before finish", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("streamed", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Stream this.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })
    const chunks = await collectUiStream(result.toUIMessageStream())
    const textDeltaIndex = chunks.findIndex(
      (chunk) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "text-delta"
    )
    const finishIndex = chunks.findIndex(
      (chunk) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "finish"
    )

    expect(textDeltaIndex).toBeGreaterThan(-1)
    expect(finishIndex).toBeGreaterThan(textDeltaIndex)
    expect(JSON.stringify(chunks[textDeltaIndex])).toContain("streamed")
  })

  it("streams without agent runs when agents are disabled", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({})
    })
    const abortController = new AbortController()

    harness.faux.setResponses([
      createFauxTextResponse("plain", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      abortSignal: abortController.signal,
      messages: [
        {
          content: "Plain chat.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      systemPrompts: ["base system"]
    })

    await result.consumeStream()

    expect(await harness.session.listRuns()).toEqual([])
    expect(await harness.session.listEvents()).toEqual([])
    expect(harness.faux.listLastStreamToolNames()).toEqual([])
    expect(harness.faux.model.doStreamCalls.at(-1)?.abortSignal).toBe(
      abortController.signal
    )
  })

  it("creates an agent run and streams with default profile tools when agents are enabled", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true,
          maxSteps: 5
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("profile", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Use default tools.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      systemPrompts: ["base system"]
    })

    await result.consumeStream()

    const runs = await harness.session.listRuns()
    const events = await harness.session.listEvents()

    expect(runs).toMatchObject([
      {
        chatSessionId: harness.session.id,
        modelId: "mock-model",
        profileId: "general-purpose",
        status: "succeeded"
      }
    ])
    expect(harness.faux.listLastStreamToolNames().toSorted()).toEqual([
      "find",
      "grep",
      "ls",
      "read",
      "stat"
    ])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            profileId: "general-purpose",
            source: "chat",
            toolNames: ["read", "grep", "find", "ls", "stat"]
          }),
          type: "agent_run_started"
        })
      ])
    )
  })

  it("records session runtime lifecycle events for chat session rebuilds", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true,
          maxSteps: 5
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("first", {
        modelId: "mock-model"
      }),
      createFauxTextResponse("forked", {
        modelId: "mock-model"
      })
    ])

    const firstResult = await harness.stream({
      messages: [
        {
          content: "Start a runtime session.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await firstResult.consumeStream()

    const forkResult = await harness.stream({
      chatLifecycleBranch: {
        branchKind: "regenerate",
        messageId: "assistant-1",
        retainedMessageIds: ["user-1"],
        trigger: "regenerate-message"
      },
      messages: [
        {
          content: "Fork the current runtime session.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await forkResult.consumeStream()

    const events = await harness.session.listEvents()
    const runtimeEvents = events.filter((event) =>
      event.type.startsWith("agent_session_runtime_")
    )

    expect(() =>
      expectEventSequence(runtimeEvents, [
        "agent_session_runtime_starting",
        "agent_session_runtime_started",
        "agent_session_runtime_disposing",
        "agent_session_runtime_disposed",
        "agent_session_runtime_starting",
        "agent_session_runtime_started"
      ])
    ).not.toThrow()
    expect(runtimeEvents.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        generation: 1,
        mode: "new",
        projectPath: harness.projectPath,
        sessionId: harness.session.id
      }),
      expect.objectContaining({
        generation: 1,
        mode: "new",
        projectPath: harness.projectPath,
        sessionId: harness.session.id
      }),
      expect.objectContaining({
        generation: 1,
        mode: "new",
        projectPath: harness.projectPath,
        sessionId: harness.session.id
      }),
      expect.objectContaining({
        generation: 1,
        mode: "new",
        projectPath: harness.projectPath,
        sessionId: harness.session.id
      }),
      expect.objectContaining({
        generation: 2,
        mode: "fork",
        projectPath: harness.projectPath,
        sessionId: harness.session.id
      }),
      expect.objectContaining({
        generation: 2,
        mode: "fork",
        projectPath: harness.projectPath,
        sessionId: harness.session.id
      })
    ])
  })

  it("keeps agent runs detached from chat request aborts", async () => {
    const abortController = new AbortController()
    const controlledStream = createControlledTextStreamResponse()
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true,
          maxSteps: 5
        }
      })
    })

    harness.faux.setResponses([controlledStream.response])

    const result = await harness.stream({
      abortSignal: abortController.signal,
      messages: [
        {
          content: "Keep running after the HTTP stream disconnects.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await waitForCondition(() => harness.faux.model.doStreamCalls.length === 1)

    const streamCall = harness.faux.model.doStreamCalls.at(-1)

    expect(streamCall?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(streamCall?.abortSignal).not.toBe(abortController.signal)

    await waitForCondition(async () => {
      const events = await harness.session.listEvents()

      return events.some(
        (event) => event.type === "agent_ui_stream_snapshot_created"
      )
    })

    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            parts: [
              {
                text: "partial",
                type: "text"
              }
            ]
          }),
          type: "agent_ui_stream_snapshot_created"
        })
      ])
    )

    abortController.abort()

    await waitForCondition(async () => {
      const events = await harness.session.listEvents()

      return events.some((event) => event.type === "agent_stream_disconnected")
    })

    expect(streamCall?.abortSignal?.aborted).toBe(false)
    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        status: "running"
      })
    ])
    expect(stopActiveAgentRun(harness.session.id)).toBe(true)
    controlledStream.close()

    await result.consumeStream()

    expect(streamCall?.abortSignal?.aborted).toBe(true)
    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        errorMessage: "Agent run was stopped.",
        status: "failed"
      })
    ])
  })

  it("passes Etyon code tool definitions and guidelines to the provider", async () => {
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
      createFauxTextResponse("coded", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Inspect and edit.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const promptJson = JSON.stringify(
      harness.faux.model.doStreamCalls[0]?.prompt
    )

    expect(promptJson).toContain("Active agent profile: coder.")
    expect(promptJson).toContain("Available tools:")
    expect(promptJson).toContain("read: Read file contents")
    expect(promptJson).toContain("bash: Execute bash commands")
    expect(promptJson).toContain(
      "edit: Make surgical edits to files with exact replacements"
    )
    expect(promptJson).toContain("write: Create or overwrite files")
    expect(promptJson).toContain(
      "Prefer grep/find/ls tools over bash for file exploration."
    )
    expect(promptJson).toContain("Use read to examine files before editing.")
  })

  it("bounds provider turns with the configured agent step budget", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true,
          maxSteps: 1
        }
      })
    })

    fs.writeFileSync(
      `${harness.projectPath}/package.json`,
      '{ "name": "@etyon/desktop" }'
    )
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "package.json"
        },
        modelId: "mock-model",
        toolCallId: "tool-call-1",
        toolName: "read"
      }),
      createFauxTextResponse("This response must stay queued.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Read package metadata.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(harness.faux.model.doStreamCalls).toHaveLength(1)
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        id: "tool-call-1",
        state: "finished",
        toolName: "read"
      })
    ])
  })

  it("prepares the main provider request through turn state stream hooks", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const streamHooks: AgentStreamHooks = {
      beforeProviderPayload: () => ({
        messages: [
          {
            content: "hooked user",
            role: "user"
          }
        ],
        system: "Hooked system"
      }),
      beforeProviderRequest: () => ({
        headers: {
          "x-agent-run": "patched"
        },
        metadata: {
          source: "hook"
        }
      })
    }

    harness.faux.setResponses([
      createFauxTextResponse("hooked", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "original user",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks,
      streamOptions: {
        headers: {
          "x-base": "1"
        },
        metadata: {
          source: "chat"
        }
      },
      systemPrompts: ["base system"]
    })

    await result.consumeStream()

    const modelCall = harness.faux.model.doStreamCalls.at(-1)
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(modelCall?.headers).toEqual({
      "x-agent-run": "patched",
      "x-base": "1"
    })
    expect(promptJson).toContain("Hooked system")
    expect(promptJson).toContain("hooked user")
    expect(promptJson).not.toContain("original user")
  })

  it("persists prepared model messages as session tree events before streaming", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("Prepared response.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Inspect the changed files.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks: {
        beforeProviderPayload: () => ({
          messages: [
            {
              content: "Hooked model context.",
              role: "user"
            }
          ]
        })
      }
    })

    await result.consumeStream()

    expect(await harness.session.listModelMessages()).toEqual([
      {
        content: "Hooked model context.",
        role: "user",
        type: "model"
      },
      {
        content: [
          {
            text: "Prepared response.",
            type: "text"
          }
        ],
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("persists chat branch lifecycle events before streaming", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("Regenerated response.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      chatLifecycleBranch: {
        branchKind: "regenerate",
        messageId: "assistant-1",
        retainedMessageIds: ["user-1"],
        trigger: "regenerate-message"
      },
      messages: [
        {
          content: "Regenerate the last answer.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            action: "appendCustomMessage",
            message: {
              data: {
                branchKind: "regenerate",
                messageId: "assistant-1",
                retainedMessageCount: 1,
                retainedMessageIds: ["user-1"],
                trigger: "regenerate-message"
              },
              type: "chat-branch"
            }
          },
          type: "agent_session_entry_appended"
        })
      ])
    )
  })

  it("drains queued messages from the latest completed run into the next request", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const previousRun = await createAgentRun({
      chatSessionId: harness.session.id,
      db: harness.db,
      modelId: harness.modelId,
      profileId: "general-purpose"
    })

    await appendAgentSessionQueuedFollowUpEvent({
      message: "Continue with the queued follow-up.",
      run: previousRun
    })
    await updateAgentRun({
      db: harness.db,
      id: previousRun.id,
      status: "succeeded"
    })
    harness.faux.setResponses([
      createFauxTextResponse("Follow-up consumed.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Start the next request.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const modelCall = harness.faux.model.doStreamCalls.at(-1)
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(promptJson).toContain("Continue with the queued follow-up.")
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: "Continue with the queued follow-up.",
          role: "user",
          type: "model"
        }
      ])
    )
  })

  it("drains queued follow-up messages appended during the active run", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    let queued = false

    harness.faux.setResponses([
      createFauxTextResponse("Initial answer.", {
        modelId: "mock-model"
      }),
      createFauxTextResponse("Follow-up answer.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Start the active run.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks: {
        beforeProviderRequest: async ({ payload }) => {
          if (queued) {
            return
          }

          queued = true

          const runId = typeof payload.runId === "string" ? payload.runId : null

          if (!runId) {
            throw new Error("Expected runId in provider payload.")
          }

          const run = await getAgentRun({
            chatSessionId: harness.session.id,
            db: harness.db,
            runId
          })

          if (!run) {
            throw new Error("Expected active agent run.")
          }

          await appendAgentSessionQueuedFollowUpEvent({
            message: "Continue with the active follow-up.",
            run
          })
        }
      }
    })

    await result.consumeStream()

    const events = await harness.session.listEvents()
    const promptJson = JSON.stringify(
      harness.faux.model.doStreamCalls[1]?.prompt
    )

    expect(harness.faux.model.doStreamCalls).toHaveLength(2)
    expect(promptJson).toContain("Continue with the active follow-up.")
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: "Continue with the active follow-up.",
          role: "user",
          type: "model"
        }
      ])
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            event: expect.objectContaining({
              type: "follow_up_message_appended"
            })
          },
          type: "agent_loop_event"
        })
      ])
    )
  })

  it("drains queued steering messages after active run tool batches", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    let queued = false

    fs.writeFileSync(
      `${harness.projectPath}/package.json`,
      '{ "name": "@etyon/desktop" }'
    )
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "package.json"
        },
        modelId: "mock-model",
        toolCallId: "tool-call-steer",
        toolName: "read"
      }),
      createFauxTextResponse("Steered answer.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Read package metadata.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks: {
        beforeProviderRequest: async ({ payload }) => {
          if (queued) {
            return
          }

          queued = true

          const runId = typeof payload.runId === "string" ? payload.runId : null

          if (!runId) {
            throw new Error("Expected runId in provider payload.")
          }

          const run = await getAgentRun({
            chatSessionId: harness.session.id,
            db: harness.db,
            runId
          })

          if (!run) {
            throw new Error("Expected active agent run.")
          }

          await appendAgentSessionQueuedSteeringEvent({
            message: "Prefer the active steering note.",
            run
          })
        }
      }
    })

    await result.consumeStream()

    const events = await harness.session.listEvents()
    const promptJson = JSON.stringify(
      harness.faux.model.doStreamCalls[1]?.prompt
    )

    expect(harness.faux.model.doStreamCalls).toHaveLength(2)
    expect(promptJson).toContain("Prefer the active steering note.")
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: "Prefer the active steering note.",
          role: "user",
          type: "model"
        }
      ])
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            event: expect.objectContaining({
              type: "steering_message_appended"
            })
          },
          type: "agent_loop_event"
        })
      ])
    )
  })

  it("runs stream response hooks after finishing the main provider stream", async () => {
    const afterProviderResponseMock = vi.fn()
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("hooked response", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Finish the stream.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks: {
        afterProviderResponse: afterProviderResponseMock
      }
    })

    await result.consumeStream()

    expect(afterProviderResponseMock).toHaveBeenCalledWith({
      response: {
        finishReason: "stop",
        runId: expect.any(String),
        status: "succeeded",
        usage: expect.any(Object)
      }
    })
  })

  it("marks the run failed when a provider request hook fails before streaming", async () => {
    const hookError = new Error("hook exploded")
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    await expect(
      harness.stream({
        messages: [
          {
            content: "Trigger a hook failure.",
            role: "user"
          }
        ] satisfies ModelMessage[],
        streamHooks: {
          beforeProviderRequest: () => {
            throw hookError
          }
        }
      })
    ).rejects.toMatchObject({
      code: "hook",
      message: "Agent stream hook failed."
    })

    expect(harness.faux.model.doStreamCalls).toEqual([])
    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        errorMessage: "Agent stream hook failed.",
        status: "failed"
      })
    ])
    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            code: "hook",
            error: "Agent stream hook failed."
          },
          type: "agent_run_failed"
        })
      ])
    )
  })

  it("marks the run failed when the provider stream errors during consumption", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    const result = await harness.stream({
      messages: [
        {
          content: "Trigger provider failure.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        errorMessage: "Agent provider stream failed.",
        status: "failed"
      })
    ])
    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            code: "provider",
            error: "Agent provider stream failed."
          },
          type: "agent_run_failed"
        })
      ])
    )
  })

  it("tracks the main provider turn phase until the stream finishes", async () => {
    const runtimeState = createAgentRuntimeState()
    const phases: string[] = []
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    runtimeState.subscribe(({ phase }) => {
      phases.push(phase)
    })
    harness.faux.setResponses([
      createFauxTextResponse("stateful", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Track phase.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      runtimeState
    })

    expect(runtimeState.getSnapshot()).toEqual({
      phase: "turn"
    })

    await result.consumeStream()
    await runtimeState.waitForIdle()

    const events = await harness.session.listEvents()
    const snapshotEvents = events.filter(
      (event) => event.type === "agent_runtime_snapshot_created"
    )

    expect(runtimeState.getSnapshot()).toEqual({
      phase: "idle"
    })
    expect(phases).toEqual(["turn", "idle"])
    expect(snapshotEvents.map((event) => event.payload)).toEqual([
      {
        phase: "turn"
      },
      {
        phase: "idle"
      }
    ])
  })

  it("persists user and assistant model messages to the session event log", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("This project is an Electron desktop app.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Summarize the project.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listModelMessages()).toEqual([
      {
        content: "Summarize the project.",
        role: "user",
        type: "model"
      },
      {
        content: [
          {
            text: "This project is an Electron desktop app.",
            type: "text"
          }
        ],
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("persists plan progress markers from real plan profile responses", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "plan",
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse(
        "1. Inspect files. [DONE:1]\n2. Update tests. [DONE:2]",
        {
          modelId: "mock-model"
        }
      )
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Plan the implementation.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const events = await harness.session.listEvents()

    expect(await harness.session.listModelMessages()).toEqual([
      {
        content: "Plan the implementation.",
        role: "user",
        type: "model"
      },
      {
        content: [
          {
            text: "1. Inspect files.\n2. Update tests.",
            type: "text"
          }
        ],
        role: "assistant",
        type: "model"
      }
    ])
    expect(
      events.filter((event) => event.type === "plan_step_completed")
    ).toEqual([
      expect.objectContaining({
        payload: {
          mode: "plan",
          stepNumber: 1
        },
        type: "plan_step_completed"
      }),
      expect.objectContaining({
        payload: {
          mode: "plan",
          stepNumber: 2
        },
        type: "plan_step_completed"
      })
    ])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            action: "appendCustomMessage",
            message: {
              data: {
                completedStepNumbers: [1, 2],
                mode: "plan"
              },
              type: "plan-mode"
            }
          },
          type: "agent_session_entry_appended"
        })
      ])
    )
  })

  it("persists validated structured plans from real plan profile responses", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "plan",
          enabled: true
        }
      })
    })
    const structuredPlan = {
      items: [
        {
          action: "Inspect agent runtime entrypoints.",
          files: [
            "apps/desktop/src/main/agents/agent-runtime.ts",
            "doc/agents.md"
          ],
          riskLevel: "medium",
          stepNumber: 1
        }
      ]
    } as const

    harness.faux.setResponses([
      createFauxTextResponse(
        ["```json", JSON.stringify(structuredPlan), "```"].join("\n"),
        {
          modelId: "mock-model"
        }
      )
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Plan the implementation.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            plan: structuredPlan
          },
          type: "plan_validated"
        }),
        expect.objectContaining({
          payload: {
            action: "appendCustomMessage",
            message: {
              data: {
                completedStepNumbers: [],
                mode: "plan",
                structuredPlan
              },
              type: "plan-mode"
            }
          },
          type: "agent_session_entry_appended"
        })
      ])
    )
  })

  it("persists tool response model messages to the session event log", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    fs.writeFileSync(
      `${harness.projectPath}/package.json`,
      '{ "name": "@etyon/desktop" }'
    )

    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "package.json"
        },
        modelId: "mock-model",
        toolCallId: "tool-call-1",
        toolName: "read"
      }),
      createFauxTextResponse("Read package metadata.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Read package metadata.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: [
            expect.objectContaining({
              output: {
                type: "json",
                value: expect.objectContaining({
                  content: expect.arrayContaining([
                    {
                      text: '{ "name": "@etyon/desktop" }',
                      type: "text"
                    }
                  ]),
                  details: expect.objectContaining({
                    path: "package.json"
                  })
                })
              },
              toolCallId: "tool-call-1",
              toolName: "read",
              type: "tool-result"
            })
          ],
          role: "tool",
          type: "model"
        }
      ])
    )
  })

  it("records tool call lifecycle rows from the model stream", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    fs.mkdirSync(`${harness.projectPath}/src`, { recursive: true })
    fs.writeFileSync(
      `${harness.projectPath}/src/main.ts`,
      "export const value = 1"
    )

    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "src/main.ts"
        },
        modelId: "mock-model",
        toolCallId: "tool-call-1",
        toolName: "read"
      }),
      createFauxTextResponse("Read source file.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Read the source file.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        approvalState: "not_required",
        errorMessage: null,
        id: "tool-call-1",
        input: {
          path: "src/main.ts"
        },
        output: expect.objectContaining({
          content: expect.arrayContaining([
            {
              text: "export const value = 1",
              type: "text"
            }
          ]),
          details: expect.objectContaining({
            path: "src/main.ts"
          })
        }),
        state: "finished",
        toolName: "read"
      })
    ])
  })

  it("executes streamed tool input deltas through the main runtime loop", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    fs.mkdirSync(`${harness.projectPath}/src`, { recursive: true })
    fs.writeFileSync(
      `${harness.projectPath}/src/delta.ts`,
      "export const delta = 1"
    )
    harness.faux.setResponses([
      createFauxToolInputDeltaResponse({
        input: {
          path: "src/delta.ts"
        },
        inputChunks: ['{"path":', '"src/delta.ts"}'],
        modelId: "mock-model",
        toolCallId: "tool-call-delta-1",
        toolName: "read"
      }),
      createFauxTextResponse("Read delta source.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Read the delta source file.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    const chunks = await collectUiStream(result.toUIMessageStream())

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "tool-call-delta-1",
          toolName: "read",
          type: "tool-input-start"
        }),
        expect.objectContaining({
          inputTextDelta: '{"path":',
          toolCallId: "tool-call-delta-1",
          type: "tool-input-delta"
        }),
        expect.objectContaining({
          inputTextDelta: '"src/delta.ts"}',
          toolCallId: "tool-call-delta-1",
          type: "tool-input-delta"
        })
      ])
    )
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        approvalState: "not_required",
        id: "tool-call-delta-1",
        input: {
          path: "src/delta.ts"
        },
        state: "finished",
        toolName: "read"
      })
    ])
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: [
            expect.objectContaining({
              toolCallId: "tool-call-delta-1",
              toolName: "read",
              type: "tool-result"
            })
          ],
          role: "tool",
          type: "model"
        }
      ])
    )
  })

  it("records provider-completed tool results without local execution", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const providerOutput = {
      content: [
        {
          text: "provider supplied content",
          type: "text"
        }
      ],
      details: {
        path: "src/provider.ts"
      }
    }

    harness.faux.setResponses([
      createFauxProviderToolResultResponse({
        input: {
          path: "src/provider.ts"
        },
        modelId: "mock-model",
        output: providerOutput,
        toolCallId: "tool-call-provider-1",
        toolName: "read"
      }),
      createFauxTextResponse("Provider result was accepted.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Use the provider-completed read result.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })
    const chunks = await collectUiStream(result.toUIMessageStream())

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input: {
            path: "src/provider.ts"
          },
          toolCallId: "tool-call-provider-1",
          toolName: "read",
          type: "tool-input-available"
        }),
        expect.objectContaining({
          output: providerOutput,
          toolCallId: "tool-call-provider-1",
          type: "tool-output-available"
        })
      ])
    )
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        approvalState: "not_required",
        errorMessage: null,
        id: "tool-call-provider-1",
        input: {
          path: "src/provider.ts"
        },
        output: providerOutput,
        state: "finished",
        toolName: "read"
      })
    ])
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: [
            expect.objectContaining({
              input: {
                path: "src/provider.ts"
              },
              toolCallId: "tool-call-provider-1",
              toolName: "read",
              type: "tool-call"
            })
          ],
          role: "assistant",
          type: "model"
        },
        {
          content: [
            expect.objectContaining({
              toolCallId: "tool-call-provider-1",
              toolName: "read",
              type: "tool-result"
            })
          ],
          role: "tool",
          type: "model"
        }
      ])
    )
  })

  it("records invalid provider tool calls as model-visible tool errors", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: 123
        },
        modelId: "mock-model",
        toolCallId: "tool-call-invalid-provider-1",
        toolName: "read"
      }),
      createFauxTextResponse("Invalid provider tool call was handled.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Read with an invalid provider tool call.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })
    const chunks = await collectUiStream(result.toUIMessageStream())
    const toolOutputError = chunks.find(
      (chunk) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "tool-output-error" &&
        "toolCallId" in chunk &&
        chunk.toolCallId === "tool-call-invalid-provider-1"
    )
    const toolCalls = await harness.session.listToolCalls()
    const modelMessages = await harness.session.listModelMessages()
    const toolMessages = modelMessages.filter(
      (message) => message.role === "tool"
    )

    expect(toolOutputError).toEqual(
      expect.objectContaining({
        errorText: expect.any(String),
        toolCallId: "tool-call-invalid-provider-1",
        type: "tool-output-error"
      })
    )
    expect(toolCalls).toEqual([
      expect.objectContaining({
        errorMessage: expect.any(String),
        id: "tool-call-invalid-provider-1",
        state: "failed",
        toolName: "read"
      })
    ])
    expect(toolCalls[0]?.errorMessage).not.toBe("")
    expect(toolMessages).toEqual(
      expect.arrayContaining([
        {
          content: [
            expect.objectContaining({
              toolCallId: "tool-call-invalid-provider-1",
              toolName: "read",
              type: "tool-result"
            })
          ],
          role: "tool",
          type: "model"
        }
      ])
    )
  })

  it("records structured tool failures as typed runtime errors", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "src/missing.ts"
        },
        modelId: "mock-model",
        toolCallId: "tool-call-missing",
        toolName: "read"
      }),
      createFauxTextResponse("The file is missing.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Read a missing file.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        errorMessage: "The requested file path does not exist.",
        id: "tool-call-missing",
        state: "failed",
        toolName: "read"
      })
    ])

    const events = await harness.session.listEvents()
    const failedEvent = events.find(
      (event) => event.type === "tool_call_failed"
    )

    expect(failedEvent?.payload).toMatchObject({
      code: "tool",
      error: "The requested file path does not exist.",
      toolCallId: "tool-call-missing",
      toolName: "read"
    })
  })

  it("records approval requests emitted during a model step", async () => {
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
      createFauxToolCallResponse({
        input: {
          content: "export const value = 1\n",
          path: "src/generated.ts"
        },
        modelId: "mock-model",
        toolCallId: "tool-call-1",
        toolName: "write"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["write"],
      messages: [
        {
          content: "Write this file.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    expect(await harness.session.listRuns()).toEqual([
      expect.objectContaining({
        profileId: "coder",
        status: "suspended"
      })
    ])
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        approvalState: "pending",
        id: "tool-call-1",
        input: expect.objectContaining({
          path: "src/generated.ts"
        }),
        state: "approval_requested",
        toolName: "write"
      })
    ])
    expect(await harness.session.listPendingApprovals()).toEqual([
      expect.objectContaining({
        approvalId: expect.any(String),
        id: "tool-call-1",
        input: expect.objectContaining({
          path: "src/generated.ts"
        }),
        runStatus: "suspended",
        state: "approval_requested",
        toolName: "write"
      })
    ])
    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            approvalId: expect.any(String),
            input: expect.objectContaining({
              path: "src/generated.ts"
            }),
            toolCallId: "tool-call-1",
            toolName: "write"
          }),
          type: "tool_call_approval_requested"
        })
      ])
    )
  })

  it("filters runtime tools through active tool names", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("filtered", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      activeToolNames: ["read"],
      messages: [
        {
          content: "Read a file.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const events = await harness.session.listEvents()

    expect(harness.faux.listLastStreamToolNames()).toEqual(["read"])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            profileId: "general-purpose",
            source: "chat",
            toolNames: ["read"]
          }),
          type: "agent_run_started"
        })
      ])
    )
  })

  it("keeps profile tools while selected skill capabilities bind supplemental tools", async () => {
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
      createFauxTextResponse("filtered", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Write a file.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      skillCapabilities: ["write-fs"]
    })

    await result.consumeStream()

    const events = await harness.session.listEvents()

    expect(harness.faux.listLastStreamToolNames().toSorted()).toEqual([
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
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            profileId: "coder",
            source: "chat",
            toolNames: [
              "read",
              "grep",
              "find",
              "ls",
              "stat",
              "bash",
              "processOutput",
              "stopProcess",
              "mkdir",
              "delete",
              "edit",
              "smartEdit",
              "write",
              "requestAccess"
            ]
          }),
          type: "agent_run_started"
        })
      ])
    )
  })

  it("binds selected extension tools into the runtime tool loop", async () => {
    const extensionEvents: string[] = []
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "runtime-extension",
          register: (context) => {
            context.on("*", (event) => {
              extensionEvents.push(event.type)
            })
            context.registerTool({
              description: "Echo a message through an extension tool.",
              execute: ({ message }, executionContext) => ({
                message,
                projectPath: executionContext.projectPath
              }),
              inputSchema: z.object({
                message: z.string()
              }),
              name: "etyonEcho",
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.echo"],
              riskLevel: "safe"
            })
          }
        }
      ]
    })
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
      createFauxToolCallResponse({
        input: {
          message: "hello"
        },
        modelId: "mock-model",
        toolCallId: "extension-tool-1",
        toolName: "etyonEcho"
      }),
      createFauxTextResponse("extension done", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      extensionRunner,
      messages: [
        {
          content: "Use the selected extension.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      skillCapabilities: ["extension.echo"]
    })

    await result.consumeStream()

    const toolCalls = await harness.session.listToolCalls()

    expect(harness.faux.listLastStreamToolNames()).toContain("etyonEcho")
    expect(toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          output: expect.objectContaining({
            message: "hello",
            projectPath: harness.projectPath
          }),
          state: "finished",
          toolName: "etyonEcho"
        })
      ])
    )
    expect(extensionEvents).toEqual([
      "tool_registered",
      "tool_call_started",
      "tool_call_finished"
    ])
  })

  it("binds request-level tool packages into the runtime tool loop", async () => {
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "runtime-extension",
          register: (context) => {
            context.registerTool({
              description: "Existing extension tool.",
              execute: () => ({
                source: "extension"
              }),
              inputSchema: z.object({}),
              name: "etyonExtensionEcho",
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.echo"],
              riskLevel: "safe"
            })
          }
        }
      ]
    })
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
      createFauxToolCallResponse({
        input: {
          message: "from package"
        },
        modelId: "mock-model",
        toolCallId: "package-tool-1",
        toolName: "etyonPackageEcho"
      }),
      createFauxTextResponse("package done", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      extensionRunner,
      messages: [
        {
          content: "Use the package tool.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      skillCapabilities: ["extension.echo", "provider.tools"],
      toolPackages: [
        {
          id: "provider-tool-package",
          owner: "provider",
          tools: [
            {
              description: "Provider package echo.",
              execute: (input, executionContext) => {
                const { message } = input as { message: string }

                return {
                  message,
                  projectPath: executionContext.projectPath,
                  source: "package"
                }
              },
              inputSchema: z.object({
                message: z.string()
              }),
              name: "etyonPackageEcho",
              profiles: ["coder"],
              requiredSkillCapabilities: ["provider.tools"],
              riskLevel: "safe"
            }
          ]
        }
      ]
    })

    await result.consumeStream()

    expect(harness.faux.listLastStreamToolNames()).toEqual(
      expect.arrayContaining(["etyonExtensionEcho", "etyonPackageEcho"])
    )
    expect(await harness.session.listToolCalls()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          output: expect.objectContaining({
            message: "from package",
            projectPath: harness.projectPath,
            source: "package"
          }),
          state: "finished",
          toolName: "etyonPackageEcho"
        })
      ])
    )
  })

  it("records tool output references as durable artifact catalog entries", async () => {
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
    const fullOutput = "full output line 1\nfull output line 2\n"
    const artifactPath = `${harness.projectPath}/tool-output.txt`

    fs.writeFileSync(artifactPath, fullOutput)

    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {},
        modelId: "mock-model",
        toolCallId: "artifact-tool-1",
        toolName: "etyonArtifactOutput"
      }),
      createFauxTextResponse("artifact recorded", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Run the artifact-producing tool.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      skillCapabilities: ["extension.artifacts"],
      toolPackages: [
        {
          id: "artifact-tool-package",
          owner: "project",
          tools: [
            {
              description: "Return a preview with a full output reference.",
              execute: () => ({
                outputRef: {
                  byteLength: Buffer.byteLength(fullOutput),
                  kind: "command-output",
                  path: artifactPath
                },
                preview: "full output line 1",
                truncated: true
              }),
              inputSchema: z.object({}),
              name: "etyonArtifactOutput",
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.artifacts"],
              riskLevel: "safe"
            }
          ]
        }
      ]
    })
    const chunks = await collectUiStream(result.toUIMessageStream())
    const [run] = await harness.session.listRuns()

    if (!run) {
      throw new Error("Expected the artifact test to create an agent run.")
    }

    const artifacts = await listAgentArtifacts({
      db: harness.db,
      runId: run.id
    })
    const [artifact] = artifacts

    if (!artifact) {
      throw new Error("Expected the tool output reference to be cataloged.")
    }

    const events = await harness.session.listEvents()
    const finishedEvent = events.find(
      (event) => event.type === "tool_call_finished"
    )
    const artifactContent = await readAgentArtifactTextContent({
      artifact,
      maxChars: 18
    })

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          output: expect.objectContaining({
            outputRef: expect.objectContaining({
              path: artifactPath
            }),
            preview: "full output line 1",
            truncated: true
          }),
          toolCallId: "artifact-tool-1",
          type: "tool-output-available"
        })
      ])
    )
    expect(artifacts).toEqual([
      expect.objectContaining({
        byteLength: Buffer.byteLength(fullOutput),
        kind: "command-output",
        path: artifactPath,
        toolCallId: "artifact-tool-1"
      })
    ])
    expect(artifactContent).toEqual({
      content: "full output line 1",
      omittedChars: fullOutput.length - "full output line 1".length,
      totalChars: fullOutput.length,
      truncated: true
    })
    expect(finishedEvent).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          artifactIds: [artifact.id],
          output: expect.objectContaining({
            outputRef: expect.objectContaining({
              path: artifactPath
            })
          }),
          toolCallId: "artifact-tool-1",
          toolName: "etyonArtifactOutput"
        })
      })
    )
  })

  it("applies selected extension tool hooks inside the runtime tool loop", async () => {
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "runtime-tool-hook-extension",
          register: (context) => {
            context.registerToolHooks({
              afterToolCall: (result) => ({
                output: {
                  extensionPatched: true,
                  original: result.output
                }
              }),
              beforeToolCall: (toolCall) => {
                if (toolCall.toolName !== "read") {
                  return {}
                }

                return {
                  input: {
                    path: "rewritten.json"
                  }
                }
              },
              profiles: ["general-purpose"],
              requiredSkillCapabilities: ["extension.tool-hooks"]
            })
          }
        }
      ]
    })
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    fs.writeFileSync(
      `${harness.projectPath}/package.json`,
      '{ "name": "original" }'
    )
    fs.writeFileSync(
      `${harness.projectPath}/rewritten.json`,
      '{ "name": "rewritten" }'
    )
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "package.json"
        },
        modelId: "mock-model",
        toolCallId: "tool-hook-1",
        toolName: "read"
      }),
      createFauxTextResponse("hooked read done", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      extensionRunner,
      messages: [
        {
          content: "Read package metadata.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      skillCapabilities: ["extension.tool-hooks", "read-fs"]
    })

    await result.consumeStream()

    const toolCalls = await harness.session.listToolCalls()
    const modelMessages = await harness.session.listModelMessages()

    expect(toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool-hook-1",
          input: {
            path: "rewritten.json"
          },
          output: expect.objectContaining({
            extensionPatched: true,
            original: expect.objectContaining({
              content: expect.arrayContaining([
                {
                  text: '{ "name": "rewritten" }',
                  type: "text"
                }
              ])
            })
          }),
          state: "finished",
          toolName: "read"
        })
      ])
    )
    expect(modelMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: [
            expect.objectContaining({
              output: {
                type: "json",
                value: expect.objectContaining({
                  extensionPatched: true
                })
              },
              toolCallId: "tool-hook-1",
              toolName: "read",
              type: "tool-result"
            })
          ],
          role: "tool"
        })
      ])
    )
  })

  it("merges selected extension stream hooks into the runtime provider request", async () => {
    const extensionResponses: unknown[] = []
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "runtime-stream-extension",
          register: (context) => {
            context.registerStreamHooks({
              afterProviderResponse: ({ response }) => {
                extensionResponses.push(response)
              },
              beforeProviderPayload: ({ payload }) => ({
                system: `${String(payload.system)}\nExtension system`
              }),
              beforeProviderRequest: () => ({
                headers: {
                  "x-extension-hook": "enabled"
                },
                metadata: {
                  extensionHook: true
                }
              }),
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.stream"]
            })
          }
        }
      ]
    })
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
      createFauxTextResponse("extension hooked", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      extensionRunner,
      messages: [
        {
          content: "Use extension stream hooks.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      skillCapabilities: ["extension.stream"],
      streamHooks: {
        beforeProviderPayload: () => ({
          system: "Runtime system"
        }),
        beforeProviderRequest: () => ({
          headers: {
            "x-runtime-hook": "enabled"
          },
          metadata: {
            runtimeHook: true
          }
        })
      },
      streamOptions: {
        headers: {
          "x-base": "1"
        },
        metadata: {
          source: "chat"
        }
      }
    })

    await result.consumeStream()

    const modelCall = harness.faux.model.doStreamCalls.at(-1)
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(modelCall?.headers).toEqual({
      "x-base": "1",
      "x-extension-hook": "enabled",
      "x-runtime-hook": "enabled"
    })
    expect(promptJson).toContain("Runtime system")
    expect(promptJson).toContain("Extension system")
    expect(extensionResponses).toEqual([
      expect.objectContaining({
        runId: expect.any(String),
        status: "succeeded"
      })
    ])
  })

  it("runs delegated child agents through the faux provider with scoped child runs", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })

    harness.faux.setGenerateResponses([
      createFauxGenerateTextResponse(
        [
          "Keep this finding.",
          "<antThinking>internal planning</antThinking>",
          '<function_calls><invoke name="read"></invoke></function_calls>',
          "Executed in /repo",
          "zsh",
          "rtk vp test",
          "ok",
          "0",
          "Final note."
        ].join("\n"),
        {
          modelId: "mock-model"
        }
      )
    ])
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          task: "Find the settings tab files."
        },
        modelId: "mock-model",
        toolCallId: "delegate-call-1",
        toolName: "agentExplore"
      }),
      createFauxTextResponse("Parent done.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "parent-only-history",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const runs = await harness.session.listRuns()
    const childRun = runs.find((run) => run.profileId === "explore")
    const childGenerateCall = harness.faux.model.doGenerateCalls.at(-1)
    const childPromptJson = JSON.stringify(childGenerateCall?.prompt)

    expect(runs).toEqual([
      expect.objectContaining({
        parentRunId: null,
        profileId: "coder",
        status: "succeeded"
      }),
      expect.objectContaining({
        parentRunId: runs[0]?.id,
        profileId: "explore",
        status: "succeeded"
      })
    ])
    expect(
      childGenerateCall?.tools?.map((tool) => tool.name).toSorted()
    ).toEqual(["find", "grep", "ls", "read", "stat"])
    expect(childPromptJson).toContain("Find the settings tab files.")
    expect(childPromptJson).not.toContain("parent-only-history")
    expect(await harness.session.listToolCalls()).toEqual([
      expect.objectContaining({
        id: "delegate-call-1",
        output: expect.objectContaining({
          profileId: "explore",
          subRunId: childRun?.id,
          summary: "Keep this finding.\n\nFinal note."
        }),
        runId: runs[0]?.id,
        state: "finished",
        toolName: "agentExplore"
      })
    ])
    expect(await harness.session.listEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            childRunId: childRun?.id,
            parentToolCallId: "delegate-call-1",
            profileId: "explore",
            task: "Find the settings tab files."
          }),
          type: "subagent_started"
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            childRunId: childRun?.id,
            parentToolCallId: "delegate-call-1",
            profileId: "explore",
            status: "succeeded"
          }),
          type: "subagent_finished"
        })
      ])
    )
  })

  it("surfaces delegated child parent-approval requests as structured output", async () => {
    const delegationEvents: AgentExtensionLifecycleEvent[] = []
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "parent-approval-observer",
          register: (context) => {
            context.on("delegation_finished", (event) => {
              delegationEvents.push(event)
            })
          }
        }
      ]
    })
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })

    harness.faux.setGenerateResponses([
      createFauxGenerateTextResponse(
        [
          "needs_parent_approval",
          "Need approval to edit src/settings.ts."
        ].join("\n"),
        {
          modelId: "mock-model"
        }
      )
    ])
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          task: "Update the settings file."
        },
        modelId: "mock-model",
        toolCallId: "delegate-parent-approval-1",
        toolName: "agentExplore"
      }),
      createFauxTextResponse("Parent will request approval.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      extensionRunner,
      messages: [
        {
          content: "Use a child agent.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const childGenerateCall = harness.faux.model.doGenerateCalls.at(-1)
    const childPromptJson = JSON.stringify(childGenerateCall?.prompt)
    const toolCalls = await harness.session.listToolCalls()
    const events = await harness.session.listEvents()

    expect(childPromptJson).toContain("needs_parent_approval")
    expect(toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "delegate-parent-approval-1",
          output: expect.objectContaining({
            status: "needs_parent_approval",
            summary: "Need approval to edit src/settings.ts."
          }),
          state: "finished",
          toolName: "agentExplore"
        })
      ])
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            parentToolCallId: "delegate-parent-approval-1",
            status: "needs_parent_approval"
          }),
          type: "subagent_finished"
        })
      ])
    )
    expect(delegationEvents).toEqual([
      expect.objectContaining({
        parentToolCallId: "delegate-parent-approval-1",
        status: "needs_parent_approval",
        summary: "Need approval to edit src/settings.ts.",
        type: "delegation_finished"
      })
    ])
  })

  it("turns delegated child failures into parent-visible tool errors without stopping the parent run", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })

    harness.faux.setGenerateResponses([])
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          task: "Delegate a child task that will fail."
        },
        modelId: "mock-model",
        toolCallId: "delegate-child-failure-1",
        toolName: "agentExplore"
      }),
      createFauxTextResponse("Parent recovered from child failure.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Use a child agent.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const runs = await harness.session.listRuns()
    const toolCalls = await harness.session.listToolCalls()

    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parentRunId: null,
          profileId: "coder",
          status: "succeeded"
        }),
        expect.objectContaining({
          profileId: "explore",
          status: "failed"
        })
      ])
    )
    expect(toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            "Mock language model generate response queue is empty."
          ),
          id: "delegate-child-failure-1",
          output: expect.objectContaining({
            status: "failed",
            summary: expect.stringContaining(
              "Mock language model generate response queue is empty."
            )
          }),
          state: "failed",
          toolName: "agentExplore"
        })
      ])
    )
  })

  it("emits extension lifecycle events for delegated child agents", async () => {
    const delegationEvents: AgentExtensionLifecycleEvent[] = []
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "delegation-observer",
          register: (context) => {
            context.on("delegation_started", (event) => {
              delegationEvents.push(event)
            })
            context.on("delegation_finished", (event) => {
              delegationEvents.push(event)
            })
          }
        }
      ]
    })
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })

    harness.faux.setGenerateResponses([
      createFauxGenerateTextResponse("Child lifecycle summary.", {
        modelId: "mock-model"
      })
    ])
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          task: "Trace delegated lifecycle."
        },
        modelId: "mock-model",
        toolCallId: "delegate-call-1",
        toolName: "agentExplore"
      }),
      createFauxTextResponse("Parent done.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      extensionRunner,
      messages: [
        {
          content: "Delegate with lifecycle events.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const runs = await harness.session.listRuns()
    const childRun = runs.find((run) => run.profileId === "explore")

    expect(delegationEvents).toEqual([
      expect.objectContaining({
        childRunId: childRun?.id,
        extensionId: "etyon",
        includeApprovalTools: false,
        parentToolCallId: "delegate-call-1",
        profileId: "explore",
        task: "Trace delegated lifecycle.",
        type: "delegation_started"
      }),
      expect.objectContaining({
        childRunId: childRun?.id,
        extensionId: "etyon",
        parentToolCallId: "delegate-call-1",
        profileId: "explore",
        status: "succeeded",
        summary: "Child lifecycle summary.",
        truncated: false,
        type: "delegation_finished"
      })
    ])
  })

  it("bounds delegated child turns and keeps child aborts on the run signal", async () => {
    const abortController = new AbortController()
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true,
          maxSteps: 1
        }
      })
    })

    fs.writeFileSync(
      `${harness.projectPath}/package.json`,
      '{ "name": "@etyon/desktop" }'
    )
    harness.faux.setGenerateResponses([
      createFauxGenerateToolCallResponse({
        input: {
          path: "package.json"
        },
        modelId: "mock-model",
        toolCallId: "child-tool-call-1",
        toolName: "read"
      }),
      createFauxGenerateTextResponse("This child response must stay queued.", {
        modelId: "mock-model"
      })
    ])
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          task: "Read package metadata."
        },
        modelId: "mock-model",
        toolCallId: "delegate-call-1",
        toolName: "agentExplore"
      })
    ])

    const result = await harness.stream({
      abortSignal: abortController.signal,
      messages: [
        {
          content: "Use a child agent.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const childGenerateCall = harness.faux.model.doGenerateCalls.at(-1)
    const runs = await harness.session.listRuns()
    const childRun = runs.find((run) => run.profileId === "explore")

    expect(harness.faux.model.doGenerateCalls).toHaveLength(1)
    expect(childGenerateCall?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(childGenerateCall?.abortSignal).not.toBe(abortController.signal)
    expect(childGenerateCall?.abortSignal?.aborted).toBe(false)
    abortController.abort()
    expect(childGenerateCall?.abortSignal?.aborted).toBe(false)
    expect(childRun).toEqual(
      expect.objectContaining({
        profileId: "explore",
        status: "succeeded"
      })
    )
  })

  it("prepares delegated child provider requests through stream hooks", async () => {
    const afterProviderResponseMock = vi.fn()
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })

    harness.faux.setGenerateResponses([
      createFauxGenerateTextResponse("Hooked child summary.", {
        modelId: "mock-model"
      })
    ])
    harness.faux.setResponses([
      createFauxToolCallResponse({
        input: {
          task: "Find the settings tab files."
        },
        modelId: "mock-model",
        toolCallId: "delegate-call-1",
        toolName: "agentExplore"
      }),
      createFauxTextResponse("Parent done.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Use a child agent.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks: {
        afterProviderResponse: afterProviderResponseMock,
        beforeProviderPayload: beforeExploreProviderPayloadHook,
        beforeProviderRequest: beforeExploreProviderRequestHook
      },
      streamOptions: {
        headers: {
          "x-base": "1"
        },
        metadata: {
          source: "chat"
        }
      }
    })

    await result.consumeStream()

    const runs = await harness.session.listRuns()
    const childRun = runs.find((run) => run.profileId === "explore")
    const childGenerateCall = harness.faux.model.doGenerateCalls.at(-1)
    const childPromptJson = JSON.stringify(childGenerateCall?.prompt)

    expect(childGenerateCall?.headers).toEqual(
      expect.objectContaining({
        "x-base": "1",
        "x-child-run": "patched"
      })
    )
    expect(childPromptJson).toContain("Hooked child system")
    expect(childPromptJson).toContain("hooked child task")
    expect(afterProviderResponseMock).toHaveBeenCalledWith({
      response: expect.objectContaining({
        parentToolCallId: "delegate-call-1",
        profileId: "explore",
        runId: childRun?.id,
        status: "succeeded"
      })
    })
  })

  it("only delivers live events for the harness session", async () => {
    const firstHarness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      projectPath: `${mockedHomeDir}/first-project`,
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const secondHarness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      projectPath: `${mockedHomeDir}/second-project`,
      rootPath: mockedHomeDir,
      settings: firstHarness.settings
    })
    const firstLiveEventTypes: string[] = []
    const unsubscribe = firstHarness.session.subscribe((event) => {
      firstLiveEventTypes.push(event.type)
    })

    try {
      secondHarness.faux.setResponses([
        createFauxTextResponse("second", {
          modelId: "mock-model"
        })
      ])

      const secondResult = await secondHarness.stream({
        messages: [
          {
            content: "Run in another session.",
            role: "user"
          }
        ] satisfies ModelMessage[]
      })

      await secondResult.consumeStream()

      expect(firstLiveEventTypes).toEqual([])

      firstHarness.faux.setResponses([
        createFauxTextResponse("first", {
          modelId: "mock-model"
        })
      ])

      const firstResult = await firstHarness.stream({
        messages: [
          {
            content: "Run in this session.",
            role: "user"
          }
        ] satisfies ModelMessage[]
      })

      await firstResult.consumeStream()

      expect(firstLiveEventTypes).toEqual(
        expect.arrayContaining(["agent_run_started", "agent_run_finished"])
      )
    } finally {
      unsubscribe()
    }
  })

  it("creates a suspended tool approval run for the harness session", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    const approval = await harness.session.suspendForToolApproval({
      approvalId: "approval-1",
      input: {
        content: "pending",
        path: "pending.txt"
      },
      profileId: "coder",
      toolCallId: "tool-call-1",
      toolName: "write"
    })
    const events = await harness.session.listEvents()

    expect(approval.run).toMatchObject({
      chatSessionId: harness.session.id,
      profileId: "coder",
      status: "suspended"
    })
    expect(events).toEqual([
      expect.objectContaining({
        runId: approval.run.id,
        type: "tool_call_approval_requested"
      })
    ])
    expect(
      approval.toModelMessages({
        approved: false,
        reason: "Denied in test."
      })
    ).toEqual([
      {
        content: [
          {
            input: {
              content: "pending",
              path: "pending.txt"
            },
            toolCallId: "tool-call-1",
            toolName: "write",
            type: "tool-call"
          },
          {
            approvalId: "approval-1",
            toolCallId: "tool-call-1",
            type: "tool-approval-request"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            approvalId: "approval-1",
            approved: false,
            reason: "Denied in test.",
            type: "tool-approval-response"
          }
        ],
        role: "tool"
      }
    ] satisfies ModelMessage[])
  })
})
