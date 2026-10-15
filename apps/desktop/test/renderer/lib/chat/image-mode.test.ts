import { describe, expect, it } from "vite-plus/test"

import { resolveImageModeForModelChange } from "@/renderer/lib/chat/image-mode"

describe("resolveImageModeForModelChange", () => {
  it("defaults ON when a session opens with an image-capable model", () => {
    expect(
      resolveImageModeForModelChange({
        isCapable: true,
        previous: false,
        wasCapable: false
      })
    ).toBe(true)
  })

  it("stays OFF when a session opens with a normal chat model", () => {
    expect(
      resolveImageModeForModelChange({
        isCapable: false,
        previous: false,
        wasCapable: false
      })
    ).toBe(false)
  })

  it("auto-enables when switching from a chat model to an image model", () => {
    expect(
      resolveImageModeForModelChange({
        isCapable: true,
        previous: false,
        wasCapable: false
      })
    ).toBe(true)
  })

  it("forces OFF when switching from an image model to a chat model", () => {
    expect(
      resolveImageModeForModelChange({
        isCapable: false,
        previous: true,
        wasCapable: true
      })
    ).toBe(false)
  })

  it("preserves the user's OFF choice while the model stays image-capable", () => {
    expect(
      resolveImageModeForModelChange({
        isCapable: true,
        previous: false,
        wasCapable: true
      })
    ).toBe(false)
  })

  it("preserves the user's ON choice while the model stays image-capable", () => {
    expect(
      resolveImageModeForModelChange({
        isCapable: true,
        previous: true,
        wasCapable: true
      })
    ).toBe(true)
  })
})
