import { AppSettingsSchema } from "@etyon/rpc"
import type { LanguageModel, ModelMessage } from "ai"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { streamAgentChat } from "@/main/agents/agent-runtime"
import type { AppDatabase } from "@/main/db"

const {
  appendEventMock,
  createAgentRunMock,
  generateTextMock,
  listAgentEventsMock,
  listAgentToolCallsMock,
  recordAgentToolCallMock,
  stepCountIsMock,
  streamTextMock,
  updateAgentRunMock,
  updateAgentToolCallMock
} = vi.hoisted(() => ({
  appendEventMock: vi.fn(() => Promise.resolve({ id: "event-1" })),
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
  listAgentEventsMock: vi.fn(() => Promise.resolve([])),
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
  listAgentEvents: listAgentEventsMock,
  listAgentToolCalls: listAgentToolCallsMock,
  recordAgentToolCall: recordAgentToolCallMock,
  updateAgentRun: updateAgentRunMock,
  updateAgentToolCall: updateAgentToolCallMock
}))

const db = {} as AppDatabase
const model = { modelId: "openai/gpt-4.1" } as unknown as LanguageModel
const modelMessages: ModelMessage[] = []

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
        toolNames: ["searchFiles", "readFile", "gitDiff"]
      },
      type: "agent_run_started"
    })
    expect(Object.keys(streamOptions?.tools ?? {}).toSorted()).toEqual([
      "gitDiff",
      "readFile",
      "searchFiles"
    ])
    expect(streamOptions?.stopWhen).toEqual({
      kind: "step-count",
      stepCount: 5
    })
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
    const result = await streamOptions?.tools?.agentExplore?.execute?.(
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
      "listProjectTree",
      "readFile",
      "searchFiles"
    ])
    expect(generateOptions?.stopWhen).toEqual({
      kind: "step-count",
      stepCount: 8
    })
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
        toolNames: ["listProjectTree", "searchFiles", "readFile"]
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
      summary: "Child summary.",
      truncated: false
    })
  })
})
