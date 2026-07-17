import type { AiSettings } from "@etyon/rpc"
import { AiSettingsSchema } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  getSettingsTabProviders,
  hydrateAiSettingsProviders,
  resolveOpenAiApiMode
} from "@/shared/providers/provider-catalog"

describe("provider-catalog", () => {
  it("shows openai, cursor, moonshot, and z.ai in the settings providers tab", () => {
    const providers = getSettingsTabProviders()

    expect(providers.map(({ id }) => id)).toEqual([
      "openai",
      "cursor",
      "moonshot",
      "zai-coding-plan"
    ])
    expect(providers.map(({ name }) => name)).toEqual([
      "OpenAI",
      "Cursor",
      "Moonshot",
      "Z.AI Coding Plan"
    ])
  })

  it("hydrates missing provider seeds for legacy ai settings", () => {
    const rawAiSettings = {
      defaultProvider: "openai",
      providers: {
        moonshot: {
          apiKey: "msk-test"
        }
      }
    }

    const aiSettings = AiSettingsSchema.parse(
      rawAiSettings
    ) satisfies AiSettings
    const hydratedAiSettings = hydrateAiSettingsProviders(
      aiSettings,
      rawAiSettings
    )

    expect(hydratedAiSettings.providers.moonshot.baseURL).toBe(
      "https://api.moonshot.cn/v1"
    )
    expect(hydratedAiSettings.providers.moonshot.region).toBe("china")
    expect(
      hydratedAiSettings.providers.moonshot.availableModels.map(({ id }) => id)
    ).toEqual(["kimi-k2.5"])
    expect(
      hydratedAiSettings.providers["zai-coding-plan"].availableModels.map(
        ({ id }) => id
      )
    ).toEqual(["glm-5", "glm-5-turbo", "glm-4.7"])
    expect(
      hydratedAiSettings.providers["zai-coding-plan"].models.map(({ id }) => id)
    ).toEqual(["glm-5", "glm-5-turbo", "glm-4.7"])
  })

  it("backfills the official openai base url and seed models for legacy ai settings", () => {
    const rawAiSettings = {
      defaultProvider: "openai",
      providers: {
        openai: {
          apiKey: "sk-test"
        }
      }
    }

    const aiSettings = AiSettingsSchema.parse(
      rawAiSettings
    ) satisfies AiSettings
    const hydratedAiSettings = hydrateAiSettingsProviders(
      aiSettings,
      rawAiSettings
    )

    expect(hydratedAiSettings.providers.openai.baseURL).toBe(
      "https://api.openai.com/v1"
    )
    expect(
      hydratedAiSettings.providers.openai.availableModels.map(({ id }) => id)
    ).toEqual(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"])
  })

  it("infers the legacy moonshot region from the stored base url", () => {
    const rawAiSettings = {
      defaultProvider: "moonshot",
      providers: {
        moonshot: {
          apiKey: "msk-test",
          baseURL: "https://api.moonshot.ai/v1"
        }
      }
    }

    const aiSettings = AiSettingsSchema.parse(
      rawAiSettings
    ) satisfies AiSettings
    const hydratedAiSettings = hydrateAiSettingsProviders(
      aiSettings,
      rawAiSettings
    )

    expect(hydratedAiSettings.providers.moonshot.baseURL).toBe(
      "https://api.moonshot.ai/v1"
    )
    expect(hydratedAiSettings.providers.moonshot.region).toBe("international")
  })

  it("defaults the openai api mode to responses only on the official endpoint", () => {
    expect(resolveOpenAiApiMode({ baseURL: "" })).toBe("responses")
    expect(resolveOpenAiApiMode({ baseURL: "https://api.openai.com/v1" })).toBe(
      "responses"
    )
    expect(resolveOpenAiApiMode({ baseURL: "https://api.amux.ai/v1" })).toBe(
      "chat-completions"
    )
  })

  it("lets an explicit openai api mode override the base url default", () => {
    expect(
      resolveOpenAiApiMode({
        apiMode: "responses",
        baseURL: "https://api.amux.ai/v1"
      })
    ).toBe("responses")
    expect(
      resolveOpenAiApiMode({
        apiMode: "chat-completions",
        baseURL: ""
      })
    ).toBe("chat-completions")
  })

  it("applies an explicit responses mode only to openai-family models on a mixed relay", () => {
    expect(
      resolveOpenAiApiMode(
        { apiMode: "responses", baseURL: "https://api.amux.ai/v1" },
        "gpt-5.6-terra"
      )
    ).toBe("responses")
    expect(
      resolveOpenAiApiMode(
        { apiMode: "responses", baseURL: "https://api.amux.ai/v1" },
        "claude-sonnet-5"
      )
    ).toBe("chat-completions")
    expect(
      resolveOpenAiApiMode(
        { apiMode: "responses", baseURL: "https://api.amux.ai/v1" },
        "deepseek-v4-flash"
      )
    ).toBe("chat-completions")
  })

  it("never upgrades an explicit chat-completions mode to responses", () => {
    expect(
      resolveOpenAiApiMode(
        { apiMode: "chat-completions", baseURL: "" },
        "gpt-5.6-terra"
      )
    ).toBe("chat-completions")
  })

  it("keeps the responses default for openai-family ids on the official endpoint", () => {
    expect(resolveOpenAiApiMode({ baseURL: "" }, "o3")).toBe("responses")
    expect(resolveOpenAiApiMode({ baseURL: "" }, "chatgpt-4o-latest")).toBe(
      "responses"
    )
    expect(resolveOpenAiApiMode({ baseURL: "" })).toBe("responses")
  })
})
