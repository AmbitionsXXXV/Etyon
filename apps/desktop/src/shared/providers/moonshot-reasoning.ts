import { AsyncLocalStorage } from "node:async_hooks"

import type { FetchFunction } from "@ai-sdk/provider-utils"
import type { ModelMessage } from "ai"

const MOONSHOT_REASONING_PLACEHOLDER = "."
const CHAT_COMPLETIONS_PATH_SUFFIX = "/chat/completions"

const moonshotReasoningByAssistantToolCall = new AsyncLocalStorage<
  readonly string[]
>()

interface MoonshotChatCompletionMessage {
  reasoning_content?: string
  role?: string
  tool_calls?: unknown[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isChatCompletionsRequest = (input: RequestInfo | URL): boolean => {
  if (typeof input === "string") {
    return input.includes(CHAT_COMPLETIONS_PATH_SUFFIX)
  }

  if (input instanceof URL) {
    return input.pathname.endsWith(CHAT_COMPLETIONS_PATH_SUFFIX)
  }

  return input.url.includes(CHAT_COMPLETIONS_PATH_SUFFIX)
}

const getReasoningTextFromAssistantMessage = (
  message: ModelMessage
): string => {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return ""
  }

  return message.content
    .filter(
      (
        part
      ): part is Extract<
        (typeof message.content)[number],
        { type: "reasoning" }
      > => part.type === "reasoning"
    )
    .map((part) => part.text)
    .join("\n")
    .trim()
}

const assistantMessageHasToolCall = (message: ModelMessage): boolean => {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return false
  }

  return message.content.some((part) => part.type === "tool-call")
}

export const buildMoonshotReasoningForAssistantToolCalls = (
  messages: ModelMessage[]
): readonly string[] =>
  messages
    .filter(assistantMessageHasToolCall)
    .map(getReasoningTextFromAssistantMessage)

export const runWithMoonshotReasoningContext = <T>(
  reasoningForAssistantToolCalls: readonly string[],
  run: () => Promise<T>
): Promise<T> =>
  moonshotReasoningByAssistantToolCall.run(reasoningForAssistantToolCalls, run)

const resolveReasoningContentForAssistantToolCall = ({
  assistantToolCallIndex,
  reasoningForAssistantToolCalls
}: {
  assistantToolCallIndex: number
  reasoningForAssistantToolCalls: readonly string[]
}): string => {
  const reasoningText =
    reasoningForAssistantToolCalls[assistantToolCallIndex]?.trim()

  return reasoningText || MOONSHOT_REASONING_PLACEHOLDER
}

export const patchMoonshotChatCompletionRequestBody = (
  body: Record<string, unknown>,
  reasoningForAssistantToolCalls: readonly string[] = moonshotReasoningByAssistantToolCall.getStore() ??
    []
): Record<string, unknown> => {
  const { messages } = body

  if (!Array.isArray(messages)) {
    return body
  }

  let modified = false
  let assistantToolCallIndex = 0
  const nextMessages = messages.map((message) => {
    if (!isRecord(message)) {
      return message
    }

    const assistantMessage = message as MoonshotChatCompletionMessage

    if (assistantMessage.role !== "assistant") {
      return message
    }

    const toolCalls = assistantMessage.tool_calls

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return message
    }

    const existingReasoning = assistantMessage.reasoning_content?.trim()
    const currentAssistantToolCallIndex = assistantToolCallIndex

    assistantToolCallIndex += 1

    if (existingReasoning) {
      return message
    }

    modified = true

    return {
      ...assistantMessage,
      reasoning_content: resolveReasoningContentForAssistantToolCall({
        assistantToolCallIndex: currentAssistantToolCallIndex,
        reasoningForAssistantToolCalls
      })
    }
  })

  if (!modified) {
    return body
  }

  return {
    ...body,
    messages: nextMessages
  }
}

export const createMoonshotFetch = (
  baseFetch: typeof fetch = fetch
): FetchFunction => {
  const moonshotFetch: FetchFunction = (input, init) => {
    if (!init?.body || typeof init.body !== "string") {
      return baseFetch(input, init)
    }

    if (!isChatCompletionsRequest(input)) {
      return baseFetch(input, init)
    }

    try {
      const parsedBody = JSON.parse(init.body) as Record<string, unknown>
      const patchedBody = patchMoonshotChatCompletionRequestBody(parsedBody)

      if (patchedBody === parsedBody) {
        return baseFetch(input, init)
      }

      return baseFetch(input, {
        ...init,
        body: JSON.stringify(patchedBody)
      })
    } catch {
      return baseFetch(input, init)
    }
  }

  return moonshotFetch
}
