import type { UIMessage } from "ai"

/**
 * Character budget used to estimate how full the chat context is. This is the
 * same budget that drives auto-compaction, so the composer indicator and the
 * auto-compact trigger stay in sync.
 */
export const CHAT_CONTEXT_CHAR_BUDGET = 24_000

const WHITESPACE_PATTERN = /\s+/gu

const getTextParts = (
  message: UIMessage
): Extract<UIMessage["parts"][number], { type: "text" }>[] =>
  message.parts.filter(
    (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
      part.type === "text"
  )

export const getMessageText = (message: UIMessage): string =>
  getTextParts(message)
    .map((part) => part.text)
    .join(" ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()

const serializeContextValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

// Keep title/memory getMessageText text-only. This projection estimates the
// content sent to the model, including tool inputs/results and reasoning.
export const getMessageContextText = (message: UIMessage): string =>
  message.parts
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.text
      }
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") {
        return ""
      }
      const toolName =
        "toolName" in part ? String(part.toolName) : part.type.slice(5)
      let output: unknown = "output" in part ? part.output : undefined
      if (
        ["task_create", "task_update", "task_list"].includes(toolName) &&
        typeof output === "object" &&
        output !== null &&
        !Array.isArray(output)
      ) {
        const { todos: _todos, ...details } = output as Record<string, unknown>
        output = details
      }
      return [
        toolName,
        serializeContextValue({
          ...("state" in part ? { state: part.state } : {}),
          ...("approval" in part ? { approval: part.approval } : {})
        }),
        "input" in part ? serializeContextValue(part.input) : "",
        serializeContextValue(output),
        "errorText" in part ? String(part.errorText) : ""
      ]
        .filter(Boolean)
        .join(" ")
    })
    .filter(Boolean)
    .join("\n")

export const estimateChatContextUsagePercent = (
  messages: UIMessage[]
): number => {
  const totalCharacters = messages.reduce(
    (sum, message) => sum + getMessageContextText(message).length,
    0
  )

  return Math.min(
    100,
    Math.round((totalCharacters / CHAT_CONTEXT_CHAR_BUDGET) * 100)
  )
}

export interface ChatContextUsageSegment {
  characters: number
  key: "assistant" | "user"
}

/**
 * Breaks the same character estimate down by message role. This is the only
 * split available at the renderer layer today — system prompt, image, and
 * skill/schema token weight live in the main-process agent runtime and aren't sent
 * to the client, so they can't be represented here without fabricating
 * numbers.
 */
export const getChatContextUsageSegments = (
  messages: UIMessage[]
): ChatContextUsageSegment[] => {
  let userCharacters = 0
  let assistantCharacters = 0

  for (const message of messages) {
    const characters = getMessageContextText(message).length

    if (message.role === "user") {
      userCharacters += characters
    } else if (message.role === "assistant") {
      assistantCharacters += characters
    }
  }

  return [
    { characters: userCharacters, key: "user" },
    { characters: assistantCharacters, key: "assistant" }
  ]
}
