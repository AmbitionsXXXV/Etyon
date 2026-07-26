import { describe, expect, it } from "vite-plus/test"

import type { BrowserLruEntry } from "@/main/browser/lru"
import { selectBrowserViewToEvict } from "@/main/browser/lru"

const entry = (overrides: Partial<BrowserLruEntry>): BrowserLruEntry => ({
  activeLeaseCount: 0,
  isVisible: false,
  lastUsedAt: 0,
  sessionId: "session",
  ...overrides
})

describe("selectBrowserViewToEvict", () => {
  it("returns null when live count is at or below the max", () => {
    const entries = [
      entry({ lastUsedAt: 1, sessionId: "a" }),
      entry({ lastUsedAt: 2, sessionId: "b" }),
      entry({ lastUsedAt: 3, sessionId: "c" })
    ]

    expect(selectBrowserViewToEvict({ entries, selectedSessionId: null })).toBe(
      null
    )
  })

  it("evicts the least-recently-used eligible session", () => {
    const entries = [
      entry({ lastUsedAt: 40, sessionId: "d" }),
      entry({ lastUsedAt: 10, sessionId: "a" }),
      entry({ lastUsedAt: 30, sessionId: "c" }),
      entry({ lastUsedAt: 20, sessionId: "b" })
    ]

    expect(selectBrowserViewToEvict({ entries, selectedSessionId: null })).toBe(
      "a"
    )
  })

  it("skips the visible session", () => {
    const entries = [
      entry({ isVisible: true, lastUsedAt: 10, sessionId: "a" }),
      entry({ lastUsedAt: 20, sessionId: "b" }),
      entry({ lastUsedAt: 30, sessionId: "c" }),
      entry({ lastUsedAt: 40, sessionId: "d" })
    ]

    expect(selectBrowserViewToEvict({ entries, selectedSessionId: null })).toBe(
      "b"
    )
  })

  it("skips a leased session", () => {
    const entries = [
      entry({ activeLeaseCount: 1, lastUsedAt: 10, sessionId: "a" }),
      entry({ lastUsedAt: 20, sessionId: "b" }),
      entry({ lastUsedAt: 30, sessionId: "c" }),
      entry({ lastUsedAt: 40, sessionId: "d" })
    ]

    expect(selectBrowserViewToEvict({ entries, selectedSessionId: null })).toBe(
      "b"
    )
  })

  it("skips the selected session", () => {
    const entries = [
      entry({ lastUsedAt: 10, sessionId: "a" }),
      entry({ lastUsedAt: 20, sessionId: "b" }),
      entry({ lastUsedAt: 30, sessionId: "c" }),
      entry({ lastUsedAt: 40, sessionId: "d" })
    ]

    expect(selectBrowserViewToEvict({ entries, selectedSessionId: "a" })).toBe(
      "b"
    )
  })

  it("returns null when nothing is eligible", () => {
    const entries = [
      entry({ isVisible: true, lastUsedAt: 10, sessionId: "a" }),
      entry({ isVisible: true, lastUsedAt: 20, sessionId: "b" }),
      entry({ activeLeaseCount: 1, lastUsedAt: 30, sessionId: "c" }),
      entry({ lastUsedAt: 40, sessionId: "d" })
    ]

    expect(selectBrowserViewToEvict({ entries, selectedSessionId: "d" })).toBe(
      null
    )
  })
})
