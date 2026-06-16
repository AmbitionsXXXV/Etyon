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

export const estimateChatContextUsagePercent = (
  messages: UIMessage[]
): number => {
  const totalCharacters = messages.reduce(
    (sum, message) => sum + getMessageText(message).length,
    0
  )

  return Math.min(
    100,
    Math.round((totalCharacters / CHAT_CONTEXT_CHAR_BUDGET) * 100)
  )
}
