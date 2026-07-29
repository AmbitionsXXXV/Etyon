import { describe, expect, it } from "vite-plus/test"

import { resolveReleaseNotesUrl } from "@/renderer/lib/updates/release-notes"

const SCRIPT_URL = ["javascript", "alert(1)"].join(":")

describe("resolveReleaseNotesUrl", () => {
  it("keeps absolute http(s) links", () => {
    expect(resolveReleaseNotesUrl("https://example.com/changelog")).toBe(
      "https://example.com/changelog"
    )
    expect(resolveReleaseNotesUrl("http://example.com/changelog")).toBe(
      "http://example.com/changelog"
    )
  })

  it("resolves repository-relative links against GitHub", () => {
    expect(resolveReleaseNotesUrl("issues/123")).toBe(
      "https://github.com/AmbitionsXXXV/Etyon/issues/123"
    )
    expect(resolveReleaseNotesUrl("/AmbitionsXXXV/Etyon/pull/456")).toBe(
      "https://github.com/AmbitionsXXXV/Etyon/pull/456"
    )
  })

  it("rejects non-http protocols and malformed URLs", () => {
    expect(resolveReleaseNotesUrl("mailto:test@example.com")).toBeNull()
    expect(resolveReleaseNotesUrl(SCRIPT_URL)).toBeNull()
    expect(resolveReleaseNotesUrl("https://[invalid")).toBeNull()
  })
})
