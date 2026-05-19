import { describe, expect, it } from "vite-plus/test"

import { RtkTokenSavingsOutputSchema } from "../../src/schemas/token-savings"

describe("token savings schemas", () => {
  it("validates rtk token savings output", () => {
    const parsed = RtkTokenSavingsOutputSchema.parse({
      available: true,
      commands: [
        {
          averageReductionPercent: 70.5,
          averageTimeMs: 12,
          command: "rtk ls",
          count: 14,
          impact: "████",
          savedTokens: 4200
        }
      ],
      daily: [
        {
          averageTimeMs: 1200,
          commands: 5,
          date: "2026-05-19",
          inputTokens: 6800,
          outputTokens: 2600,
          savedTokens: 4200,
          savingsPercent: 61.6,
          totalTimeMs: 6000
        }
      ],
      error: null,
      generatedAt: "2026-05-19T14:43:00.000Z",
      recentCommands: [
        {
          command: "rtk ls",
          reductionPercent: 70.3,
          savedTokens: 206,
          timestampLabel: "05-19 22:43"
        }
      ],
      scope: "global",
      summary: {
        averageSavingsPercent: 61.6,
        averageTimeMs: 8500,
        totalCommands: 14,
        totalInputTokens: 6800,
        totalOutputTokens: 2600,
        totalSavedTokens: 4200,
        totalTimeMs: 119_000
      }
    })

    expect(parsed.summary.totalSavedTokens).toBe(4200)
    expect(parsed.commands[0].command).toBe("rtk ls")
  })
})
