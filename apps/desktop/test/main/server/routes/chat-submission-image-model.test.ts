import { AppSettingsSchema } from "@etyon/rpc"
import { describe, expect, it, vi } from "vite-plus/test"

import { resolveImageRequestModel } from "@/main/server/routes/chat-submission"

vi.mock("electron", () => ({
  app: { getPath: () => "/private/tmp/etyon-image-model-test" }
}))
vi.mock("@/main/db", () => ({ getDb: () => ({}) }))
vi.mock("@/main/logger", () => ({ logger: {} }))

const settings = AppSettingsSchema.parse({})

describe("resolveImageRequestModel", () => {
  it("uses the explicit image model and leaves the chat model alone", () => {
    expect(
      resolveImageRequestModel({
        imageMode: true,
        imageModel: "openai/gpt-image-1",
        modelId: "openai/gpt-5",
        settings
      })
    ).toBe("openai/gpt-image-1")
  })

  it("falls back to an image-output chat model for older clients", () => {
    expect(
      resolveImageRequestModel({
        imageMode: true,
        modelId: "openai/gpt-image-1",
        settings
      })
    ).toBe("openai/gpt-image-1")
  })

  it("rejects non-image targets and image mode off", () => {
    expect(
      resolveImageRequestModel({
        imageMode: true,
        imageModel: "openai/gpt-5",
        modelId: "openai/gpt-image-1",
        settings
      })
    ).toBeNull()
    expect(
      resolveImageRequestModel({
        imageMode: false,
        imageModel: "openai/gpt-image-1",
        modelId: null,
        settings
      })
    ).toBeNull()
  })
})
