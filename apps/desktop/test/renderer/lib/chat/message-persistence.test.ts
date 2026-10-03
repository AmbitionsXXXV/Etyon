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

  it("syncs canonical persistence after successful requests in every mode", () => {
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
    ).toBe(true)
    expect(
      shouldSyncPersistedMessagesAfterFinish({
        agentMode: "plan",
        isError: false
      })
    ).toBe(true)
  })
})
