import { describe, expect, it } from "vite-plus/test"

import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"

describe("attachWorkTimeToLatestAssistantMessage", () => {
  it("attaches workTimeMs to the latest assistant message", () => {
    expect(
      attachWorkTimeToLatestAssistantMessage(
        [
          {
            id: "user-1",
            role: "user"
          },
          {
            id: "assistant-1",
            metadata: {
              mentions: []
            },
            role: "assistant"
          }
        ],
        1280
      )
    ).toEqual([
      {
        id: "user-1",
        role: "user"
      },
      {
        id: "assistant-1",
        metadata: {
          mentions: [],
          workTimeMs: 1280
        },
        role: "assistant"
      }
    ])
  })
})
