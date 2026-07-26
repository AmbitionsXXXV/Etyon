import { describe, expect, it } from "vite-plus/test"

import {
  createSeenTracker,
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_FADE_IN,
  MOTION_RISE_IN,
  MOTION_RISE_PX,
  MOTION_ROW_RISE_IN,
  MOTION_ROW_RISE_PX,
  MOTION_SCALE_IN,
  MOTION_SLIDE_PX
} from "@/renderer/lib/motion"

const CHAT_DURATION_BUDGET_SECONDS = 0.24
const TRAVEL_BUDGET_PX = 12

describe("motion tokens", () => {
  it("keeps every chat duration inside the 240ms budget", () => {
    const chatDurations = [
      MOTION_DURATION.fast,
      MOTION_DURATION.base,
      MOTION_DURATION.gentle
    ]

    for (const duration of chatDurations) {
      expect(duration).toBeLessThanOrEqual(CHAT_DURATION_BUDGET_SECONDS)
    }
  })

  it("orders the durations from fast to gentle", () => {
    expect(MOTION_DURATION.fast).toBeLessThan(MOTION_DURATION.base)
    expect(MOTION_DURATION.base).toBeLessThan(MOTION_DURATION.gentle)
    expect(MOTION_DURATION.gentle).toBeLessThan(MOTION_DURATION.entrance)
  })

  it("keeps every travel token inside the 12px budget", () => {
    for (const travel of [
      MOTION_RISE_PX,
      MOTION_ROW_RISE_PX,
      MOTION_SLIDE_PX
    ]) {
      expect(travel).toBeLessThanOrEqual(TRAVEL_BUDGET_PX)
    }
  })

  it("shapes the presets as initial/animate/transition triples on one curve", () => {
    for (const preset of [
      MOTION_FADE_IN,
      MOTION_RISE_IN,
      MOTION_ROW_RISE_IN,
      MOTION_SCALE_IN
    ]) {
      expect(preset.initial.opacity).toBe(0)
      expect(preset.animate.opacity).toBe(1)
      expect(preset.transition.ease).toBe(MOTION_EASE)
      expect(preset.transition.duration).toBeLessThanOrEqual(
        CHAT_DURATION_BUDGET_SECONDS
      )
    }
  })

  it("rises from the token distances and never overshoots the scale", () => {
    expect(MOTION_RISE_IN.initial.y).toBe(MOTION_RISE_PX)
    expect(MOTION_RISE_IN.animate.y).toBe(0)
    expect(MOTION_ROW_RISE_IN.initial.y).toBe(MOTION_ROW_RISE_PX)
    expect(MOTION_SCALE_IN.initial.scale).toBeLessThan(1)
    expect(MOTION_SCALE_IN.animate.scale).toBe(1)
  })
})

describe("createSeenTracker", () => {
  it("treats the ids it was seeded with as already seen", () => {
    const tracker = createSeenTracker(["a", "b"])

    expect(tracker.hasSeen("a")).toBe(true)
    expect(tracker.hasSeen("b")).toBe(true)
    expect(tracker.hasSeen("c")).toBe(false)
  })

  it("starts empty when no ids are given", () => {
    expect(createSeenTracker().hasSeen("a")).toBe(false)
  })

  it("remembers an id once it is marked", () => {
    const tracker = createSeenTracker()

    tracker.markSeen("a")

    expect(tracker.hasSeen("a")).toBe(true)
  })

  it("is idempotent, so a repeated render cannot flip an answer", () => {
    const tracker = createSeenTracker()

    tracker.markSeen("a")
    tracker.markSeen("a")

    expect(tracker.hasSeen("a")).toBe(true)
    expect(tracker.hasSeen("b")).toBe(false)
  })

  it("does not share state between trackers", () => {
    const first = createSeenTracker(["a"])
    const second = createSeenTracker()

    second.markSeen("b")

    expect(first.hasSeen("b")).toBe(false)
    expect(second.hasSeen("a")).toBe(false)
  })
})
