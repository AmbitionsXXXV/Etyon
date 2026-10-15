import type { UIMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  DEFAULT_CHAT_CONTEXT_WINDOW,
  estimateChatContextUsagePercent,
  estimateTextTokens
} from "@/shared/chat/context-usage"

const message = (text: string): UIMessage => ({
  id: text.slice(0, 8),
  parts: [{ text, type: "text" }],
  role: "user"
})

describe("estimateTextTokens", () => {
  it("counts four ASCII characters or one other character per token", () => {
    expect(estimateTextTokens("abcdefgh")).toBe(2)
    expect(estimateTextTokens("abcde")).toBe(2)
    expect(estimateTextTokens("东京夜景")).toBe(4)
    expect(estimateTextTokens("ab东京")).toBe(3)
  })
})

describe("estimateChatContextUsagePercent", () => {
  it("measures against the model's window, falling back to the default", () => {
    const messages = [message("x".repeat(40_000))]
    expect(estimateChatContextUsagePercent(messages, 200_000)).toBe(5)
    expect(estimateChatContextUsagePercent(messages, null)).toBe(
      Math.round((10_000 / DEFAULT_CHAT_CONTEXT_WINDOW) * 100)
    )
    expect(estimateChatContextUsagePercent(messages, 5000)).toBe(100)
  })
})
