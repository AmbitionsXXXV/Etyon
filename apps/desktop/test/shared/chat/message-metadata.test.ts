import { describe, expect, it } from "vite-plus/test"

import {
  attachAgentProjectionToAssistantMessages,
  attachWorkTimeToLatestAssistantMessage
} from "@/shared/chat/message-metadata"

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

  it("attaches agent projection metadata to new assistant messages", () => {
    expect(
      attachAgentProjectionToAssistantMessages(
        [
          {
            id: "user-1",
            role: "user"
          },
          {
            id: "assistant-1",
            metadata: {
              workTimeMs: 10
            },
            role: "assistant"
          },
          {
            id: "assistant-2",
            role: "assistant"
          }
        ],
        {
          runId: "run-1",
          startIndex: 2
        }
      )
    ).toEqual([
      {
        id: "user-1",
        role: "user"
      },
      {
        id: "assistant-1",
        metadata: {
          workTimeMs: 10
        },
        role: "assistant"
      },
      {
        id: "assistant-2",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        role: "assistant"
      }
    ])
  })
})
