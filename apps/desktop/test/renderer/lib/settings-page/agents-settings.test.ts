import { describe, expect, it } from "vite-plus/test"

import {
  clampAgentMaxAutomaticRetries,
  clampAgentMaxConcurrentSubagents,
  clampAgentMaxSteps
} from "@/renderer/lib/settings-page/agents-settings"

describe("agents settings helpers", () => {
  it("clamps numeric agent runtime settings", () => {
    expect(clampAgentMaxAutomaticRetries(-1)).toBe(0)
    expect(clampAgentMaxAutomaticRetries(2.6)).toBe(3)
    expect(clampAgentMaxAutomaticRetries(9)).toBe(5)

    expect(clampAgentMaxConcurrentSubagents(0)).toBe(1)
    expect(clampAgentMaxConcurrentSubagents(2.4)).toBe(2)
    expect(clampAgentMaxConcurrentSubagents(9)).toBe(4)

    expect(clampAgentMaxSteps(0)).toBe(1)
    expect(clampAgentMaxSteps(8.5)).toBe(9)
    expect(clampAgentMaxSteps(99)).toBe(20)
  })
})
