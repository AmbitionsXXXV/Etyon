import { describe, expect, it } from "vite-plus/test"

import {
  buildChatSessionTurns,
  getCurrentSessionTurnIndex,
  getSessionTurnMarkerScale,
  shouldShowSessionTurnIndicator
} from "@/renderer/lib/chat/session-turn-indicator"

describe("session turn indicator", () => {
  it("builds one turn for each user input and its following responses", () => {
    expect(
      buildChatSessionTurns([
        { id: "orphan", role: "assistant", text: "ignored" },
        { id: "user-1", role: "user", text: " First question\n" },
        { id: "assistant-1", role: "assistant", text: "First answer" },
        { id: "assistant-2", role: "assistant", text: "continued" },
        { id: "user-2", role: "user", text: "Second question" }
      ])
    ).toEqual([
      {
        id: "user-1",
        modelResponsePreview: "First answer continued",
        userInputPreview: "First question",
        userMessageId: "user-1"
      },
      {
        id: "user-2",
        modelResponsePreview: "",
        userInputPreview: "Second question",
        userMessageId: "user-2"
      }
    ])
  })

  it("truncates long previews without leaving trailing whitespace", () => {
    const [turn] = buildChatSessionTurns([
      { id: "user", role: "user", text: "Prompt" },
      { id: "assistant", role: "assistant", text: "a".repeat(240) }
    ])

    expect(turn?.modelResponsePreview).toHaveLength(180)
    expect(turn?.modelResponsePreview.endsWith("…")).toBe(true)
  })

  it("resolves the current turn from the session reading line", () => {
    expect(getCurrentSessionTurnIndex([100, 300, 500], 350)).toBe(1)
    expect(getCurrentSessionTurnIndex([100, 300, 500], 50)).toBe(0)
    expect(getCurrentSessionTurnIndex([], 350)).toBeNull()
  })

  it("creates symmetric fish-eye emphasis around one turn", () => {
    expect(getSessionTurnMarkerScale(5, 5)).toBe(1)
    expect(getSessionTurnMarkerScale(4, 5)).toBe(
      getSessionTurnMarkerScale(6, 5)
    )
    expect(getSessionTurnMarkerScale(2, 5)).toBeGreaterThan(
      getSessionTurnMarkerScale(1, 5)
    )
  })

  it("only shows navigation for substantially overflowing sessions", () => {
    expect(shouldShowSessionTurnIndicator(899, 600)).toBe(false)
    expect(shouldShowSessionTurnIndicator(900, 600)).toBe(true)
    expect(shouldShowSessionTurnIndicator(1200, 0)).toBe(false)
  })
})
