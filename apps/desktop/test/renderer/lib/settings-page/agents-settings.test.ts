import { describe, expect, it } from "vite-plus/test"

import { clampAgentMaxSteps } from "@/renderer/lib/settings-page/agents-settings"

describe("agents settings helpers", () => {
  it("clamps the max steps setting", () => {
    expect(clampAgentMaxSteps(0)).toBe(1)
    expect(clampAgentMaxSteps(8.5)).toBe(9)
    expect(clampAgentMaxSteps(99)).toBe(20)
  })
})
