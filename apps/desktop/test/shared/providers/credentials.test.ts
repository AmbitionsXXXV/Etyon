import { describe, expect, it } from "vite-plus/test"

import { hasProviderCredential } from "@/shared/providers/credentials"
import { getProviderCatalogEntry } from "@/shared/providers/provider-catalog"

describe("hasProviderCredential", () => {
  it("checks the api key for apiKey-credentialed providers", () => {
    const openai = getProviderCatalogEntry("openai")

    expect(hasProviderCredential(openai, { apiKey: "sk-test" })).toBe(true)
    expect(hasProviderCredential(openai, { apiKey: "  " })).toBe(false)
    expect(hasProviderCredential(openai, { apiKey: "" })).toBe(false)
  })

  it("ignores the api key and checks oauth context for oauth-credentialed providers", () => {
    const cursor = getProviderCatalogEntry("cursor")

    expect(
      hasProviderCredential(
        cursor,
        { apiKey: "" },
        { cursorAuthenticated: true }
      )
    ).toBe(true)
    expect(
      hasProviderCredential(
        cursor,
        { apiKey: "sk-should-be-irrelevant" },
        { cursorAuthenticated: false }
      )
    ).toBe(false)
    expect(hasProviderCredential(cursor, { apiKey: "" })).toBe(false)
  })
})
