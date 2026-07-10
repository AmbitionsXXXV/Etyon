import { describe, expect, it } from "vite-plus/test"

import {
  getEffortProviderId,
  resolveEffortProviderOptions
} from "@/shared/providers/model-effort"

const MODEL_EFFORT = { anthropic: "max", openai: "low" } as const

describe("getEffortProviderId", () => {
  it("gates anthropic on claude ids and the reasoning capability", () => {
    expect(
      getEffortProviderId({
        model: { id: "claude-opus-4-8" },
        providerId: "anthropic"
      })
    ).toBe("anthropic")
    expect(
      getEffortProviderId({
        model: { capabilities: { reasoning: false }, id: "claude-opus-4-8" },
        providerId: "anthropic"
      })
    ).toBeNull()
  })

  it("gates openai on reasoning-family ids and the reasoning capability", () => {
    for (const id of ["gpt-5.5", "o1", "o3-mini", "o4-mini"]) {
      expect(getEffortProviderId({ model: { id }, providerId: "openai" })).toBe(
        "openai"
      )
    }

    expect(
      getEffortProviderId({ model: { id: "gpt-4o" }, providerId: "openai" })
    ).toBeNull()
    expect(
      getEffortProviderId({
        model: { capabilities: { reasoning: true }, id: "custom-thinker-1" },
        providerId: "openai"
      })
    ).toBe("openai")
  })

  it("gates claude models served through the openai provider as openai", () => {
    expect(
      getEffortProviderId({
        model: { id: "claude-opus-4-8" },
        providerId: "openai"
      })
    ).toBe("openai")
  })

  it("returns null for providers without an effort knob", () => {
    expect(
      getEffortProviderId({
        model: { capabilities: { reasoning: true }, id: "kimi-k2" },
        providerId: "moonshot"
      })
    ).toBeNull()
    expect(
      getEffortProviderId({
        model: { id: "claude-opus-4-8" },
        providerId: "gateway"
      })
    ).toBeNull()
  })
})

describe("resolveEffortProviderOptions", () => {
  it("maps an anthropic selection to its effort provider option", () => {
    expect(
      resolveEffortProviderOptions({
        model: { id: "claude-opus-4-8" },
        modelEffort: MODEL_EFFORT,
        providerId: "anthropic"
      })
    ).toEqual({ anthropic: { effort: "max" } })
  })

  it("omits the anthropic option at the API-default high level", () => {
    expect(
      resolveEffortProviderOptions({
        model: { id: "claude-haiku-4-5" },
        modelEffort: { ...MODEL_EFFORT, anthropic: "high" },
        providerId: "anthropic"
      })
    ).toBeUndefined()
  })

  it("maps an openai selection to its reasoningEffort provider option", () => {
    expect(
      resolveEffortProviderOptions({
        model: { id: "gpt-5.5" },
        modelEffort: MODEL_EFFORT,
        providerId: "openai"
      })
    ).toEqual({ openai: { reasoningEffort: "low" } })
  })

  it("returns undefined when the gate rejects the provider", () => {
    expect(
      resolveEffortProviderOptions({
        model: { capabilities: { reasoning: true }, id: "kimi-k2" },
        modelEffort: MODEL_EFFORT,
        providerId: "moonshot"
      })
    ).toBeUndefined()
  })
})
