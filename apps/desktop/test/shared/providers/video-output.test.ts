import { describe, expect, it } from "vite-plus/test"

import {
  canProviderRenderVideo,
  isVideoOutputModel
} from "@/shared/providers/video-output"

describe("isVideoOutputModel", () => {
  it("recognizes Seedance ids from relays and Ark", () => {
    for (const id of [
      "doubao-seedance-2.0",
      "doubao-seedance-2.0-fast",
      "dreamina-seedance-2-5-260628",
      "bytedance/seedance-2.0"
    ]) {
      expect(isVideoOutputModel({ id })).toBe(true)
    }
  })

  it("rejects chat and image models, Seedream included", () => {
    for (const id of ["gpt-5.5", "doubao-seedream-4-5", "gpt-image-2"]) {
      expect(isVideoOutputModel({ id })).toBe(false)
    }
  })
})

describe("canProviderRenderVideo", () => {
  it("accepts the Amux provider and an OpenAI provider pointed at amux", () => {
    expect(canProviderRenderVideo("amux", "https://gateway.amux.ai/v1")).toBe(
      true
    )
    expect(canProviderRenderVideo("openai", "https://gateway.amux.ai/v1")).toBe(
      true
    )
    expect(canProviderRenderVideo("openai", "https://api.amux.ai/v1")).toBe(
      true
    )
  })

  it("rejects other OpenAI endpoints, look-alike hosts, and other providers", () => {
    expect(canProviderRenderVideo("openai", "https://api.openai.com/v1")).toBe(
      false
    )
    expect(canProviderRenderVideo("openai", "https://notamux.ai/v1")).toBe(
      false
    )
    expect(canProviderRenderVideo("openai", "not a url")).toBe(false)
    expect(
      canProviderRenderVideo("moonshot", "https://gateway.amux.ai/v1")
    ).toBe(false)
  })
})
