import type { StoredProviderModel } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildModelCapabilityBadges,
  buildModelContextBadge
} from "@/renderer/lib/settings-page/model-capabilities"

const buildModel = (
  overrides: Partial<StoredProviderModel> = {}
): StoredProviderModel => ({
  id: "test-model",
  name: "Test Model",
  ...overrides
})

describe("buildModelCapabilityBadges", () => {
  it("returns badges in order: vision, function calling, reasoning, image", () => {
    const badges = buildModelCapabilityBadges(
      buildModel({
        capabilities: {
          functionCalling: true,
          reasoning: true,
          vision: true
        },
        id: "gpt-image-1"
      })
    )

    expect(badges.map((badge) => badge.kind)).toEqual([
      "vision",
      "functionCalling",
      "reasoning",
      "imageOutput"
    ])
    expect(badges.map((badge) => badge.labelKey)).toEqual([
      "settings.providers.models.capabilities.vision",
      "settings.providers.models.capabilities.functionCalling",
      "settings.providers.models.capabilities.reasoning",
      "settings.providers.models.capabilities.imageOutput"
    ])
  })

  it("returns no badges for a model with no capabilities and a plain id", () => {
    expect(buildModelCapabilityBadges(buildModel())).toEqual([])
    expect(
      buildModelCapabilityBadges(buildModel({ capabilities: {} }))
    ).toEqual([])
  })

  it("emits the native function-calling badge when functionCalling is true", () => {
    const badges = buildModelCapabilityBadges(
      buildModel({ capabilities: { functionCalling: true } })
    )

    expect(badges.map((badge) => badge.kind)).toEqual(["functionCalling"])
  })

  it("emits the XML function-calling badge when functionCalling is false", () => {
    const badges = buildModelCapabilityBadges(
      buildModel({ capabilities: { functionCalling: false } })
    )

    expect(badges.map((badge) => badge.kind)).toEqual(["xmlFunctionCalling"])
  })

  it("emits no function-calling badge when the flag is unknown", () => {
    const badges = buildModelCapabilityBadges(
      buildModel({ capabilities: { vision: true } })
    )

    expect(badges.map((badge) => badge.kind)).toEqual(["vision"])
  })

  it("detects image output from the id heuristic without an explicit flag", () => {
    const badges = buildModelCapabilityBadges(buildModel({ id: "dall-e-3" }))

    expect(badges.map((badge) => badge.kind)).toEqual(["imageOutput"])
  })

  it("ignores json mode and streaming (deliberately not badges)", () => {
    const badges = buildModelCapabilityBadges(
      buildModel({ capabilities: { jsonMode: true, streaming: true } })
    )

    expect(badges).toEqual([])
  })
})

describe("buildModelContextBadge", () => {
  it("returns null when no context window is present", () => {
    expect(buildModelContextBadge(buildModel())).toBeNull()
    expect(
      buildModelContextBadge(buildModel({ capabilities: { vision: true } }))
    ).toBeNull()
  })

  it("returns the compact label and the full localized token count", () => {
    expect(
      buildModelContextBadge(
        buildModel({ capabilities: { contextWindow: 1_000_000 } })
      )
    ).toEqual({ compact: "1M", tokens: "1,000,000" })

    expect(
      buildModelContextBadge(
        buildModel({ capabilities: { contextWindow: 202_752 } })
      )
    ).toEqual({ compact: "203K", tokens: "202,752" })
  })
})
