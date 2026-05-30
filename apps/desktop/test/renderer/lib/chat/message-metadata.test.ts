import { describe, expect, it } from "vite-plus/test"

import { parseChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"

describe("chat message metadata", () => {
  it("preserves agent projection metadata for persisted chat messages", () => {
    expect(
      parseChatMessageMetadata({
        agentProjection: {
          runId: "run-1",
          source: "agent_events"
        },
        workTimeMs: 1280
      })
    ).toEqual({
      agentProjection: {
        runId: "run-1",
        source: "agent_events"
      },
      mentions: undefined,
      workTimeMs: 1280
    })
  })
})
