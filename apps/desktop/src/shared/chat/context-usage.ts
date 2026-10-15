import type { UIMessage } from "ai"

/**
 * Context window assumed when the chat model does not report one. The same
 * estimate drives the composer indicator and the auto-compact trigger, so the
 * two stay in sync.
 */
export const DEFAULT_CHAT_CONTEXT_WINDOW = 128_000

const ASCII_CHARS_PER_TOKEN = 4
const MAX_ASCII_CODE_POINT = 0x7f

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

/**
 * Tokens a text costs, roughly: four ASCII characters per token and one per
 * other character (CJK and the like) — magpie's estimate before it scales to
 * the vendor's count. No tokenizer ships with the app.
 */
export const estimateTextTokens = (text: string): number => {
  let asciiCharacters = 0
  let otherCharacters = 0

  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) <= MAX_ASCII_CODE_POINT) {
      asciiCharacters += 1
    } else {
      otherCharacters += 1
    }
  }

  return Math.ceil(asciiCharacters / ASCII_CHARS_PER_TOKEN) + otherCharacters
}

export const estimateChatContextTokens = (messages: UIMessage[]): number =>
  messages.reduce(
    (sum, message) => sum + estimateTextTokens(getMessageContextText(message)),
    0
  )

/** How full the model's context window is, as a 0–100 percentage. */
export const estimateChatContextUsagePercent = (
  messages: UIMessage[],
  contextWindow?: number | null
): number => {
  const window =
    contextWindow && contextWindow > 0
      ? contextWindow
      : DEFAULT_CHAT_CONTEXT_WINDOW

  return Math.min(
    100,
    Math.round((estimateChatContextTokens(messages) / window) * 100)
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
