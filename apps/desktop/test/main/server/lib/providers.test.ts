import type { AppSettings } from "@etyon/rpc"
import { AppSettingsSchema } from "@etyon/rpc"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { resolveModel } from "@/main/server/lib/providers"

const {
  createAnthropicMock,
  createGatewayMock,
  createOpenAIMock,
  getSettingsMock,
  openAIProviderMock
} = vi.hoisted(() => {
  const openAIProvider = Object.assign(
    vi.fn((modelId: string) => ({
      modelId,
      transport: "responses"
    })),
    {
      chat: vi.fn((modelId: string) => ({
        modelId,
        transport: "chat-completions"
      }))
    }
  )

  return {
    createAnthropicMock: vi.fn(() =>
      vi.fn((modelId: string) => ({
        modelId,
        transport: "anthropic"
      }))
    ),
    createGatewayMock: vi.fn(() =>
      vi.fn((modelId: string) => ({
        modelId,
        transport: "gateway"
      }))
    ),
    createOpenAIMock: vi.fn(() => openAIProvider),
    getSettingsMock: vi.fn(),
    openAIProviderMock: openAIProvider
  }
})

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: createAnthropicMock
}))

vi.mock("@ai-sdk/gateway", () => ({
  createGateway: createGatewayMock
}))

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock
}))

vi.mock("@/main/settings", () => ({
  getSettings: getSettingsMock
}))

const createSettings = (): AppSettings =>
  AppSettingsSchema.parse({
    ai: {
      defaultModel: "moonshot/kimi-k2.6",
      defaultProvider: "moonshot",
      providers: {
        anthropic: {
          apiKey: "anthropic-key",
          availableModels: [],
          baseURL: "",
          enabled: true,
          models: []
        },
        gateway: {
          apiKey: "gateway-key",
          availableModels: [],
          baseURL: "",
          enabled: true,
          models: []
        },
        moonshot: {
          apiKey: " moonshot-key ",
          availableModels: [],
          baseURL: "https://api.moonshot.cn/v1",
          enabled: true,
          models: [],
          region: "china"
        },
        openai: {
          apiKey: "openai-key",
          availableModels: [],
          baseURL: "",
          enabled: true,
          models: []
        },
        "zai-coding-plan": {
          apiKey: "zai-key",
          availableModels: [],
          baseURL: "https://api.z.ai/api/coding/paas/v4",
          enabled: true,
          models: []
        }
      }
    }
  })

describe("resolveModel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSettingsMock.mockReturnValue(createSettings())
  })

  it("uses chat completions for moonshot models", () => {
    const model = resolveModel("moonshot/kimi-k2.6")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "moonshot-key",
      baseURL: "https://api.moonshot.cn/v1",
      name: "moonshot"
    })
    expect(openAIProviderMock).not.toHaveBeenCalled()
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("kimi-k2.6")
    expect(model).toEqual({
      modelId: "kimi-k2.6",
      transport: "chat-completions"
    })
  })

  it("uses chat completions for z.ai coding plan models", () => {
    resolveModel("zai-coding-plan/glm-5")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "zai-key",
      baseURL: "https://api.z.ai/api/coding/paas/v4",
      name: "zai-coding-plan"
    })
    expect(openAIProviderMock).not.toHaveBeenCalled()
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("glm-5")
  })

  it("keeps official openai models on the responses-capable provider", () => {
    const model = resolveModel("openai/gpt-5.4")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "openai-key"
    })
    expect(openAIProviderMock).toHaveBeenCalledWith("gpt-5.4")
    expect(openAIProviderMock.chat).not.toHaveBeenCalled()
    expect(model).toEqual({
      modelId: "gpt-5.4",
      transport: "responses"
    })
  })

  it("falls back to the first configured provider when no model is requested", () => {
    const settings = createSettings()

    getSettingsMock.mockReturnValue({
      ...settings,
      ai: {
        ...settings.ai,
        defaultModel: "",
        defaultProvider: "moonshot",
        providers: {
          ...settings.ai.providers,
          moonshot: {
            ...settings.ai.providers.moonshot,
            models: [
              {
                capabilities: undefined,
                id: "kimi-k2.6",
                isManual: undefined,
                name: "kimi-k2.6"
              }
            ]
          },
          openai: {
            ...settings.ai.providers.openai,
            apiKey: ""
          }
        }
      }
    })

    const model = resolveModel()

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "moonshot-key",
      baseURL: "https://api.moonshot.cn/v1",
      name: "moonshot"
    })
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("kimi-k2.6")
    expect(model).toEqual({
      modelId: "kimi-k2.6",
      transport: "chat-completions"
    })
  })

  it("skips an unavailable saved default model for implicit resolution", () => {
    const settings = createSettings()

    getSettingsMock.mockReturnValue({
      ...settings,
      ai: {
        ...settings.ai,
        defaultModel: "openai/gpt-4o",
        defaultProvider: "openai",
        providers: {
          ...settings.ai.providers,
          moonshot: {
            ...settings.ai.providers.moonshot,
            models: [
              {
                capabilities: undefined,
                id: "kimi-k2.6",
                isManual: undefined,
                name: "kimi-k2.6"
              }
            ]
          },
          openai: {
            ...settings.ai.providers.openai,
            apiKey: ""
          }
        }
      }
    })

    const model = resolveModel()

    expect(openAIProviderMock).not.toHaveBeenCalledWith("gpt-4o")
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("kimi-k2.6")
    expect(model).toEqual({
      modelId: "kimi-k2.6",
      transport: "chat-completions"
    })
  })

  it("keeps explicit unavailable models as configuration errors", () => {
    const settings = createSettings()

    getSettingsMock.mockReturnValue({
      ...settings,
      ai: {
        ...settings.ai,
        providers: {
          ...settings.ai.providers,
          openai: {
            ...settings.ai.providers.openai,
            apiKey: ""
          }
        }
      }
    })

    expect(() => resolveModel("openai/gpt-4o")).toThrow(
      'Provider "openai" is missing an API Key.'
    )
  })
})
