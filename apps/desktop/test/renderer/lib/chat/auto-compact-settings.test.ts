import { describe, expect, it } from "vite-plus/test"

import { getRecommendedAutoCompact } from "@/renderer/lib/chat/auto-compact-settings"

describe("getRecommendedAutoCompact", () => {
  it("falls back to 80% when the context window is unknown", () => {
    expect(getRecommendedAutoCompact()).toEqual({
      keepRecentMessages: 4,
      reserveTokens: null,
      threshold: 80
    })
  })

  it("leaves about 40K tokens free on a 200K window", () => {
    expect(getRecommendedAutoCompact(200_000)).toEqual({
      keepRecentMessages: 4,
      reserveTokens: 40_000,
      threshold: 80
    })
  })

  it("caps large windows at 90% and small windows by ratio", () => {
    expect(getRecommendedAutoCompact(1_000_000).threshold).toBe(90)
    expect(getRecommendedAutoCompact(300_000).threshold).toBe(85)
    expect(getRecommendedAutoCompact(128_000).threshold).toBe(80)
    expect(getRecommendedAutoCompact(32_000).threshold).toBe(80)
    expect(getRecommendedAutoCompact(64_000).threshold).toBe(80)
  })
})
