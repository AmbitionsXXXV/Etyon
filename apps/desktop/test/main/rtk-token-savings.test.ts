import { describe, expect, it } from "vite-plus/test"

import {
  getCliNameFromCommand,
  normalizeRtkCommandLabel,
  parseRtkCommandEntries,
  parseRtkGainJson,
  parseRtkRecentCommands,
  parseTimeMs,
  parseTokenAmount
} from "@/main/rtk-token-savings"

const RTK_GAIN_HISTORY_OUTPUT = `
RTK Token Savings (Global Scope)
════════════════════════════════════════════════════════════

By Command
────────────────────────────────────────────────────────────────────────
  #  Command                   Count   Saved    Avg%    Time  Impact
────────────────────────────────────────────────────────────────────────
 1.  rtk ls -la .                 30    1.6M    8.2%     0ms  ██████████
 2.  rtk ls -la doc/              12  754.1K   44.4%    33ms  █████░░░░░
 3.  rtk find components          2      10    10.0%      1s  ░░░░░░░░░░
────────────────────────────────────────────────────────────────────────

Recent Commands
──────────────────────────────────────────────────────────
05-19 09:01 ▲ rtk ls                    -94% (31)
05-19 08:38 • rtk fallback: vp run w... -0% (0)
`

describe("rtk token savings", () => {
  it("normalizes rtk command labels back to original commands", () => {
    expect(normalizeRtkCommandLabel("rtk ls")).toBe("ls")
    expect(normalizeRtkCommandLabel("rtk fallback: vp run w...")).toBe(
      "vp run w..."
    )
    expect(normalizeRtkCommandLabel("vp run check")).toBe("vp run check")
    expect(getCliNameFromCommand("rtk ls -la doc/")).toBe("ls")
    expect(getCliNameFromCommand("rtk fallback: vp run check")).toBe("vp")
    expect(
      getCliNameFromCommand("curl -L --max-time 30 https://example.com")
    ).toBe("curl")
    expect(
      getCliNameFromCommand("curl -L--max-time 30 https://example.com")
    ).toBe("curl")
    expect(
      getCliNameFromCommand("/opt/homebrew/bin/curl -fsSL https://example.com")
    ).toBe("curl")
  })

  it("parses compact token and time values", () => {
    expect(parseTokenAmount("1.6M")).toBe(1_600_000)
    expect(parseTokenAmount("754.1K")).toBe(754_100)
    expect(parseTimeMs("33ms")).toBe(33)
    expect(parseTimeMs("1.5s")).toBe(1500)
    expect(parseTimeMs("2m03s")).toBe(123_000)
  })

  it("parses rtk daily json", () => {
    const parsed = parseRtkGainJson(
      JSON.stringify({
        daily: [
          {
            avg_time_ms: 1244,
            commands: 37,
            date: "2026-05-19",
            input_tokens: 7169,
            output_tokens: 7116,
            saved_tokens: 786,
            savings_pct: 10.96,
            total_time_ms: 46_042
          }
        ],
        summary: {
          avg_savings_pct: 70.5,
          avg_time_ms: 13_682,
          total_commands: 1604,
          total_input: 4_689_747,
          total_output: 1_384_235,
          total_saved: 3_306_629,
          total_time_ms: 21_946_473
        }
      })
    )

    expect(parsed.summary.totalSavedTokens).toBe(3_306_629)
    expect(parsed.daily[0].date).toBe("2026-05-19")
  })

  it("parses command ranking and recent command text", () => {
    const commands = parseRtkCommandEntries(RTK_GAIN_HISTORY_OUTPUT)
    const recentCommands = parseRtkRecentCommands(RTK_GAIN_HISTORY_OUTPUT)

    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({
      averageTimeMs: 9,
      command: "ls",
      count: 42,
      impact: "██████████",
      savedTokens: 2_354_100
    })
    expect(commands[0].averageReductionPercent).toBeCloseTo(18.54, 2)
    expect(commands[1]).toMatchObject({
      averageReductionPercent: 10,
      averageTimeMs: 1000,
      command: "find",
      count: 2,
      impact: "░░░░░░░░░░",
      savedTokens: 10
    })
    expect(recentCommands).toEqual([
      {
        command: "ls",
        reductionPercent: 94,
        savedTokens: 31,
        timestampLabel: "05-19 09:01"
      },
      {
        command: "vp run w...",
        reductionPercent: 0,
        savedTokens: 0,
        timestampLabel: "05-19 08:38"
      }
    ])
  })
})
