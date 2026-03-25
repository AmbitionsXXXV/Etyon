import { describe, expect, it } from "vitest"

import {
  getDefaultMoonshotBaseURL,
  resolveMoonshotBaseURL,
  resolveMoonshotRegion
} from "./moonshot-region"

describe("moonshot-region", () => {
  it("returns the region-specific default base url", () => {
    expect(getDefaultMoonshotBaseURL("china")).toBe(
      "https://api.moonshot.cn/v1"
    )
    expect(getDefaultMoonshotBaseURL("international")).toBe(
      "https://api.moonshot.ai/v1"
    )
  })

  it("infers the international region from legacy base urls", () => {
    expect(resolveMoonshotRegion(undefined, "https://api.moonshot.ai/v1")).toBe(
      "international"
    )
  })

  it("switches the official moonshot hostname when region changes", () => {
    expect(
      resolveMoonshotBaseURL(
        "https://api.moonshot.cn/v1?foo=bar",
        "international"
      )
    ).toBe("https://api.moonshot.ai/v1?foo=bar")
  })

  it("keeps custom proxy urls untouched", () => {
    expect(
      resolveMoonshotBaseURL("https://moonshot-proxy.example.com/v1", "china")
    ).toBe("https://moonshot-proxy.example.com/v1")
  })
})
