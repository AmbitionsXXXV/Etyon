import { describe, expect, it } from "vite-plus/test"

import { TerminalEnsureInputSchema } from "../../src/schemas/terminal"

describe("terminal schemas", () => {
  it("accepts an isolated runtime session owned by a chat session", () => {
    expect(
      TerminalEnsureInputSchema.parse({
        chatSessionId: "chat-1",
        cols: 120,
        rows: 36,
        sessionId: "chat-1:panel:terminal:2"
      })
    ).toEqual({
      chatSessionId: "chat-1",
      cols: 120,
      rows: 36,
      sessionId: "chat-1:panel:terminal:2"
    })
  })

  it("keeps the legacy chat-session input valid", () => {
    expect(
      TerminalEnsureInputSchema.parse({
        cols: 80,
        rows: 24,
        sessionId: "chat-1"
      }).chatSessionId
    ).toBeUndefined()
  })
})
