import { describe, expect, it } from "vite-plus/test"

import {
  attachAgentProjectionToAssistantMessages,
  attachRunOutcomeToLatestAssistantMessage,
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

  it("stamps run outcome alongside work time on the latest assistant", () => {
    expect(
      attachRunOutcomeToLatestAssistantMessage(
        [
          { id: "user-1", role: "user" },
          {
            id: "assistant-1",
            metadata: { mentions: [] },
            role: "assistant"
          }
        ],
        {
          exitReason: "aborted",
          thoughtDurationsMs: [200, 500],
          workTimeMs: 1280
        }
      )
    ).toEqual([
      { id: "user-1", role: "user" },
      {
        id: "assistant-1",
        metadata: {
          exitReason: "aborted",
          mentions: [],
          thoughtDurationsMs: [200, 500],
          workTimeMs: 1280
        },
        role: "assistant"
      }
    ])
  })

  it("omits an empty exit reason and empty thought durations", () => {
    expect(
      attachRunOutcomeToLatestAssistantMessage(
        [{ id: "assistant-1", role: "assistant" }],
        { exitReason: null, thoughtDurationsMs: [], workTimeMs: 42 }
      )
    ).toEqual([
      { id: "assistant-1", metadata: { workTimeMs: 42 }, role: "assistant" }
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
