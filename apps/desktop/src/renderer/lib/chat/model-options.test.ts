import type { AiSettings } from "@etyon/rpc"
import { describe, expect, it } from "vitest"

import { buildChatModelGroups, resolveChatModelValue } from "./model-options"

const buildAiSettingsFixture = (): AiSettings => ({
  defaultModel: "moonshot/kimi-k2.5",
  defaultProvider: "moonshot",
  providers: {
    anthropic: {
      apiKey: "",
      availableModels: [],
      baseURL: "",
      enabled: false,
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
      apiKey: "",
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
      apiKey: "",
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
})
