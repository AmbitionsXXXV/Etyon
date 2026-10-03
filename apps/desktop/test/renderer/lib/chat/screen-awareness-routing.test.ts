import { describe, expect, it } from "vite-plus/test"

import { selectScreenAwarenessSession } from "@/renderer/lib/chat/screen-awareness-routing"

const now = Date.parse("2026-10-02T12:00:00Z")
const sessions = [
  {
    id: "one",
    lastOpenedAt: new Date(now - 30_000).toISOString(),
    projectPath: "/project"
  }
]
describe("screen capture routing", () => {
  it("uses the current chat even when another chat was opened more recently", () => {
    expect(
      selectScreenAwarenessSession({ now, pathname: "/chat/one", sessions })
    ).toEqual({ sessionId: "one" })
  })
  it("reuses a recently opened chat from the home page", () => {
    expect(
      selectScreenAwarenessSession({ now, pathname: "/", sessions })
    ).toEqual({ sessionId: "one" })
  })
  it("creates a chat in the previous project when the recent window expired", () => {
    expect(
      selectScreenAwarenessSession({
        now: now + 120_000,
        pathname: "/",
        sessions
      })
    ).toEqual({ projectPath: "/project" })
  })
  it("restores a capture to its assigned chat rather than the current chat", () => {
    expect(
      selectScreenAwarenessSession({
        assignedSessionId: "one",
        now,
        pathname: "/chat/two",
        sessions
      })
    ).toEqual({ sessionId: "one" })
  })
  it("discards captures assigned to an archived or deleted chat", () => {
    expect(
      selectScreenAwarenessSession({
        assignedSessionId: "removed-chat",
        now,
        pathname: "/chat/one",
        sessions
      })
    ).toEqual({ discard: true })
    expect(
      selectScreenAwarenessSession({
        assignedSessionId: "removed-chat",
        now,
        pathname: "/",
        sessions: []
      })
    ).toEqual({ discard: true })
  })
})
