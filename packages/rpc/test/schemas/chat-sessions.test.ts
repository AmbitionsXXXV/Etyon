import { describe, expect, it } from "vite-plus/test"

import {
  ChatMentionSchema,
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

  it("accepts explicit skill mentions", () => {
    expect(
      ChatMentionSchema.parse({
        description: "Use project-specific coding conventions.",
        kind: "skill",
        name: "coding-guidelines",
        path: "/tmp/project/.agents/skills/coding-guidelines/SKILL.md",
        projectPath: "/tmp/project",
        relativePath: "coding-guidelines",
        scope: "project",
        shortDescription: "Coding conventions"
      })
    ).toMatchObject({
      kind: "skill",
      name: "coding-guidelines",
      scope: "project"
    })
  })
})
