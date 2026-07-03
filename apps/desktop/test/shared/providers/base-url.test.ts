import { describe, expect, it } from "vite-plus/test"

import { validateBaseURL } from "@/shared/providers/base-url"

describe("validateBaseURL", () => {
  it("accepts absolute http and https urls", () => {
    expect(validateBaseURL("https://api.openai.com/v1")).toBeNull()
    expect(validateBaseURL("http://localhost:8080/v1")).toBeNull()
    expect(validateBaseURL("  https://api.openai.com/v1  ")).toBeNull()
  })

  it("rejects an empty base url", () => {
    expect(validateBaseURL("")).toBe("empty")
    expect(validateBaseURL("   ")).toBe("empty")
  })

  it("rejects a malformed url", () => {
    expect(validateBaseURL("not a url")).toBe("invalid")
  })

  it("rejects non-http(s) protocols", () => {
    expect(validateBaseURL("ftp://api.openai.com/v1")).toBe(
      "unsupportedProtocol"
    )
    expect(validateBaseURL("ws://api.openai.com/v1")).toBe(
      "unsupportedProtocol"
    )
  })
})
