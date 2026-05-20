import { AppSettingsSchema, MEMORY_TOOL_MODEL_AUTO_VALUE } from "@etyon/rpc"
import type { AppSettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import { resolveMemoryToolModel } from "@/main/memory/tool-model"

const createSettings = (settings: unknown): AppSettings =>
  AppSettingsSchema.parse(settings)

describe("resolveMemoryToolModel", () => {
  it("auto selects a capable low-cost model from enabled providers", () => {
    const settings = createSettings({
      ai: {
        defaultProvider: "openai",
        providers: {
          openai: {
            apiKey: "sk-test",
            enabled: true,
            models: [
              {
                capabilities: {
                  contextWindow: 128_000,
                  jsonMode: true,
                  streaming: true
                },
                id: "gpt-5.4",
                name: "GPT-5.4"
              },
              {
                capabilities: {
                  contextWindow: 128_000,
                  jsonMode: true,
                  streaming: true
                },
                id: "gpt-5.4-mini",
                name: "GPT-5.4 Mini"
              }
            ]
          }
        }
      },
      memory: {
        memoryToolModel: MEMORY_TOOL_MODEL_AUTO_VALUE
      }
    })

    expect(resolveMemoryToolModel(settings)).toEqual({
      diagnostic: null,
      modelId: "openai/gpt-5.4-mini"
    })
  })

  it("passes through a concrete model when its provider is usable", () => {
    const settings = createSettings({
      ai: {
        providers: {
          moonshot: {
            apiKey: "moonshot-test",
            enabled: true
          }
        }
      },
      memory: {
        memoryToolModel: "moonshot/kimi-k2.5"
      }
    })

    expect(resolveMemoryToolModel(settings)).toEqual({
      diagnostic: null,
      modelId: "moonshot/kimi-k2.5"
    })
  })

  it("returns a diagnostic for concrete models without credentials", () => {
    const settings = createSettings({
      ai: {
        providers: {
          openai: {
            apiKey: "",
            enabled: true
          }
        }
      },
      memory: {
        memoryToolModel: "openai/gpt-5.4-mini"
      }
    })

    expect(resolveMemoryToolModel(settings)).toEqual({
      diagnostic: 'Provider "openai" is missing an API Key.',
      modelId: null
    })
  })

  it("returns a diagnostic when auto has no usable providers", () => {
    const settings = createSettings({
      ai: {
        providers: {
          openai: {
            apiKey: "",
            enabled: true
          }
        }
      },
      memory: {
        memoryToolModel: MEMORY_TOOL_MODEL_AUTO_VALUE
      }
    })

    expect(resolveMemoryToolModel(settings)).toEqual({
      diagnostic:
        "No enabled AI provider with API Key and memory tool models is configured.",
      modelId: null
    })
  })
})
