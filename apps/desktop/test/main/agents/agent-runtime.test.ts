import { AppSettingsSchema } from "@etyon/rpc"
import type { LanguageModel, ModelMessage } from "ai"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import type {
  AgentEvent,
  AppendAgentEventInput
} from "@/main/agents/agent-event-store"
import { streamAgentChat } from "@/main/agents/agent-runtime"
import { createAgentRuntimeState } from "@/main/agents/agent-state"
import type { AgentStreamHooks } from "@/main/agents/agent-stream-hooks"
import type { AppDatabase } from "@/main/db"

const {
  appendEventMock,
  createAgentRunMock,
  generateTextMock,
  getAgentRunForToolApprovalMock,
  listAgentEventsMock,
  listPendingAgentApprovalsMock,
  listAgentToolCallsMock,
  recordAgentToolCallMock,
  stepCountIsMock,
  streamTextMock,
  updateAgentRunMock,
  updateAgentToolCallMock
} = vi.hoisted(() => ({
  appendEventMock: vi.fn((_event: AppendAgentEventInput) =>
    Promise.resolve({ id: "event-1" })
  ),
  createAgentRunMock: vi.fn(() =>
    Promise.resolve({
      appendEvent: appendEventMock,
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "run-1",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "general-purpose",
      startedAt: "2026-05-22T06:00:00.000Z",
      status: "running"
    })
  ),
  generateTextMock: vi.fn((_options: unknown) =>
    Promise.resolve({
      finishReason: "stop",
      text: "Child summary.",
      usage: {
        inputTokens: 5,
        outputTokens: 6,
        totalTokens: 11
      }
    })
  ),
  getAgentRunForToolApprovalMock: vi.fn<() => Promise<unknown>>(() =>
    Promise.resolve(null)
  ),
  listAgentEventsMock: vi.fn<() => Promise<AgentEvent[]>>(() =>
    Promise.resolve([])
  ),
  listPendingAgentApprovalsMock: vi.fn<() => Promise<unknown[]>>(() =>
    Promise.resolve([])
  ),
  listAgentToolCallsMock: vi.fn(() => Promise.resolve([])),
  recordAgentToolCallMock: vi.fn(() => Promise.resolve({ id: "tool-call-1" })),
  stepCountIsMock: vi.fn((stepCount: number) => ({
    kind: "step-count",
    stepCount
  })),
  streamTextMock: vi.fn((_options: unknown) => ({
    toUIMessageStreamResponse: vi.fn()
  })),
  updateAgentRunMock: vi.fn(() => Promise.resolve({ id: "run-1" })),
  updateAgentToolCallMock: vi.fn(() => Promise.resolve({ id: "tool-call-1" }))
}))

vi.mock("ai", () => ({
  generateText: generateTextMock,
  stepCountIs: stepCountIsMock,
  streamText: streamTextMock,
  tool: (definition: unknown) => definition
}))

vi.mock("@/main/agents/agent-event-store", () => ({
  createAgentRun: createAgentRunMock,
  getAgentRunForToolApproval: getAgentRunForToolApprovalMock,
  listAgentEvents: listAgentEventsMock,
  listPendingAgentApprovals: listPendingAgentApprovalsMock,
  listAgentToolCalls: listAgentToolCallsMock,
  recordAgentToolCall: recordAgentToolCallMock,
  updateAgentRun: updateAgentRunMock,
  updateAgentToolCall: updateAgentToolCallMock
}))

const db = {} as AppDatabase
const model = { modelId: "openai/gpt-4.1" } as unknown as LanguageModel
const modelMessages: ModelMessage[] = []
const createPersistedSessionEvent = (sequence: number, payload: unknown) => ({
  createdAt: "2026-05-24T06:00:00.000Z",
  id: `session-event-${sequence}`,
  payload,
  runId: "suspended-run-1",
  sequence,
  type: "agent_session_entry_appended"
})
const createApprovedToolMessages = (toolCallId: string): ModelMessage[] =>
  [
    {
      content: [
        {
          approvalId: "approval-1",
          toolCallId,
          type: "tool-approval-request"
        }
      ],
      role: "assistant"
    },
    {
      content: [
        {
          approvalId: "approval-1",
          approved: true,
          type: "tool-approval-response"
        }
      ],
      role: "tool"
    }
  ] as ModelMessage[]

describe("agent runtime", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("keeps the non-agent stream path when agents are disabled", async () => {
    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({}),
      systemPrompts: ["base system"]
    })

    expect(createAgentRunMock).not.toHaveBeenCalled()
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        stopWhen: expect.anything(),
        tools: expect.anything()
      })
    )
  })

  it("passes the request abort signal into the model stream", async () => {
    const abortController = new AbortController()

    await streamAgentChat({
      abortSignal: abortController.signal,
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({}),
      systemPrompts: ["base system"]
    })

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal
      })
    )
  })

  it("creates an agent run and streams with profile tools when agents are enabled", async () => {
    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true,
          maxSteps: 5
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          stopWhen?: unknown
          tools?: Record<string, unknown>
        }
      | undefined

    expect(createAgentRunMock).toHaveBeenCalledWith({
      chatSessionId: "session-1",
      db,
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })
    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        profileId: "general-purpose",
        toolNames: [
          "fileInfo",
          "findFiles",
          "searchFiles",
          "readFile",
          "gitDiff",
          "memorySearch"
        ]
      },
      type: "agent_run_started"
    })
    expect(Object.keys(streamOptions?.tools ?? {}).toSorted()).toEqual([
      "fileInfo",
      "findFiles",
      "gitDiff",
      "memorySearch",
      "readFile",
      "searchFiles"
    ])
    expect(streamOptions?.stopWhen).toEqual({
      kind: "step-count",
      stepCount: 5
    })
  })

  it("filters main runtime tools through active tool names", async () => {
    await streamAgentChat({
      activeToolNames: ["readFile"],
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          system?: string
          tools?: Record<string, unknown>
        }
      | undefined

    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        profileId: "general-purpose",
        toolNames: ["readFile"]
      },
      type: "agent_run_started"
    })
    expect(Object.keys(streamOptions?.tools ?? {})).toEqual(["readFile"])
    expect(streamOptions?.system).toContain("Available agent tools: readFile.")
  })

  it("filters main runtime tools through selected skill capabilities", async () => {
    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      skillCapabilities: ["write-fs"],
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          system?: string
          tools?: Record<string, unknown>
        }
      | undefined

    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        profileId: "coder",
        toolNames: ["applyPatch", "editFile", "writeFile"]
      },
      type: "agent_run_started"
    })
    expect(Object.keys(streamOptions?.tools ?? {}).toSorted()).toEqual([
      "applyPatch",
      "editFile",
      "writeFile"
    ])
    expect(streamOptions?.system).toContain(
      "Available agent tools: applyPatch, editFile, writeFile."
    )
  })

  it("appends assistant response messages to the session event log", async () => {
    await streamAgentChat({
      db,
      messages: [
        {
          content: "Summarize the project.",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: unknown) => Promise<void>
        }
      | undefined

    await streamOptions?.onFinish?.({
      finishReason: "stop",
      response: {
        messages: [
          {
            content: "This project is an Electron desktop app.",
            role: "assistant"
          }
        ]
      },
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    const sessionEntryEvents = appendEventMock.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_session_entry_appended")

    expect(sessionEntryEvents).toEqual([
      {
        payload: {
          action: "appendMessage",
          message: {
            content: "Summarize the project.",
            role: "user",
            type: "model"
          }
        },
        type: "agent_session_entry_appended"
      },
      {
        payload: {
          action: "appendMessage",
          message: {
            content: "This project is an Electron desktop app.",
            role: "assistant",
            type: "model"
          }
        },
        type: "agent_session_entry_appended"
      }
    ])
  })

  it("persists plan progress markers from plan profile responses", async () => {
    await streamAgentChat({
      db,
      messages: [
        {
          content: "Plan the implementation.",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "plan",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: unknown) => Promise<void>
        }
      | undefined

    await streamOptions?.onFinish?.({
      finishReason: "stop",
      response: {
        messages: [
          {
            content: "1. Inspect files. [DONE:1]\n2. Update tests. [DONE:2]",
            role: "assistant"
          }
        ]
      },
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    const sessionEntryEvents = appendEventMock.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_session_entry_appended")
    const stepCompletedEvents = appendEventMock.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "plan_step_completed")

    expect(stepCompletedEvents).toEqual([
      {
        payload: {
          mode: "plan",
          stepNumber: 1
        },
        type: "plan_step_completed"
      },
      {
        payload: {
          mode: "plan",
          stepNumber: 2
        },
        type: "plan_step_completed"
      }
    ])

    expect(sessionEntryEvents.slice(-2)).toEqual([
      {
        payload: {
          action: "appendMessage",
          message: {
            content: "1. Inspect files.\n2. Update tests.",
            role: "assistant",
            type: "model"
          }
        },
        type: "agent_session_entry_appended"
      },
      {
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
      }
    ])
  })

  it("persists validated structured plans from plan profile responses", async () => {
    await streamAgentChat({
      db,
      messages: [
        {
          content: "Plan the implementation.",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "plan",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: unknown) => Promise<void>
        }
      | undefined
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
    }

    await streamOptions?.onFinish?.({
      finishReason: "stop",
      response: {
        messages: [
          {
            content: ["```json", JSON.stringify(structuredPlan), "```"].join(
              "\n"
            ),
            role: "assistant"
          }
        ]
      },
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    const planValidatedEvents = appendEventMock.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "plan_validated")
    const sessionEntryEvents = appendEventMock.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_session_entry_appended")

    expect(planValidatedEvents).toEqual([
      {
        payload: {
          plan: structuredPlan
        },
        type: "plan_validated"
      }
    ])
    expect(sessionEntryEvents.at(-1)).toEqual({
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
  })

  it("appends tool response messages to the session event log", async () => {
    await streamAgentChat({
      db,
      messages: [
        {
          content: "Read package metadata.",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: unknown) => Promise<void>
        }
      | undefined

    await streamOptions?.onFinish?.({
      finishReason: "tool-calls",
      response: {
        messages: [
          {
            content: [
              {
                output: {
                  content: '{ "name": "@etyon/desktop" }'
                },
                toolCallId: "tool-call-1",
                toolName: "readFile",
                type: "tool-result"
              }
            ],
            role: "tool"
          }
        ]
      },
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    const sessionEntryEvents = appendEventMock.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_session_entry_appended")

    expect(sessionEntryEvents.at(-1)).toEqual({
      payload: {
        action: "appendMessage",
        message: {
          content: [
            {
              output: {
                content: '{ "name": "@etyon/desktop" }'
              },
              toolCallId: "tool-call-1",
              toolName: "readFile",
              type: "tool-result"
            }
          ],
          role: "tool",
          type: "model"
        }
      },
      type: "agent_session_entry_appended"
    })
  })

  it("prepares the main provider request through turn state stream hooks", async () => {
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

    await streamAgentChat({
      db,
      messages: [
        {
          content: "original user",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
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

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        experimental_context: expect.objectContaining({
          profileId: "general-purpose",
          runId: "run-1",
          sessionId: "session-1",
          source: "hook"
        }),
        headers: {
          "x-agent-run": "patched",
          "x-base": "1"
        },
        messages: [
          {
            content: "hooked user",
            role: "user"
          }
        ],
        system: "Hooked system"
      })
    )
  })

  it("persists prepared model messages as session tree events before streaming", async () => {
    await streamAgentChat({
      db,
      messages: [
        {
          content: "Inspect the changed files.",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      streamHooks: {
        beforeProviderPayload: () => ({
          messages: [
            {
              content: "Hooked model context.",
              role: "user"
            }
          ]
        })
      },
      systemPrompts: ["base system"]
    })

    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        action: "appendMessage",
        message: {
          content: "Hooked model context.",
          role: "user",
          type: "model"
        }
      },
      type: "agent_session_entry_appended"
    })
  })

  it("runs stream response hooks after finishing the main provider stream", async () => {
    const afterProviderResponseMock = vi.fn()

    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      streamHooks: {
        afterProviderResponse: afterProviderResponseMock
      },
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: {
            finishReason: string
            usage: {
              inputTokens: number
              outputTokens: number
              totalTokens: number
            }
          }) => Promise<void>
        }
      | undefined

    await streamOptions?.onFinish?.({
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    expect(afterProviderResponseMock).toHaveBeenCalledWith({
      response: {
        finishReason: "stop",
        runId: "run-1",
        status: "succeeded",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
      }
    })
  })

  it("marks the run failed when a provider request hook fails before streaming", async () => {
    const hookError = new Error("hook exploded")

    await expect(
      streamAgentChat({
        db,
        messages: modelMessages,
        model,
        modelId: "openai/gpt-4.1",
        projectPath: "/tmp/project-a",
        sessionId: "session-1",
        settings: AppSettingsSchema.parse({
          agents: {
            enabled: true
          }
        }),
        streamHooks: {
          beforeProviderRequest: () => {
            throw hookError
          }
        },
        systemPrompts: ["base system"]
      })
    ).rejects.toMatchObject({
      code: "hook",
      message: "Agent stream hook failed."
    })

    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      errorMessage: "Agent stream hook failed.",
      id: "run-1",
      status: "failed"
    })
    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        error: "Agent stream hook failed."
      },
      type: "agent_run_failed"
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it("wraps provider stream creation failures as typed runtime errors", async () => {
    const providerError = new Error("Provider socket closed.")

    streamTextMock.mockImplementationOnce(() => {
      throw providerError
    })

    await expect(
      streamAgentChat({
        db,
        messages: modelMessages,
        model,
        modelId: "openai/gpt-4.1",
        projectPath: "/tmp/project-a",
        sessionId: "session-1",
        settings: AppSettingsSchema.parse({
          agents: {
            enabled: true
          }
        }),
        systemPrompts: ["base system"]
      })
    ).rejects.toMatchObject({
      cause: providerError,
      code: "provider",
      message: "Agent provider stream failed."
    })

    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      errorMessage: "Agent provider stream failed.",
      id: "run-1",
      status: "failed"
    })
    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        error: "Agent provider stream failed."
      },
      type: "agent_run_failed"
    })
  })

  it("tracks the main provider turn phase until the stream finishes", async () => {
    const runtimeState = createAgentRuntimeState()
    const phases: string[] = []

    runtimeState.subscribe(({ phase }) => {
      phases.push(phase)
    })

    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      runtimeState,
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    expect(runtimeState.getSnapshot()).toEqual({
      phase: "turn"
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: {
            finishReason: string
            usage: {
              inputTokens: number
              outputTokens: number
              totalTokens: number
            }
          }) => Promise<void>
        }
      | undefined

    await streamOptions?.onFinish?.({
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })
    await runtimeState.waitForIdle()

    expect(runtimeState.getSnapshot()).toEqual({
      phase: "idle"
    })
    expect(phases).toEqual(["turn", "idle"])
  })

  it("records tool call lifecycle callbacks from the model stream", async () => {
    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          experimental_onToolCallFinish?: (event: unknown) => Promise<void>
          experimental_onToolCallStart?: (event: unknown) => Promise<void>
          onFinish?: (event: unknown) => Promise<void>
        }
      | undefined
    const toolCall = {
      input: {
        path: "src/main.ts"
      },
      toolCallId: "tool-call-1",
      toolName: "readFile",
      type: "tool-call"
    }

    await streamOptions?.experimental_onToolCallStart?.({
      toolCall
    })
    await streamOptions?.experimental_onToolCallFinish?.({
      output: {
        content: "export const value = 1"
      },
      success: true,
      toolCall
    })
    await streamOptions?.onFinish?.({
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    expect(recordAgentToolCallMock).toHaveBeenCalledWith({
      approvalState: "not_required",
      db,
      id: "tool-call-1",
      input: {
        path: "src/main.ts"
      },
      runId: "run-1",
      state: "running",
      toolName: "readFile"
    })
    expect(updateAgentToolCallMock).toHaveBeenCalledWith({
      db,
      id: "tool-call-1",
      output: {
        content: "export const value = 1"
      },
      runId: "run-1",
      state: "finished"
    })
    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        input: {
          path: "src/main.ts"
        },
        toolCallId: "tool-call-1",
        toolName: "readFile"
      },
      type: "tool_call_started"
    })
    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      id: "run-1",
      status: "succeeded"
    })
  })

  it("records approval requests emitted during a model step", async () => {
    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: {
            finishReason: string
            usage: {
              inputTokens: number
              outputTokens: number
              totalTokens: number
            }
          }) => Promise<void>
          onStepFinish?: (event: { content: unknown[] }) => Promise<void>
        }
      | undefined

    await streamOptions?.onStepFinish?.({
      content: [
        {
          approvalId: "approval-1",
          toolCall: {
            input: {
              patch: "*** Begin Patch\n*** End Patch"
            },
            toolCallId: "tool-call-1",
            toolName: "applyPatch"
          },
          type: "tool-approval-request"
        }
      ]
    })
    await streamOptions?.onFinish?.({
      finishReason: "tool-approval",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      }
    })

    expect(recordAgentToolCallMock).toHaveBeenCalledWith({
      approvalState: "pending",
      db,
      id: "tool-call-1",
      input: {
        patch: "*** Begin Patch\n*** End Patch"
      },
      runId: "run-1",
      state: "approval_requested",
      toolName: "applyPatch"
    })

    expect(appendEventMock).toHaveBeenCalledWith({
      payload: {
        approvalId: "approval-1",
        input: {
          patch: "*** Begin Patch\n*** End Patch"
        },
        toolCallId: "tool-call-1",
        toolName: "applyPatch"
      },
      type: "tool_call_approval_requested"
    })
    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      id: "run-1",
      status: "suspended"
    })
    expect(updateAgentRunMock).not.toHaveBeenCalledWith({
      db,
      id: "run-1",
      status: "succeeded"
    })
  })

  it("records approval responses found in resumed model messages", async () => {
    const resumedAppendEventMock = vi.fn((_event: AppendAgentEventInput) =>
      Promise.resolve({ id: "event-resumed-1" })
    )

    getAgentRunForToolApprovalMock.mockResolvedValueOnce({
      appendEvent: resumedAppendEventMock,
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "suspended-run-1",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-22T06:00:00.000Z",
      status: "suspended"
    })

    await streamAgentChat({
      db,
      messages: [
        {
          content: [
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
              reason: "Denied in chat UI.",
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    expect(getAgentRunForToolApprovalMock).toHaveBeenCalledWith({
      approvalId: "approval-1",
      chatSessionId: "session-1",
      db,
      pendingApprovalOnly: true,
      toolCallId: "tool-call-1"
    })
    expect(createAgentRunMock).not.toHaveBeenCalled()
    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      id: "suspended-run-1",
      status: "running"
    })
    expect(resumedAppendEventMock).toHaveBeenCalledWith({
      payload: {
        approvalId: "approval-1",
        approved: false,
        reason: "Denied in chat UI.",
        toolCallId: "tool-call-1"
      },
      type: "tool_call_denied"
    })
    expect(updateAgentToolCallMock).toHaveBeenCalledWith({
      approvalState: "denied",
      db,
      errorMessage: "Denied in chat UI.",
      id: "tool-call-1",
      runId: "suspended-run-1",
      state: "failed"
    })
  })

  it("records only approval responses that still have a pending suspended run", async () => {
    const resumedAppendEventMock = vi.fn((_event: AppendAgentEventInput) =>
      Promise.resolve({ id: "event-resumed-1" })
    )

    getAgentRunForToolApprovalMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        appendEvent: resumedAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "suspended-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-22T06:00:00.000Z",
        status: "suspended"
      })

    await streamAgentChat({
      db,
      messages: [
        {
          content: [
            {
              approvalId: "old-approval",
              toolCallId: "old-tool-call",
              type: "tool-approval-request"
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
              approved: true,
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    expect(getAgentRunForToolApprovalMock).toHaveBeenCalledTimes(2)
    expect(updateAgentToolCallMock).toHaveBeenCalledTimes(1)
    expect(updateAgentToolCallMock).toHaveBeenCalledWith({
      approvalState: "approved",
      db,
      errorMessage: null,
      id: "current-tool-call",
      runId: "suspended-run-1",
      state: "requested"
    })
    expect(resumedAppendEventMock).toHaveBeenCalledTimes(3)
    expect(resumedAppendEventMock).toHaveBeenCalledWith({
      payload: {
        approvalId: "current-approval",
        approved: true,
        reason: undefined,
        toolCallId: "current-tool-call"
      },
      type: "tool_call_approved"
    })
  })

  it("passes only matched approval responses into the resumed model stream", async () => {
    const resumedAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-resumed-1" })
    )

    getAgentRunForToolApprovalMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        appendEvent: resumedAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "suspended-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-22T06:00:00.000Z",
        status: "suspended"
      })

    await streamAgentChat({
      db,
      messages: [
        {
          content: [
            {
              input: {
                path: "old.txt"
              },
              toolCallId: "old-tool-call",
              toolName: "writeFile",
              type: "tool-call"
            },
            {
              approvalId: "old-approval",
              toolCallId: "old-tool-call",
              type: "tool-approval-request"
            },
            {
              input: {
                path: "current.txt"
              },
              toolCallId: "current-tool-call",
              toolName: "writeFile",
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
              approved: true,
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          messages?: ModelMessage[]
        }
      | undefined
    const streamedMessages = streamOptions?.messages ?? []

    expect(streamedMessages).toEqual([
      {
        content: [
          {
            input: {
              path: "current.txt"
            },
            toolCallId: "current-tool-call",
            toolName: "writeFile",
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
            approvalId: "current-approval",
            approved: true,
            type: "tool-approval-response"
          }
        ],
        role: "tool"
      }
    ])
  })

  it("rebuilds resumed provider context from persisted session events", async () => {
    const resumedAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-resumed-1" })
    )
    const approvalRequest = {
      approvalId: "approval-1",
      toolCallId: "tool-call-1",
      type: "tool-approval-request"
    } as const
    const approvalResponse = {
      approvalId: "approval-1",
      approved: true,
      type: "tool-approval-response"
    } as const

    getAgentRunForToolApprovalMock.mockResolvedValueOnce({
      appendEvent: resumedAppendEventMock,
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "suspended-run-1",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-22T06:00:00.000Z",
      status: "suspended"
    })
    listAgentEventsMock.mockResolvedValueOnce([
      createPersistedSessionEvent(1, {
        action: "appendMessage",
        message: {
          content: "Persisted user request.",
          role: "user",
          type: "model"
        }
      }),
      createPersistedSessionEvent(2, {
        action: "appendMessage",
        message: {
          content: [approvalRequest],
          role: "assistant",
          type: "model"
        }
      })
    ])

    await streamAgentChat({
      db,
      messages: [
        {
          content: [approvalRequest],
          role: "assistant"
        },
        {
          content: [approvalResponse],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          messages?: ModelMessage[]
        }
      | undefined

    expect(streamOptions?.messages).toEqual([
      {
        content: "Persisted user request.",
        role: "user"
      },
      {
        content: [approvalRequest],
        role: "assistant"
      },
      {
        content: [approvalResponse],
        role: "tool"
      }
    ])
  })

  it("replays pending queued session messages when resuming a run", async () => {
    const resumedAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-resumed-1" })
    )
    const approvalRequest = {
      approvalId: "approval-1",
      toolCallId: "tool-call-1",
      type: "tool-approval-request"
    } as const
    const approvalResponse = {
      approvalId: "approval-1",
      approved: true,
      type: "tool-approval-response"
    } as const

    getAgentRunForToolApprovalMock.mockResolvedValueOnce({
      appendEvent: resumedAppendEventMock,
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "suspended-run-1",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-22T06:00:00.000Z",
      status: "suspended"
    })
    listAgentEventsMock.mockResolvedValueOnce([
      createPersistedSessionEvent(1, {
        action: "appendMessage",
        message: {
          content: "Persisted user request.",
          role: "user",
          type: "model"
        }
      }),
      createPersistedSessionEvent(2, {
        action: "appendMessage",
        message: {
          content: [approvalRequest],
          role: "assistant",
          type: "model"
        }
      }),
      createPersistedSessionEvent(3, {
        action: "appendCustomMessage",
        message: {
          data: {
            message: "Recovered steering.",
            queue: "steer"
          },
          type: "steering"
        }
      })
    ])

    await streamAgentChat({
      db,
      messages: [
        {
          content: [approvalRequest],
          role: "assistant"
        },
        {
          content: [approvalResponse],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          messages?: ModelMessage[]
        }
      | undefined
    const appendEventCalls = resumedAppendEventMock.mock.calls as unknown as [
      AppendAgentEventInput
    ][]
    const sessionEntryEvents = appendEventCalls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_session_entry_appended")

    expect(streamOptions?.messages?.at(-1)).toEqual({
      content: "Recovered steering.",
      role: "user"
    })
    expect(sessionEntryEvents.at(-1)).toEqual({
      payload: {
        action: "appendMessage",
        message: {
          content: "Recovered steering.",
          role: "user",
          type: "model"
        }
      },
      type: "agent_session_entry_appended"
    })
  })

  it("appends only missing session context when resuming a suspended run", async () => {
    const resumedAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-resumed-1" })
    )

    getAgentRunForToolApprovalMock.mockResolvedValueOnce({
      appendEvent: resumedAppendEventMock,
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "suspended-run-1",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-22T06:00:00.000Z",
      status: "suspended"
    })
    listAgentEventsMock.mockResolvedValueOnce([
      createPersistedSessionEvent(1, {
        action: "appendMessage",
        message: {
          content: "Please update the file.",
          role: "user",
          type: "model"
        }
      })
    ])

    await streamAgentChat({
      db,
      messages: [
        {
          content: "Please update the file.",
          role: "user"
        },
        {
          content: [
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
              approved: true,
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const appendEventCalls = resumedAppendEventMock.mock.calls as unknown as [
      AppendAgentEventInput
    ][]
    const sessionEntryEvents = appendEventCalls
      .map(([event]) => event)
      .filter((event) => event.type === "agent_session_entry_appended")

    expect(sessionEntryEvents).toEqual([
      {
        payload: {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-1",
                toolCallId: "tool-call-1",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        },
        type: "agent_session_entry_appended"
      },
      {
        payload: {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-1",
                approved: true,
                type: "tool-approval-response"
              }
            ],
            role: "tool",
            type: "model"
          }
        },
        type: "agent_session_entry_appended"
      }
    ])
  })

  it("keeps a resumed run suspended when other approvals are still pending", async () => {
    const resumedAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-resumed-1" })
    )

    getAgentRunForToolApprovalMock.mockResolvedValueOnce({
      appendEvent: resumedAppendEventMock,
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "suspended-run-1",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-22T06:00:00.000Z",
      status: "suspended"
    })
    listPendingAgentApprovalsMock.mockResolvedValueOnce([
      {
        approvalId: "other-approval",
        approvalState: "pending",
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "other-tool-call",
        input: {
          command: "vp install"
        },
        output: undefined,
        parentToolCallId: null,
        profileId: "coder",
        runId: "suspended-run-1",
        runStatus: "running",
        startedAt: "2026-05-22T06:00:00.000Z",
        state: "approval_requested",
        toolName: "runCheck"
      }
    ])

    await streamAgentChat({
      db,
      messages: [
        {
          content: [
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
              approvalId: "current-approval",
              approved: true,
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          onFinish?: (event: {
            finishReason: string
            usage: {
              inputTokens: number
              outputTokens: number
              totalTokens: number
            }
          }) => Promise<void>
        }
      | undefined

    await streamOptions?.onFinish?.({
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    })

    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      id: "suspended-run-1",
      status: "suspended"
    })
    expect(updateAgentRunMock).not.toHaveBeenCalledWith({
      db,
      id: "suspended-run-1",
      status: "succeeded"
    })
  })

  it("only resumes approval responses owned by the current chat session", async () => {
    await streamAgentChat({
      db,
      messages: [
        {
          content: [
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
              approved: true,
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    expect(getAgentRunForToolApprovalMock).toHaveBeenCalledWith({
      approvalId: "approval-1",
      chatSessionId: "session-1",
      db,
      pendingApprovalOnly: true,
      toolCallId: "tool-call-1"
    })
  })

  it("runs delegated child agents with independent runs and bounded tools", async () => {
    const parentAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-1" })
    )
    const childAppendEventMock = vi.fn(() => Promise.resolve({ id: "event-2" }))

    createAgentRunMock
      .mockResolvedValueOnce({
        appendEvent: parentAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "parent-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-22T06:00:00.000Z",
        status: "running"
      })
      .mockResolvedValueOnce({
        appendEvent: childAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "child-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "explore",
        startedAt: "2026-05-22T06:00:01.000Z",
        status: "running"
      })

    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          tools?: Record<
            string,
            {
              execute?: (input: unknown, options: unknown) => Promise<unknown>
            }
          >
        }
      | undefined
    const childAbortController = new AbortController()
    const result = await streamOptions?.tools?.agentExplore?.execute?.(
      {
        task: "Find the settings tab files."
      },
      {
        abortSignal: childAbortController.signal,
        messages: [
          {
            content: "parent-only-history",
            role: "user"
          }
        ],
        toolCallId: "delegate-call-1"
      }
    )
    const generateOptions = generateTextMock.mock.calls[0]?.[0] as
      | {
          abortSignal?: AbortSignal
          messages?: ModelMessage[]
          stopWhen?: unknown
          tools?: Record<string, unknown>
        }
      | undefined

    expect(createAgentRunMock).toHaveBeenNthCalledWith(2, {
      chatSessionId: "session-1",
      db,
      modelId: "openai/gpt-4.1",
      parentRunId: "parent-run-1",
      profileId: "explore"
    })
    expect(Object.keys(generateOptions?.tools ?? {}).toSorted()).toEqual([
      "fileInfo",
      "findFiles",
      "listDirectory",
      "listProjectTree",
      "memorySearch",
      "readFile",
      "searchFiles"
    ])
    expect(generateOptions?.stopWhen).toEqual({
      kind: "step-count",
      stepCount: 8
    })
    expect(generateOptions?.abortSignal).toBe(childAbortController.signal)
    expect(generateOptions?.messages).toEqual([
      {
        content: expect.not.stringContaining("parent-only-history"),
        role: "user"
      }
    ])
    expect(parentAppendEventMock).toHaveBeenCalledWith({
      payload: {
        childRunId: "child-run-1",
        parentToolCallId: "delegate-call-1",
        profileId: "explore",
        task: "Find the settings tab files."
      },
      type: "subagent_started"
    })
    expect(childAppendEventMock).toHaveBeenCalledWith({
      payload: {
        parentRunId: "parent-run-1",
        parentToolCallId: "delegate-call-1",
        profileId: "explore",
        task: "Find the settings tab files.",
        toolNames: [
          "listProjectTree",
          "listDirectory",
          "fileInfo",
          "findFiles",
          "searchFiles",
          "readFile",
          "memorySearch"
        ]
      },
      type: "agent_run_started"
    })
    expect(updateAgentRunMock).toHaveBeenCalledWith({
      db,
      id: "child-run-1",
      status: "succeeded"
    })
    expect(result).toEqual({
      profileId: "explore",
      runId: "child-run-1",
      status: "succeeded",
      subRunId: "child-run-1",
      summary: "Child summary.",
      truncated: false
    })
  })

  it("restores coder tools for approved plan execute handoff child runs", async () => {
    const parentAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-1" })
    )
    const childAppendEventMock = vi.fn(() => Promise.resolve({ id: "event-2" }))

    createAgentRunMock
      .mockResolvedValueOnce({
        appendEvent: parentAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "parent-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "plan",
        startedAt: "2026-05-22T06:00:00.000Z",
        status: "running"
      })
      .mockResolvedValueOnce({
        appendEvent: childAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "child-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-22T06:00:01.000Z",
        status: "running"
      })

    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "plan",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          tools?: Record<
            string,
            {
              execute?: (input: unknown, options: unknown) => Promise<unknown>
            }
          >
        }
      | undefined

    await streamOptions?.tools?.agentCoder?.execute?.(
      {
        context: "Plan:\n1. Update tests\n2. Implement the change",
        expectedOutput: "A patch and validation summary.",
        task: "Execute the confirmed plan."
      },
      {
        messages: createApprovedToolMessages("coder-call-1"),
        toolCallId: "coder-call-1"
      }
    )

    const generateOptions = generateTextMock.mock.calls[0]?.[0] as
      | {
          stopWhen?: unknown
          tools?: Record<string, unknown>
        }
      | undefined

    expect(createAgentRunMock).toHaveBeenNthCalledWith(2, {
      chatSessionId: "session-1",
      db,
      modelId: "openai/gpt-4.1",
      parentRunId: "parent-run-1",
      profileId: "coder"
    })
    expect(Object.keys(generateOptions?.tools ?? {}).toSorted()).toEqual([
      "applyPatch",
      "editFile",
      "fileInfo",
      "findFiles",
      "gitDiff",
      "listDirectory",
      "memorySearch",
      "readFile",
      "runCheck",
      "searchFiles",
      "webSearch",
      "writeFile"
    ])
    expect(generateOptions?.stopWhen).toEqual({
      kind: "step-count",
      stepCount: 8
    })
  })

  it("prepares delegated child provider requests through stream hooks", async () => {
    const parentAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-1" })
    )
    const childAppendEventMock = vi.fn(() => Promise.resolve({ id: "event-2" }))
    const afterProviderResponseMock = vi.fn()
    const streamHooks: AgentStreamHooks = {
      afterProviderResponse: afterProviderResponseMock,
      beforeProviderPayload: ({ payload }) =>
        payload.runId === "child-run-1"
          ? {
              messages: [
                {
                  content: "hooked child task",
                  role: "user"
                }
              ],
              system: "Hooked child system"
            }
          : undefined,
      beforeProviderRequest: ({ payload }) =>
        payload.runId === "child-run-1"
          ? {
              headers: {
                "x-child-run": "patched"
              },
              metadata: {
                source: "child-hook"
              }
            }
          : undefined
    }

    createAgentRunMock
      .mockResolvedValueOnce({
        appendEvent: parentAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "parent-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-22T06:00:00.000Z",
        status: "running"
      })
      .mockResolvedValueOnce({
        appendEvent: childAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "child-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "explore",
        startedAt: "2026-05-22T06:00:01.000Z",
        status: "running"
      })

    await streamAgentChat({
      db,
      messages: modelMessages,
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      }),
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

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          tools?: Record<
            string,
            {
              execute?: (input: unknown, options: unknown) => Promise<unknown>
            }
          >
        }
      | undefined

    await streamOptions?.tools?.agentExplore?.execute?.(
      {
        task: "Find the settings tab files."
      },
      {
        messages: modelMessages,
        toolCallId: "delegate-call-1"
      }
    )

    const generateOptions = generateTextMock.mock.calls[0]?.[0] as
      | {
          experimental_context?: Record<string, unknown>
          headers?: Record<string, string>
          messages?: ModelMessage[]
          system?: string
        }
      | undefined

    expect(generateOptions).toEqual(
      expect.objectContaining({
        experimental_context: expect.objectContaining({
          parentRunId: "parent-run-1",
          parentToolCallId: "delegate-call-1",
          profileId: "explore",
          runId: "child-run-1",
          sessionId: "session-1",
          source: "child-hook"
        }),
        headers: {
          "x-base": "1",
          "x-child-run": "patched"
        },
        messages: [
          {
            content: "hooked child task",
            role: "user"
          }
        ],
        system: "Hooked child system"
      })
    )
    expect(afterProviderResponseMock).toHaveBeenCalledWith({
      response: {
        finishReason: "stop",
        parentRunId: "parent-run-1",
        parentToolCallId: "delegate-call-1",
        profileId: "explore",
        runId: "child-run-1",
        status: "succeeded",
        usage: {
          inputTokens: 5,
          outputTokens: 6,
          totalTokens: 11
        }
      }
    })
  })

  it("strips child agent transcript blocks before returning summaries to the parent", async () => {
    const parentAppendEventMock = vi.fn(() =>
      Promise.resolve({ id: "event-1" })
    )
    const childAppendEventMock = vi.fn(() => Promise.resolve({ id: "event-2" }))

    createAgentRunMock
      .mockResolvedValueOnce({
        appendEvent: parentAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "parent-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-22T06:00:00.000Z",
        status: "running"
      })
      .mockResolvedValueOnce({
        appendEvent: childAppendEventMock,
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: null,
        id: "child-run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "explore",
        startedAt: "2026-05-22T06:00:01.000Z",
        status: "running"
      })
    generateTextMock.mockResolvedValueOnce({
      finishReason: "stop",
      text: [
        "Keep this finding.",
        "<antThinking>internal planning</antThinking>",
        '<function_calls><invoke name="readFile"></invoke></function_calls>',
        "Executed in /repo",
        "zsh",
        "rtk vp test",
        "ok",
        "0",
        "Final note."
      ].join("\n"),
      usage: {
        inputTokens: 5,
        outputTokens: 6,
        totalTokens: 11
      }
    })

    await streamAgentChat({
      db,
      messages: [
        {
          content: "parent-only-history",
          role: "user"
        }
      ],
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true,
          defaultProfileId: "coder",
          enabled: true
        }
      }),
      systemPrompts: ["base system"]
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          tools?: Record<
            string,
            {
              execute?: (input: unknown, options: unknown) => Promise<unknown>
            }
          >
        }
      | undefined
    const result = await streamOptions?.tools?.agentExplore?.execute?.(
      {
        task: "Find the settings tab files."
      },
      {
        messages: [
          {
            content: "parent-only-history",
            role: "user"
          }
        ],
        toolCallId: "delegate-call-1"
      }
    )

    expect(result).toEqual({
      profileId: "explore",
      runId: "child-run-1",
      status: "succeeded",
      subRunId: "child-run-1",
      summary: "Keep this finding.\n\nFinal note.",
      truncated: false
    })
  })
})
