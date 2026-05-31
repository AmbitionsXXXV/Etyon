import { describe, expect, it } from "vite-plus/test"

import {
  getAgentModelFallbackCandidates,
  resolveAgentModelRoute
} from "@/main/agents/agent-model-router"

const createProfile = (preferredModel = "") => ({
  id: "coder",
  modelPolicy: {
    preferredModel
  }
})

describe("agent model router", () => {
  it("prefers the profile model over user and fallback models", () => {
    expect(
      resolveAgentModelRoute({
        fallbackChain: ["openai/fallback"],
        profile: createProfile("anthropic/planner"),
        stepKind: "plan",
        userSelectedModel: "openai/user"
      })
    ).toEqual({
      fallbackChain: ["openai/fallback"],
      modelId: "anthropic/planner",
      profileId: "coder",
      reason: "profile",
      stepKind: "plan"
    })
  })

  it("uses the user-selected model when the profile has no override", () => {
    expect(
      resolveAgentModelRoute({
        fallbackChain: ["openai/fallback"],
        profile: createProfile(),
        userSelectedModel: "openai/user"
      })
    ).toEqual({
      fallbackChain: ["openai/fallback"],
      modelId: "openai/user",
      profileId: "coder",
      reason: "user",
      stepKind: null
    })
  })

  it("falls back to the first non-empty fallback chain model", () => {
    expect(
      resolveAgentModelRoute({
        fallbackChain: ["", " gateway/fallback ", null],
        profile: createProfile()
      })
    ).toEqual({
      fallbackChain: ["gateway/fallback"],
      modelId: "gateway/fallback",
      profileId: "coder",
      reason: "fallback",
      stepKind: null
    })
  })

  it("allows implicit provider selection when no route is configured", () => {
    expect(
      resolveAgentModelRoute({
        profile: createProfile()
      })
    ).toEqual({
      fallbackChain: [],
      modelId: null,
      profileId: "coder",
      reason: "implicit",
      stepKind: null
    })
  })

  it("deduplicates fallback candidates and skips the active model", () => {
    const route = resolveAgentModelRoute({
      fallbackChain: ["openai/primary", "openai/fallback", "openai/fallback"],
      profile: createProfile("openai/primary")
    })

    expect(getAgentModelFallbackCandidates(route)).toEqual(["openai/fallback"])
  })
})
