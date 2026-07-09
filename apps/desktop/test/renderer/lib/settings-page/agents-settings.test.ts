import { AgentSettingsSchema } from "@etyon/rpc"
import type { AgentSettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  clampAgentMaxSteps,
  clampConcurrentSubagents,
  getAgentProfileMetrics,
  isBuiltInProfileId,
  setAgentProfileAvailability
} from "@/renderer/lib/settings-page/agents-settings"
import { resolveProfileRoster } from "@/shared/agents/profiles"

const makeSettings = (overrides: Partial<AgentSettings> = {}): AgentSettings =>
  AgentSettingsSchema.parse({ ...overrides })

describe("agents settings helpers", () => {
  it("clamps the max steps setting", () => {
    expect(clampAgentMaxSteps(0)).toBe(1)
    expect(clampAgentMaxSteps(8.5)).toBe(9)
    expect(clampAgentMaxSteps(999)).toBe(200)
  })

  it("clamps the concurrent subagents setting", () => {
    expect(clampConcurrentSubagents(0)).toBe(1)
    expect(clampConcurrentSubagents(2)).toBe(2)
    expect(clampConcurrentSubagents(9)).toBe(4)
  })

  it("recognizes built-in profile ids", () => {
    expect(isBuiltInProfileId("general-purpose")).toBe(true)
    expect(isBuiltInProfileId("explore")).toBe(true)
    expect(isBuiltInProfileId("totally-custom")).toBe(false)
  })

  it("counts active, custom, and delegation profiles", () => {
    const metrics = getAgentProfileMetrics(makeSettings())

    expect(metrics.active).toBeGreaterThan(0)
    expect(metrics.custom).toBe(0)
    expect(metrics.delegation).toBeGreaterThan(0)
  })

  it("disabling a built-in profile seeds an override and drops it from active", () => {
    const settings = makeSettings()
    const explore = resolveProfileRoster(settings).find(
      (profile) => profile.id === "explore"
    )

    if (!explore) {
      throw new Error("expected built-in explore profile")
    }

    const profiles = setAgentProfileAvailability(settings, explore, false)
    const updated = makeSettings({ profiles })

    expect(profiles.some((profile) => profile.id === "explore")).toBe(true)
    expect(getAgentProfileMetrics(updated).active).toBe(
      getAgentProfileMetrics(settings).active - 1
    )
  })
})
