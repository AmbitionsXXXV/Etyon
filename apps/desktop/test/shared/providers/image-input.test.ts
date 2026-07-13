import { describe, expect, it } from "vite-plus/test"

import { isImageInputModel } from "@/shared/providers/image-input"

describe("isImageInputModel", () => {
  it("recognizes vision-capable families by id", () => {
    for (const id of [
      "claude-opus-4-8",
      "claude-3-5-sonnet",
      "claude-3-haiku",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-5.5",
      "o3",
      "o4-mini",
      "gemini-2.5-flash",
      "pixtral-12b",
      "qwen2.5-vl-72b-instruct",
      "llava-1.6",
      "kimi-vl-a3b",
      "moonshot-v1-8k-vision-preview"
    ]) {
      expect(isImageInputModel({ id })).toBe(true)
    }
  })

  it("rejects text, embedding, audio, and video models", () => {
    for (const id of [
      "gpt-3.5-turbo",
      "deepseek-chat",
      "llama-3.1-8b",
      "qwen-turbo",
      "kimi-k2",
      "text-embedding-3-large",
      "amux-stt-1.0",
      "doubao-seedance-2.0"
    ]) {
      expect(isImageInputModel({ id })).toBe(false)
    }
  })

  it("lets an explicit capability override the id heuristic", () => {
    expect(
      isImageInputModel({ capabilities: { vision: true }, id: "weird" })
    ).toBe(true)
    expect(
      isImageInputModel({ capabilities: { vision: false }, id: "gpt-4o" })
    ).toBe(false)
  })
})
