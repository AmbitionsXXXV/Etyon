import { AppSettingsSchema } from "@etyon/rpc"
import type { LanguageModel, ModelMessage } from "ai"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import type { AppendAgentEventInput } from "@/main/agents/agent-event-store"
import { streamAgentChat } from "@/main/agents/agent-runtime"
import type { AppDatabase } from "@/main/db"

const {
  appendEventMock,
  createAgentRunMock,
  stepCountIsMock,
  streamTextMock,
  updateAgentRunMock
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
  stepCountIsMock: vi.fn((stepCount: number) => ({
    kind: "step-count",
    stepCount
  })),
  streamTextMock: vi.fn((_options: unknown) => ({
    toUIMessageStreamResponse: vi.fn()
  })),
  updateAgentRunMock: vi.fn(() => Promise.resolve({ id: "run-1" }))
}))

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: stepCountIsMock,
  streamText: streamTextMock,
  tool: (definition: unknown) => definition
}))

vi.mock("@/main/agents/agent-event-store", () => ({
  createAgentRun: createAgentRunMock,
  getAgentRunForToolApproval: vi.fn(() => Promise.resolve(null)),
  getLatestCompletedAgentRunForSession: vi.fn(() => Promise.resolve(null)),
  listAgentEvents: vi.fn(() => Promise.resolve([])),
  listAgentToolCalls: vi.fn(() => Promise.resolve([])),
  listPendingAgentApprovals: vi.fn(() => Promise.resolve([])),
  recordAgentToolCall: vi.fn(() => Promise.resolve({ id: "tool-call-1" })),
  updateAgentRun: updateAgentRunMock,
  updateAgentToolCall: vi.fn(() => Promise.resolve({ id: "tool-call-1" }))
}))

const db = {} as AppDatabase
const model = { modelId: "openai/gpt-4.1" } as unknown as LanguageModel
const modelMessages: ModelMessage[] = [
  {
    content: "Trigger provider.",
    role: "user"
  }
]
describe("agent runtime", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("wraps provider stream creation failures as typed runtime errors", async () => {
    const providerError = new Error("Provider socket closed.")

    streamTextMock.mockImplementationOnce(() => {
      throw providerError
    })

    const result = await streamAgentChat({
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
    const errors: unknown[] = []

    await result.consumeStream({
      onError: (error) => {
        errors.push(error)
      }
    })

    expect(errors).toEqual([
      expect.objectContaining({
        cause: providerError,
        code: "provider",
        message: "Agent provider stream failed."
      })
    ])
    expect(errors[0]).toMatchObject({
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
        code: "provider",
        error: "Agent provider stream failed."
      },
      type: "agent_run_failed"
    })
  })
})
