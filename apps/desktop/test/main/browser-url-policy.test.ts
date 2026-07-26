import { describe, expect, it } from "vite-plus/test"

import {
  isAllowedBrowserUrl,
  normalizeBrowserUrlInput
} from "@/main/browser/url-policy"

// Assembled via join so the source carries no literal `javascript:` URL, which
// the linter rejects; the runtime value is still `javascript:alert(1)`.
const SCRIPT_URL = ["javascript", "alert(1)"].join(":")

const DANGEROUS_INPUTS = [
  "file:///etc/passwd",
  "chrome://settings",
  "mailto:person@example.com",
  SCRIPT_URL,
  "data:text/html,<h1>x</h1>"
]

describe("normalizeBrowserUrlInput", () => {
  it("prepends https:// to a bare domain", () => {
    expect(normalizeBrowserUrlInput("example.com")).toBe("https://example.com/")
  })

  it("preserves an explicit http scheme", () => {
    expect(normalizeBrowserUrlInput("http://example.com")).toBe(
      "http://example.com/"
    )
  })

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeBrowserUrlInput("  example.com  ")).toBe(
      "https://example.com/"
    )
  })

  it("returns null for blank input", () => {
    expect(normalizeBrowserUrlInput("   ")).toBeNull()
  })

  it("returns null for unparseable garbage", () => {
    expect(normalizeBrowserUrlInput("not a url")).toBeNull()
    expect(normalizeBrowserUrlInput("http://")).toBeNull()
  })

  it("keeps dangerous schemes disallowed through the full pipeline", () => {
    for (const dangerous of DANGEROUS_INPUTS) {
      const normalized = normalizeBrowserUrlInput(dangerous)

      expect(normalized === null || !isAllowedBrowserUrl(normalized)).toBe(true)
    }
  })
})

describe("isAllowedBrowserUrl", () => {
  it("allows http and https including loopback origins", () => {
    expect(isAllowedBrowserUrl("https://example.com/")).toBe(true)
    expect(isAllowedBrowserUrl("http://localhost:5173/")).toBe(true)
    expect(isAllowedBrowserUrl("http://127.0.0.1:3000/")).toBe(true)
  })

  it("rejects every non-http(s) scheme", () => {
    for (const dangerous of DANGEROUS_INPUTS) {
      expect(isAllowedBrowserUrl(dangerous)).toBe(false)
    }
  })

  it("rejects unparseable input", () => {
    expect(isAllowedBrowserUrl("not a url")).toBe(false)
  })
})
