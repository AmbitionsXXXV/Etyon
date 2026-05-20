import { AppSettingsSchema } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  AUTO_COMPACT_MESSAGE_ID,
  compactChatMessages,
  estimateChatContextUsagePercent,
  maybeCompactChatMessages
} from "@/main/chat-auto-compact"

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
