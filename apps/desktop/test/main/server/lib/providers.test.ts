import type { AppSettings } from "@etyon/rpc"
import { AppSettingsSchema } from "@etyon/rpc"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
  isImageGenerationAvailable,
  resolveEffortProviderOptionsForSelection,
  resolveImageModel,
  resolveModel
} from "@/main/server/lib/providers"

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
      })),
      image: vi.fn((modelId: string) => ({
        modelId,
        transport: "image"
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

vi.mock("@/main/logger", () => ({
  logger: {
    critical: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    startEvent: vi.fn()
  }
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

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "moonshot-key",
        baseURL: "https://api.moonshot.cn/v1",
        fetch: expect.any(Function),
        name: "moonshot"
      })
    )
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
      fetch: expect.any(Function),
      name: "zai-coding-plan"
    })
    expect(openAIProviderMock).not.toHaveBeenCalled()
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("glm-5")
  })

  it("keeps official openai models on the responses-capable provider", () => {
    const model = resolveModel("openai/gpt-5.4")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "openai-key",
      baseURL: "https://api.openai.com/v1",
      fetch: expect.any(Function)
    })
    expect(openAIProviderMock).toHaveBeenCalledWith("gpt-5.4")
    expect(openAIProviderMock.chat).not.toHaveBeenCalled()
    expect(model).toEqual({
      modelId: "gpt-5.4",
      transport: "responses"
    })
  })

  it("defaults a custom openai base url to chat completions", () => {
    const settings = createSettings()

    getSettingsMock.mockReturnValue({
      ...settings,
      ai: {
        ...settings.ai,
        providers: {
          ...settings.ai.providers,
          openai: {
            ...settings.ai.providers.openai,
            baseURL: "https://openai.example.com/v1"
          }
        }
      }
    })

    const model = resolveModel("openai/gpt-5.4")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "openai-key",
      baseURL: "https://openai.example.com/v1",
      fetch: expect.any(Function),
      name: "openai"
    })
    expect(openAIProviderMock).not.toHaveBeenCalled()
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("gpt-5.4")
    expect(model).toEqual({
      modelId: "gpt-5.4",
      transport: "chat-completions"
    })
  })

  it("honors an explicit responses api mode on a custom openai base url", () => {
    const settings = createSettings()

    getSettingsMock.mockReturnValue({
      ...settings,
      ai: {
        ...settings.ai,
        providers: {
          ...settings.ai.providers,
          openai: {
            ...settings.ai.providers.openai,
            apiMode: "responses",
            baseURL: "https://openai.example.com/v1"
          }
        }
      }
    })

    resolveModel("openai/gpt-5.4")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "openai-key",
      baseURL: "https://openai.example.com/v1",
      fetch: expect.any(Function)
    })
    expect(openAIProviderMock).toHaveBeenCalledWith("gpt-5.4")
    expect(openAIProviderMock.chat).not.toHaveBeenCalled()
  })

  it("uses chat completions for openai when apiMode is chat-completions", () => {
    const settings = createSettings()

    getSettingsMock.mockReturnValue({
      ...settings,
      ai: {
        ...settings.ai,
        providers: {
          ...settings.ai.providers,
          openai: {
            ...settings.ai.providers.openai,
            apiMode: "chat-completions",
            baseURL: "https://openai-gateway.example.com/v1"
          }
        }
      }
    })

    const model = resolveModel("openai/gpt-5.4")

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "openai-key",
      baseURL: "https://openai-gateway.example.com/v1",
      fetch: expect.any(Function),
      name: "openai"
    })
    expect(openAIProviderMock).not.toHaveBeenCalled()
    expect(openAIProviderMock.chat).toHaveBeenCalledWith("gpt-5.4")
    expect(model).toEqual({
      modelId: "gpt-5.4",
      transport: "chat-completions"
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

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "moonshot-key",
        baseURL: "https://api.moonshot.cn/v1",
        fetch: expect.any(Function),
        name: "moonshot"
      })
    )
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

  it("builds a gpt-image model through the openai provider for image generation", () => {
    const model = resolveImageModel()

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "openai-key",
        baseURL: "https://api.openai.com/v1",
        fetch: expect.any(Function)
      })
    )
    expect(openAIProviderMock.image).toHaveBeenCalledWith("gpt-image-2")
    expect(model).toEqual({ modelId: "gpt-image-2", transport: "image" })
  })

  it("reports image generation availability from the openai provider", () => {
    expect(isImageGenerationAvailable()).toBe(true)

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

    expect(isImageGenerationAvailable()).toBe(false)
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

describe("resolveEffortProviderOptionsForSelection", () => {
  const buildAiSettings = (overrides?: {
    anthropicEffort?: AppSettings["ai"]["modelEffort"]["anthropic"]
    openai?: Partial<AppSettings["ai"]["providers"]["openai"]>
    openaiEffort?: AppSettings["ai"]["modelEffort"]["openai"]
  }): AppSettings["ai"] => {
    const { ai } = createSettings()

    return {
      ...ai,
      modelEffort: {
        anthropic: overrides?.anthropicEffort ?? ai.modelEffort.anthropic,
        openai: overrides?.openaiEffort ?? ai.modelEffort.openai
      },
      providers: {
        ...ai.providers,
        openai: { ...ai.providers.openai, ...overrides?.openai }
      }
    }
  }

  it("requests a reasoning summary for openai responses-mode reasoning models", () => {
    const aiSettings = buildAiSettings({ openaiEffort: "xhigh" })

    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "openai/gpt-5.6-terra"
      )
    ).toEqual({
      openai: { reasoningEffort: "xhigh", reasoningSummary: "auto" }
    })
  })

  it("requests a summary when responses mode is set explicitly on a custom base url", () => {
    const aiSettings = buildAiSettings({
      openai: {
        apiMode: "responses",
        baseURL: "https://openai.example.com/v1"
      },
      openaiEffort: "xhigh"
    })

    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "openai/gpt-5.6-terra"
      )
    ).toEqual({
      openai: {
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        store: false
      }
    })
  })

  it("keeps the summary off for non-openai-family models on a responses relay", () => {
    const aiSettings = buildAiSettings({
      openai: {
        apiMode: "responses",
        baseURL: "https://api.amux.ai/v1"
      },
      openaiEffort: "xhigh"
    })

    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "openai/gpt-5.6-terra"
      )
    ).toEqual({
      openai: {
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        store: false
      }
    })
    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "openai/claude-sonnet-5"
      )
    ).toEqual({ openai: { reasoningEffort: "xhigh" } })
  })

  it("omits the summary for an openai chat-completions relay", () => {
    const aiSettings = buildAiSettings({
      openai: { baseURL: "https://openai-gateway.example.com/v1" },
      openaiEffort: "xhigh"
    })

    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "openai/gpt-5.6-terra"
      )
    ).toEqual({ openai: { reasoningEffort: "xhigh" } })
  })

  it("omits the summary when reasoning effort is none", () => {
    const aiSettings = buildAiSettings({ openaiEffort: "none" })

    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "openai/gpt-5.6-terra"
      )
    ).toEqual({ openai: { reasoningEffort: "none" } })
  })

  it("leaves an anthropic selection untouched", () => {
    const aiSettings = buildAiSettings({ anthropicEffort: "max" })

    expect(
      resolveEffortProviderOptionsForSelection(
        aiSettings,
        "anthropic/claude-opus-4-8"
      )
    ).toEqual({ anthropic: { effort: "max" } })
  })
})

describe("resolveModel XML tool middleware activation", () => {
  // A v3-shaped instance the mocked provider returns so the middleware's v3
  // guard can fire (plain `{ modelId, transport }` mocks stay unwrapped).
  const rawV3 = {
    modelId: "kimi-k2.6",
    provider: "moonshot",
    specificationVersion: "v3",
    transport: "chat-completions"
  }

  const settingsWithCapability = (
    functionCalling: boolean | undefined
  ): AppSettings => {
    const settings = createSettings()

    return {
      ...settings,
      ai: {
        ...settings.ai,
        providers: {
          ...settings.ai.providers,
          moonshot: {
            ...settings.ai.providers.moonshot,
            models: [
              {
                capabilities:
                  functionCalling === undefined
                    ? undefined
                    : { functionCalling },
                id: "kimi-k2.6",
                isManual: undefined,
                name: "kimi-k2.6"
              }
            ]
          }
        }
      }
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("wraps a functionCalling:false model in a different v3 instance", () => {
    getSettingsMock.mockReturnValue(settingsWithCapability(false))
    openAIProviderMock.chat.mockReturnValueOnce(rawV3)

    const model = resolveModel("moonshot/kimi-k2.6")

    expect(model).not.toBe(rawV3)
    expect(typeof model === "object" ? model.specificationVersion : null).toBe(
      "v3"
    )
    expect(typeof model === "object" ? model.modelId : null).toBe("kimi-k2.6")
  })

  it("returns the raw instance for a functionCalling:true model", () => {
    getSettingsMock.mockReturnValue(settingsWithCapability(true))
    openAIProviderMock.chat.mockReturnValueOnce(rawV3)

    expect(resolveModel("moonshot/kimi-k2.6")).toBe(rawV3)
  })

  it("returns the raw instance when the capability is unset", () => {
    getSettingsMock.mockReturnValue(settingsWithCapability(undefined))
    openAIProviderMock.chat.mockReturnValueOnce(rawV3)

    expect(resolveModel("moonshot/kimi-k2.6")).toBe(rawV3)
  })

  it("returns the raw instance when the model is not stored", () => {
    getSettingsMock.mockReturnValue(createSettings())
    openAIProviderMock.chat.mockReturnValueOnce(rawV3)

    expect(resolveModel("moonshot/kimi-k2.6")).toBe(rawV3)
  })
})
