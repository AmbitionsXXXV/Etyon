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

  it("parses the run outcome and thinking durations", () => {
    expect(
      parseChatMessageMetadata({
        exitReason: "aborted",
        thoughtDurationsMs: [200, -5, "bad", 500],
        workTimeMs: 900
      })
    ).toMatchObject({
      exitReason: "aborted",
      thoughtDurationsMs: [200, 500],
      workTimeMs: 900
    })
  })

  it("ignores an unknown exit reason", () => {
    expect(
      parseChatMessageMetadata({ exitReason: "explode" })?.exitReason
    ).toBeUndefined()
  })
})
