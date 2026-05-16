import { describe, expect, it } from "vite-plus/test"

import {
  ChatSessionMemoryOutputSchema,
  ChatSessionMessagesOutputSchema
} from "../../src/schemas/chat-sessions"

describe("chat session schemas", () => {
  it("accepts persisted UI messages with optional metadata", () => {
    expect(
      ChatSessionMessagesOutputSchema.parse({
        messages: [
          {
            id: "message-1",
            metadata: {
              mentions: []
            },
            parts: [
              {
                text: "hello",
                type: "text"
              }
            ],
            role: "user"
          }
        ],
        sessionId: "session-1"
      })
    ).toMatchObject({
      messages: [
        {
          id: "message-1",
          role: "user"
        }
      ],
      sessionId: "session-1"
    })
  })

  it("accepts nullable session memory output", () => {
    expect(
      ChatSessionMemoryOutputSchema.parse({
        memory: null,
        sessionId: "session-1"
      })
    ).toEqual({
      memory: null,
      sessionId: "session-1"
    })
  })
})
