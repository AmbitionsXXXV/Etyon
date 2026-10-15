import { describe, expect, it } from "vite-plus/test"

import { adviseCompactWindow } from "@/shared/tuning/compact-replay"
import type { ReplayCall } from "@/shared/tuning/compact-replay"

const CLAUDE_OPTIONS = {
  current: 200_000,
  max: 1_000_000,
  min: 100_000,
  reserve: 33_000,
  step: 10_000,
  window: 200_000
}

/** Streams that grow by `growth` a call and compact at `compactAt`. */
const buildCalls = ({
  calls,
  compactAt,
  growth,
  streams
}: {
  calls: number
  compactAt: number
  growth: number
  streams: number
}): ReplayCall[] =>
  Array.from({ length: streams }, (_stream, stream) => {
    let prompt = 20_000
    return Array.from({ length: calls }, (_call, index) => {
      const call: ReplayCall = {
        compactMs: 0,
        model: "claude-sonnet-5",
        out: 800,
        prompt,
        stream: `s${stream}`,
        time: index,
        wrote: 0,
        wrote1h: 0
      }
      prompt = prompt + growth > compactAt ? 45_000 : prompt + growth
      return call
    })
  }).flat()

describe("adviseCompactWindow", () => {
  it("needs at least 50 calls", () => {
    expect(
      adviseCompactWindow(
        buildCalls({ calls: 10, compactAt: 167_000, growth: 4000, streams: 2 }),
        CLAUDE_OPTIONS
      )
    ).toBeNull()
  })

  it("observes the agent's compactions and keeps the advice inside its range", () => {
    const advice = adviseCompactWindow(
      buildCalls({ calls: 120, compactAt: 167_000, growth: 6000, streams: 4 }),
      CLAUDE_OPTIONS
    )
    expect(advice).not.toBeNull()
    expect(advice?.facts.compacts).toBeGreaterThan(5)
    expect(advice?.facts.after).toBe(45_000)
    expect(advice?.best).toBeGreaterThanOrEqual(CLAUDE_OPTIONS.min)
    expect(advice?.best).toBeLessThanOrEqual(CLAUDE_OPTIONS.window)
    expect(advice?.curve.length).toBeGreaterThan(0)
  })

  it("keeps the current window when no change saves 3%", () => {
    const advice = adviseCompactWindow(
      buildCalls({ calls: 60, compactAt: 1_000_000, growth: 500, streams: 2 }),
      CLAUDE_OPTIONS
    )
    expect(advice?.facts.compacts).toBe(0)
    expect(advice?.best).toBe(CLAUDE_OPTIONS.current)
  })
})
