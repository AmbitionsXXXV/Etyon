import { describe, expect, it } from "vite-plus/test"

import { isImageOutputModel } from "@/shared/providers/image-output"

describe("isImageOutputModel", () => {
  it("recognizes image-output families by id", () => {
    for (const id of [
      "gpt-image-2",
      "gemini-2.5-flash-image",
      "gemini-3-pro-image-preview",
      "MiniMax-Image-01",
      "nano-banana"
    ]) {
      expect(isImageOutputModel({ id })).toBe(true)
    }
  })

  it("rejects chat, vision, audio, and video models", () => {
    for (const id of [
      "gpt-5.5",
      "claude-opus-4-8",
      "gemini-3.5-flash",
      "doubao-seedance-2.0",
      "amux-stt-1.0"
    ]) {
      expect(isImageOutputModel({ id })).toBe(false)
    }
  })

  it("lets an explicit capability override the id heuristic", () => {
    expect(
      isImageOutputModel({ capabilities: { imageOutput: true }, id: "weird" })
    ).toBe(true)
    expect(
      isImageOutputModel({
        capabilities: { imageOutput: false },
        id: "gpt-image-2"
      })
    ).toBe(false)
  })
})
