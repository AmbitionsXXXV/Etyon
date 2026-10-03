import { AppSettingsSchema } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  AUTO_COMPACT_MESSAGE_ID,
  compactChatMessages,
  estimateChatContextUsagePercent,
  maybeCompactChatMessages
} from "@/main/chat-auto-compact"
import * as summarization from "@/main/memory/summarization"

const buildTextMessage = ({
  id,
  role,
  text
}: {
  id: string
  role: UIMessage["role"]
  text: string
}): UIMessage => ({
  id,
  parts: [
    {
      text,
      type: "text"
    }
  ],
  role
})

describe("chat auto compact", () => {
  it("keeps the denial and its reason in fallback and model summary input", async () => {
    const messages: UIMessage[] = [
      {
        id: "denied",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "denied-command",
            state: "output-denied",
            input: { command: "echo forbidden" },
            approval: {
              id: "approval-denied",
              approved: false,
              reason: "Do not execute this action"
            }
          }
        ]
      },
      buildTextMessage({
        id: "large-context",
        role: "user",
        text: "x".repeat(24000)
      }),
      buildTextMessage({ id: "recent-user", role: "user", text: "next" }),
      buildTextMessage({
        id: "recent-assistant",
        role: "assistant",
        text: "next"
      })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: { enabled: true, keepRecentMessages: 2, threshold: 5 }
      }
    })
    const summarize = vi
      .spyOn(summarization, "summarizeChatCompaction")
      .mockResolvedValue("summarized")
    try {
      await compactChatMessages({ messages, settings })
      for (const content of [
        summarize.mock.calls[0]?.[0].fallbackContent,
        summarize.mock.calls[0]?.[0].sourceContent
      ]) {
        expect(content).toContain("output-denied")
        expect(content).toContain('"approved":false')
        expect(content).toContain("Do not execute this action")
      }
    } finally {
      summarize.mockRestore()
    }
  })

  it("sends middle decisions to the summarizer before fallback truncation", async () => {
    const summarize = vi
      .spyOn(summarization, "summarizeChatCompaction")
      .mockResolvedValue("summarized")
    try {
      const messages: UIMessage[] = [
        buildTextMessage({
          id: "source",
          role: "user",
          text: `${"a".repeat(2500)}MIDDLE_DECISION${"b".repeat(2500)}`
        }),
        buildTextMessage({ id: "recent-user", role: "user", text: "next" }),
        buildTextMessage({
          id: "recent-assistant",
          role: "assistant",
          text: "next"
        })
      ]
      const settings = AppSettingsSchema.parse({
        chat: {
          autoCompact: { enabled: true, keepRecentMessages: 2, threshold: 5 }
        }
      })
      await compactChatMessages({ messages, settings })
      expect(summarize).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceContent: expect.stringContaining("MIDDLE_DECISION")
        })
      )
      expect(summarize.mock.calls[0]?.[0].fallbackContent).not.toContain(
        "MIDDLE_DECISION"
      )
    } finally {
      summarize.mockRestore()
    }
  })
  it("counts tool results and carries their facts into compaction", () => {
    const messages: UIMessage[] = [
      {
        id: "tool",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "read",
            toolCallId: "read-1",
            state: "output-available",
            input: { path: "notes.md" },
            output: `NEW_TOOL_FACT ${"x".repeat(24000)}`
          }
        ]
      },
      buildTextMessage({ id: "recent-user", role: "user", text: "next" }),
      buildTextMessage({
        id: "recent-assistant",
        role: "assistant",
        text: "next"
      })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: { enabled: true, keepRecentMessages: 2, threshold: 5 }
      }
    })
    expect(estimateChatContextUsagePercent(messages)).toBe(100)
    expect(maybeCompactChatMessages({ messages, settings })[0]?.parts).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("NEW_TOOL_FACT")
      })
    ])
  })

  it("retains new decisions even when the previous summary fills its budget", () => {
    const messages: UIMessage[] = [
      buildTextMessage({
        id: AUTO_COMPACT_MESSAGE_ID,
        role: "system",
        text: "OLD".repeat(2000)
      }),
      buildTextMessage({
        id: "decision",
        role: "user",
        text: `NEW_CRITICAL_DECISION ${"x".repeat(4000)}`
      }),
      buildTextMessage({ id: "recent-user", role: "user", text: "next" }),
      buildTextMessage({
        id: "recent-assistant",
        role: "assistant",
        text: "next"
      })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: { enabled: true, keepRecentMessages: 2, threshold: 5 }
      }
    })
    const compacted = maybeCompactChatMessages({ messages, settings })
    expect(compacted[0]?.parts).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("NEW_CRITICAL_DECISION")
      })
    ])
  })

  it("leaves pending approval calls available for continuation", () => {
    const messages: UIMessage[] = [
      {
        id: "pending",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "bash-1",
            state: "approval-requested",
            input: { command: "echo test" },
            approval: { id: "approval-1" }
          }
        ]
      },
      buildTextMessage({ id: "large", role: "user", text: "x".repeat(24000) }),
      buildTextMessage({ id: "recent", role: "assistant", text: "next" })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: { enabled: true, keepRecentMessages: 2, threshold: 5 }
      }
    })
    expect(maybeCompactChatMessages({ messages, settings })).toBe(messages)
  })
  it("keeps messages unchanged below the configured threshold", () => {
    const messages: UIMessage[] = [
      buildTextMessage({
        id: "message-1",
        role: "user",
        text: "Short request"
      }),
      buildTextMessage({
        id: "message-2",
        role: "assistant",
        text: "Short response"
      })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: {
          enabled: true,
          keepRecentMessages: 2,
          threshold: 95
        }
      }
    })

    expect(estimateChatContextUsagePercent(messages)).toBeLessThan(95)
    expect(
      maybeCompactChatMessages({
        messages,
        settings
      })
    ).toBe(messages)
  })

  it("compacts older messages and keeps configured recent messages", () => {
    const longText = "Important context. ".repeat(180)
    const messages: UIMessage[] = [
      buildTextMessage({
        id: "message-1",
        role: "user",
        text: `${longText}First decision`
      }),
      buildTextMessage({
        id: "message-2",
        role: "assistant",
        text: `${longText}First answer`
      }),
      buildTextMessage({
        id: "message-3",
        role: "user",
        text: `${longText}Second decision`
      }),
      buildTextMessage({
        id: "message-4",
        role: "assistant",
        text: "Recent answer"
      }),
      buildTextMessage({
        id: "message-5",
        role: "user",
        text: "Recent follow-up"
      })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: {
          enabled: true,
          keepRecentMessages: 2,
          threshold: 5
        }
      }
    })

    const compactedMessages = maybeCompactChatMessages({
      messages,
      settings
    })

    expect(compactedMessages).toHaveLength(3)
    expect(compactedMessages[0]?.id).toBe(AUTO_COMPACT_MESSAGE_ID)
    expect(compactedMessages[0]?.role).toBe("system")
    expect(compactedMessages[0]?.parts).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("Compacted messages: 3"),
        type: "text"
      })
    ])
    expect(compactedMessages.slice(1).map((message) => message.id)).toEqual([
      "message-4",
      "message-5"
    ])
  })

  it("uses the deterministic summary when no memory tool model is available", async () => {
    const messages: UIMessage[] = [
      buildTextMessage({
        id: "message-1",
        role: "user",
        text: "Durable preference. ".repeat(180)
      }),
      buildTextMessage({
        id: "message-2",
        role: "assistant",
        text: "Stored preference. ".repeat(180)
      }),
      buildTextMessage({
        id: "message-3",
        role: "user",
        text: "Recent follow-up"
      }),
      buildTextMessage({
        id: "message-4",
        role: "assistant",
        text: "Recent answer"
      })
    ]
    const settings = AppSettingsSchema.parse({
      chat: {
        autoCompact: {
          enabled: true,
          keepRecentMessages: 2,
          threshold: 5
        }
      }
    })

    const compactedMessages = await compactChatMessages({
      messages,
      settings
    })

    expect(compactedMessages).toHaveLength(3)
    expect(compactedMessages[0]?.id).toBe(AUTO_COMPACT_MESSAGE_ID)
    expect(compactedMessages[0]?.parts).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("Original roles: user: 1, assistant: 1"),
        type: "text"
      })
    ])
    expect(compactedMessages.slice(1).map((message) => message.id)).toEqual([
      "message-3",
      "message-4"
    ])
  })
})
