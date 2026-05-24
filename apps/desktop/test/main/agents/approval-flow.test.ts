import { AppSettingsSchema } from "@etyon/rpc"
import type { LanguageModel, ModelMessage } from "ai"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { streamAgentChat } from "@/main/agents/agent-runtime"
import type { AppDatabase } from "@/main/db"

const {
  appendEventMock,
  createAgentRunMock,
  generateTextMock,
  getAgentRunForToolApprovalMock,
  listAgentEventsMock,
  listAgentToolCallsMock,
  listPendingAgentApprovalsMock,
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
      startedAt: "2026-05-24T06:00:00.000Z",
      status: "running"
    })
  ),
  generateTextMock: vi.fn(() =>
    Promise.resolve({
      finishReason: "stop",
      text: "Child summary.",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    })
  ),
  getAgentRunForToolApprovalMock: vi.fn<() => Promise<unknown>>(() =>
    Promise.resolve(null)
  ),
  listAgentEventsMock: vi.fn(() => Promise.resolve([])),
  listAgentToolCallsMock: vi.fn<() => Promise<unknown[]>>(() =>
    Promise.resolve([])
  ),
  listPendingAgentApprovalsMock: vi.fn(() => Promise.resolve([])),
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
  listAgentToolCalls: listAgentToolCallsMock,
  listPendingAgentApprovals: listPendingAgentApprovalsMock,
  recordAgentToolCall: recordAgentToolCallMock,
  updateAgentRun: updateAgentRunMock,
  updateAgentToolCall: updateAgentToolCallMock
}))

const db = {} as AppDatabase
const model = { modelId: "openai/gpt-4.1" } as unknown as LanguageModel

const suspendedCoderRun = {
  appendEvent: appendEventMock,
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: null,
  id: "suspended-run-1",
  modelId: "openai/gpt-4.1",
  parentRunId: null,
  profileId: "coder",
  startedAt: "2026-05-24T06:00:00.000Z",
  status: "suspended"
}

const buildApprovalMessages = ({
  approved,
  reason
}: {
  approved: boolean
  reason?: string
}): ModelMessage[] => [
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
        approved,
        ...(reason ? { reason } : {}),
        type: "tool-approval-response"
      }
    ],
    role: "tool"
  }
]

describe("agent approval flow", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("resumes a suspended run with the suspended run profile tool scope", async () => {
    getAgentRunForToolApprovalMock.mockResolvedValueOnce(suspendedCoderRun)

    await streamAgentChat({
      db,
      messages: buildApprovalMessages({
        approved: true
      }),
      model,
      modelId: "openai/gpt-4.1",
      projectPath: "/tmp/project-a",
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "general-purpose",
          enabled: true
        }
      }),
      systemPrompts: []
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          tools?: Record<string, unknown>
        }
      | undefined

    expect(Object.keys(streamOptions?.tools ?? {}).toSorted()).toEqual([
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
  })

  it("adds a model-visible tool error when approval is denied", async () => {
    getAgentRunForToolApprovalMock.mockResolvedValueOnce(suspendedCoderRun)
    listAgentToolCallsMock.mockResolvedValueOnce([
      {
        id: "tool-call-1",
        toolName: "writeFile"
      }
    ])

    const messages = buildApprovalMessages({
      approved: false,
      reason: "Denied in chat UI."
    })

    await streamAgentChat({
      db,
      messages,
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
      systemPrompts: []
    })

    const streamOptions = streamTextMock.mock.calls[0]?.[0] as
      | {
          messages?: ModelMessage[]
        }
      | undefined
    const modelMessages = streamOptions?.messages ?? []
    const denialMessage = modelMessages.at(-1)

    expect(modelMessages).toHaveLength(messages.length + 1)
    expect(denialMessage).toEqual({
      content: [
        {
          output: {
            reason: "Denied in chat UI.",
            type: "execution-denied"
          },
          toolCallId: "tool-call-1",
          toolName: "writeFile",
          type: "tool-result"
        }
      ],
      role: "tool"
    })
  })
})
