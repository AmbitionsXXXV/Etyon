import { AppSettingsSchema } from "@etyon/rpc"
import { APICallError } from "ai"
import type { LanguageModel, ModelMessage, UIMessage } from "ai"
import type * as Ai from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  buildChatStreamResponse,
  describeChatStreamError
} from "@/main/server/routes/build-chat-stream-response"

const { handleChatStreamMock, streamTextMock } = vi.hoisted(() => ({
  handleChatStreamMock: vi.fn(),
  streamTextMock: vi.fn()
}))

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>()

  return {
    ...actual,
    streamText: streamTextMock
  }
})

vi.mock("@mastra/ai-sdk", () => ({
  handleChatStream: handleChatStreamMock
}))

vi.mock("@/main/agents/minimal/file-agent", () => ({
  FILE_AGENT_ID: "file-agent",
  fileAgentMastra: {}
}))

vi.mock("@electron-toolkit/utils", () => ({
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => {
  const electronMock = {
    app: {
      getLocale: () => "en-US",
      getPath: () => "/tmp/etyon-test-home",
      getVersion: () => "0.1.0-test"
    }
  }

  return {
    ...electronMock,
    default: electronMock
  }
})

const createEmptyUiStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close()
    }
  })

const createStreamTextResult = () => ({
  toUIMessageStream: vi.fn(() => createEmptyUiStream())
})

const readResponseText = async (response: Response): Promise<string> => {
  if (!response.body) {
    return ""
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    text += decoder.decode(value, {
      stream: true
    })
  }

  text += decoder.decode()

  return text
}

const buildBaseOptions = () => ({
  abortSignal: new AbortController().signal,
  messages: [
    {
      id: "message-1",
      parts: [
        {
          text: "hello",
          type: "text" as const
        }
      ],
      role: "user" as const
    }
  ] satisfies UIMessage[],
  model: { modelId: "openai/gpt-4.1" } as unknown as LanguageModel,
  modelId: "openai/gpt-4.1",
  modelMessages: [
    {
      content: "hello",
      role: "user"
    }
  ] satisfies ModelMessage[],
  moonshotReasoningForAssistantToolCalls: [],
  onFinishPersist: vi.fn(() => Promise.resolve()),
  projectPath: "/tmp/project-a",
  requestStartedAt: Date.now(),
  sessionId: "session-1",
  systemPrompts: ["base system"]
})

describe("buildChatStreamResponse", () => {
  it("streams plain chat through streamText when agents are disabled", async () => {
    streamTextMock.mockReturnValue(createStreamTextResult())

    const options = buildBaseOptions()
    const response = buildChatStreamResponse({
      ...options,
      settings: AppSettingsSchema.parse({})
    })

    await readResponseText(response)

    expect(handleChatStreamMock).not.toHaveBeenCalled()
    expect(streamTextMock).toHaveBeenCalledTimes(1)

    const streamOptions = streamTextMock.mock.calls[0]?.[0]

    expect(streamOptions?.system).toBe("base system")
    expect(streamOptions?.messages).toEqual(options.modelMessages)
    expect(options.onFinishPersist).toHaveBeenCalledTimes(1)
  })

  it("routes agent-enabled requests through the Mastra file agent bridge", async () => {
    handleChatStreamMock.mockResolvedValue(createEmptyUiStream())
    streamTextMock.mockClear()

    const options = buildBaseOptions()
    const response = buildChatStreamResponse({
      ...options,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true,
          maxSteps: 5
        }
      }),
      trigger: "submit-message"
    })

    await readResponseText(response)

    expect(streamTextMock).not.toHaveBeenCalled()
    expect(handleChatStreamMock).toHaveBeenCalledTimes(1)

    const bridgeOptions = handleChatStreamMock.mock.calls[0]?.[0]

    expect(bridgeOptions?.agentId).toBe("file-agent")
    expect(bridgeOptions?.version).toBe("v6")
    expect(bridgeOptions?.params.maxSteps).toBe(5)
    expect(bridgeOptions?.params.trigger).toBe("submit-message")
    expect(bridgeOptions?.params.messages).toEqual(options.messages)
    expect(bridgeOptions?.params.requestContext.get("modelId")).toBe(
      "openai/gpt-4.1"
    )
    expect(bridgeOptions?.params.requestContext.get("projectPath")).toBe(
      "/tmp/project-a"
    )
    expect(options.onFinishPersist).toHaveBeenCalledTimes(1)
  })

  it("attaches work time metadata to the persisted assistant message", async () => {
    streamTextMock.mockReturnValue({
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "start"
            })
            controller.enqueue({
              type: "text-start",
              id: "text-1"
            })
            controller.enqueue({
              delta: "hi",
              id: "text-1",
              type: "text-delta"
            })
            controller.enqueue({
              type: "text-end",
              id: "text-1"
            })
            controller.enqueue({
              type: "finish"
            })
            controller.close()
          }
        })
    })

    const options = buildBaseOptions()
    const response = buildChatStreamResponse({
      ...options,
      settings: AppSettingsSchema.parse({})
    })

    await readResponseText(response)

    expect(options.onFinishPersist).toHaveBeenCalledTimes(1)

    const persistedMessages = (
      options.onFinishPersist.mock.calls as unknown as [UIMessage[]][]
    )[0]?.[0]
    const assistantMessage = persistedMessages?.findLast(
      (message) => message.role === "assistant"
    )

    expect(assistantMessage).toBeDefined()
    expect(
      (assistantMessage?.metadata as { workTimeMs?: number } | undefined)
        ?.workTimeMs
    ).toBeTypeOf("number")
  })
})

const buildResponsesApiError = (overrides?: {
  message?: string
  url?: string
}): APICallError =>
  new APICallError({
    message: overrides?.message ?? "Item with id 'msg_123' not found.",
    requestBodyValues: {},
    url: overrides?.url ?? "https://api.amux.ai/v1/responses"
  })

describe("describeChatStreamError", () => {
  it("explains item-reference failures from a non-official Responses API host", () => {
    const message = describeChatStreamError(buildResponsesApiError())

    expect(message).toContain("Item with id 'msg_123' not found.")
    expect(message).toContain("api.amux.ai")
    expect(message).toContain("Chat Completions")
  })

  it("leaves the message untouched for the official OpenAI host", () => {
    const error = buildResponsesApiError({
      url: "https://api.openai.com/v1/responses"
    })

    expect(describeChatStreamError(error)).toBe(error.message)
  })

  it("leaves the message untouched for an unrelated error on a custom host", () => {
    const error = buildResponsesApiError({
      message: "Incorrect API key provided."
    })

    expect(describeChatStreamError(error)).toBe(error.message)
  })

  it("leaves the message untouched for a non-Responses-API call", () => {
    const error = buildResponsesApiError({
      url: "https://api.amux.ai/v1/chat/completions"
    })

    expect(describeChatStreamError(error)).toBe(error.message)
  })

  it("matches the AI SDK's default error formatting for non-API errors", () => {
    expect(describeChatStreamError(new Error("boom"))).toBe("boom")
    expect(describeChatStreamError("plain string")).toBe("plain string")
    expect(describeChatStreamError(null)).toBe("unknown error")
    expect(describeChatStreamError({ some: "object" })).toBe(
      JSON.stringify({ some: "object" })
    )
  })
})
