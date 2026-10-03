import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  clearScreenAwarenessCaptures,
  consumeScreenAwarenessCapture,
  getPendingScreenAwarenessCaptures,
  getPendingScreenAwarenessCapture,
  isFreshScreenAwarenessCapture,
  removeScreenAwarenessContent,
  stageScreenAwarenessCapture
} from "@/renderer/lib/chat/screen-awareness-capture-store"
import type { ScreenAwarenessCapturePayload } from "@/shared/screen-awareness"

const capture = (
  id: string,
  sessionId = "session-1"
): ScreenAwarenessCapturePayload => ({
  accessibleText: "Document content",
  capturedAt: new Date().toISOString(),
  dataUrl: "data:image/png;base64,AAAA",
  id,
  mediaType: "image/png",
  sessionId,
  sourceAppName: "TextEdit",
  windowTitle: "Document"
})

afterEach(() => {
  clearScreenAwarenessCaptures()
  vi.useRealTimers()
})

describe("screen awareness capture store", () => {
  it("keeps multiple captures in order and isolates chat sessions", () => {
    stageScreenAwarenessCapture(capture("one"))
    stageScreenAwarenessCapture(capture("two", "session-2"))
    stageScreenAwarenessCapture(capture("three"))
    expect(
      getPendingScreenAwarenessCaptures("session-1").map((entry) => entry.id)
    ).toEqual(["one", "three"])
    expect(
      getPendingScreenAwarenessCaptures("session-2").map((entry) => entry.id)
    ).toEqual(["two"])
    consumeScreenAwarenessCapture("unknown")
    expect(getPendingScreenAwarenessCaptures()).toHaveLength(3)
  })
  it("removes image and text independently and discards empty captures", () => {
    stageScreenAwarenessCapture(capture("one"))
    removeScreenAwarenessContent("one", "image")
    expect(getPendingScreenAwarenessCaptures()[0]?.dataUrl).toBeUndefined()
    expect(getPendingScreenAwarenessCaptures()[0]?.accessibleText).toBe(
      "Document content"
    )
    removeScreenAwarenessContent("one", "text")
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
  })
  it("deduplicates replayed captures and enforces the staging limit", () => {
    for (const id of ["one", "two", "three", "four", "five"]) {
      stageScreenAwarenessCapture(capture(id))
    }
    stageScreenAwarenessCapture(capture("one"))
    expect(getPendingScreenAwarenessCaptures()).toHaveLength(4)
    expect(
      getPendingScreenAwarenessCaptures().some((entry) => entry.id === "five")
    ).toBe(false)
  })
  it("rejects illegal, expired, future and empty payloads", () => {
    for (const capturedAt of [
      "invalid",
      new Date(Date.now() - 700_000).toISOString(),
      new Date(Date.now() + 1000).toISOString()
    ]) {
      stageScreenAwarenessCapture({ ...capture(capturedAt), capturedAt })
    }
    stageScreenAwarenessCapture({
      ...capture(""),
      dataUrl: undefined,
      accessibleText: ""
    })
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
    expect(
      isFreshScreenAwarenessCapture({ ...capture("bad"), selectedText: 12 })
    ).toBe(false)
    expect(
      isFreshScreenAwarenessCapture({ ...capture("bad"), sessionId: "" })
    ).toBe(false)
  })
  it("filters expiry on every read while keeping fresh snapshots stable", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"))
    stageScreenAwarenessCapture(capture("one"))
    const first = getPendingScreenAwarenessCaptures("session-1")
    expect(getPendingScreenAwarenessCaptures("session-1")).toBe(first)
    vi.setSystemTime(new Date("2026-10-03T00:10:00Z"))
    expect(getPendingScreenAwarenessCaptures("session-1")).toEqual([])
    expect(getPendingScreenAwarenessCapture()).toBeNull()
  })
  it("clears both global captures and session snapshots when disabled", () => {
    stageScreenAwarenessCapture(capture("one"))
    stageScreenAwarenessCapture(capture("two", "session-2"))
    clearScreenAwarenessCaptures()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
    expect(getPendingScreenAwarenessCaptures("session-1")).toEqual([])
    expect(getPendingScreenAwarenessCaptures("session-2")).toEqual([])
    expect(getPendingScreenAwarenessCapture()).toBeNull()
  })
  it("does not revive a removed screenshot when an old revision is replayed", () => {
    const original = { ...capture("one"), revision: 2 }
    stageScreenAwarenessCapture(original)
    removeScreenAwarenessContent("one", "image")
    stageScreenAwarenessCapture(original)
    expect(getPendingScreenAwarenessCaptures()).toMatchObject([
      { dataUrl: undefined, revision: 3 }
    ])
    expect(isFreshScreenAwarenessCapture({ ...original, revision: -1 })).toBe(
      false
    )
  })
})
