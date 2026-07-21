import { describe, expect, it } from "vite-plus/test"

import { shouldSyncPersistedMessagesAfterFinish } from "@/renderer/lib/chat/message-persistence"

describe("chat message persistence", () => {
  it("keeps live agent messages when the request fails", () => {
    expect(
      shouldSyncPersistedMessagesAfterFinish({
        agentMode: "agent",
        isError: true
      })
    ).toBe(false)
  })

  it("syncs repaired persistence only after a successful agent request", () => {
    expect(
      shouldSyncPersistedMessagesAfterFinish({
        agentMode: "agent",
        isError: false
      })
    ).toBe(true)
    expect(
      shouldSyncPersistedMessagesAfterFinish({
        agentMode: "chat",
        isError: false
      })
    ).toBe(false)
  })
})
