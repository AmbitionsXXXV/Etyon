import type { AiSettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildAiSettingsWithDefaultModel,
  buildChatModelGroups,
  resolveChatModelValue
} from "@/renderer/lib/chat/model-options"

const buildAiSettingsFixture = (): AiSettings => ({
  defaultModel: "moonshot/kimi-k2.5",
  defaultProvider: "moonshot",
  modelEffort: { anthropic: "high", openai: "medium" },
  providers: {
    anthropic: {
      apiKey: "",
      availableModels: [],
      baseURL: "",
      enabled: false,
      models: []
    },
    cursor: {
      apiKey: "",
      availableModels: [
        {
          capabilities: undefined,
          id: "composer-2",
          isManual: undefined,
          name: "Composer 2"
        }
      ],
      baseURL: "",
      enabled: true,
      models: []
    },
    gateway: {
      apiKey: "",
      availableModels: [],
      baseURL: "",
      enabled: false,
      models: []
    },
    moonshot: {
      apiKey: "moonshot-key",
      availableModels: [
        {
          capabilities: undefined,
          id: "kimi-k2.5",
          isManual: undefined,
          name: "kimi-k2.5"
        }
      ],
      baseURL: "https://api.moonshot.cn/v1",
      enabled: true,
      models: []
    },
    openai: {
      apiKey: "",
      availableModels: [],
      baseURL: "",
      enabled: false,
      models: []
    },
    "zai-coding-plan": {
      apiKey: "zai-key",
      availableModels: [
        {
          capabilities: undefined,
          id: "glm-4.7",
          isManual: undefined,
          name: "glm-4.7"
        }
      ],
      baseURL: "https://api.z.ai/api/coding/paas/v4",
      enabled: true,
      models: [
        {
          capabilities: undefined,
          id: "glm-5",
          isManual: undefined,
          name: "glm-5"
        }
      ]
    }
  }
})

describe("chat model options", () => {
  it("uses enabled providers only and falls back from models to availableModels", () => {
    const groups = buildChatModelGroups(buildAiSettingsFixture())

    expect(groups.map((group) => group.providerId)).toEqual([
      "moonshot",
      "zai-coding-plan"
    ])
    expect(groups[0]?.options.map((option) => option.id)).toEqual(["kimi-k2.5"])
    expect(groups[1]?.options.map((option) => option.id)).toEqual(["glm-5"])
  })

  it("hides providers that have no API key from runtime model options", () => {
    const aiSettings = buildAiSettingsFixture()
    const groups = buildChatModelGroups({
      ...aiSettings,
      providers: {
        ...aiSettings.providers,
        moonshot: {
          ...aiSettings.providers.moonshot,
          apiKey: ""
        }
      }
    })

    expect(groups.map((group) => group.providerId)).toEqual(["zai-coding-plan"])
  })

  it("prefers the session model, then the default model, then the first option", () => {
    const groups = buildChatModelGroups(buildAiSettingsFixture())

    expect(
      resolveChatModelValue({
        defaultModel: "moonshot/kimi-k2.5",
        groups,
        sessionModelId: "zai-coding-plan/glm-5"
      })
    ).toBe("zai-coding-plan/glm-5")
    expect(
      resolveChatModelValue({
        defaultModel: "moonshot/kimi-k2.5",
        groups,
        sessionModelId: null
      })
    ).toBe("moonshot/kimi-k2.5")
  })

  it("persists the last selected chat model as the default model", () => {
    const aiSettings = buildAiSettingsFixture()
    const nextAiSettings = buildAiSettingsWithDefaultModel(
      aiSettings,
      "zai-coding-plan/glm-5"
    )

    expect(nextAiSettings.defaultModel).toBe("zai-coding-plan/glm-5")
    expect(nextAiSettings.providers).toBe(aiSettings.providers)
  })
})
