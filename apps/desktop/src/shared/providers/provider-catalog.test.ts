import type { AiSettings } from "@etyon/rpc"
import { AiSettingsSchema } from "@etyon/rpc"
import { describe, expect, it } from "vitest"

import {
  getSettingsTabProviders,
  hydrateAiSettingsProviders
} from "./provider-catalog"

describe("provider-catalog", () => {
  it("shows only moonshot and z.ai in the settings providers tab", () => {
    const providers = getSettingsTabProviders()

    expect(providers.map(({ id }) => id)).toEqual([
      "moonshot",
      "zai-coding-plan"
    ])
    expect(providers.map(({ name }) => name)).toEqual([
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
})
