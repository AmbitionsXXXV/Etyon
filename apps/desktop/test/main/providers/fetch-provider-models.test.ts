import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { fetchProviderModels } from "@/main/providers/fetch-provider-models"

describe("fetchProviderModels", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("rejects when the provider api key is missing", async () => {
    await expect(
      fetchProviderModels({
        provider: {
          apiKey: "  ",
          baseURL: "https://api.moonshot.cn/v1",
          providerId: "moonshot",
          region: "china"
        }
      })
    ).rejects.toThrow("API Key is required before fetching models.")
  })

  it("normalizes fetched models and fills missing capabilities from seed data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "glm-5",
            name: "GLM 5"
          }
        ]
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    const output = await fetchProviderModels({
      provider: {
        apiKey: "z-ai-key",
        baseURL: "https://api.z.ai/api/coding/paas/v4/",
        providerId: "zai-coding-plan"
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.z.ai/api/coding/paas/v4/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer z-ai-key"
        },
        method: "GET"
      })
    )
    expect(output.models).toEqual([
      expect.objectContaining({
        capabilities: expect.objectContaining({
          contextWindow: 202_752,
          functionCalling: true,
          maxOutputTokens: 16_384,
          reasoning: true,
          streaming: true
        }),
        id: "glm-5",
        name: "GLM 5"
      })
    ])
  })

  it("records Anthropic capability flags from the models api shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          {
            capabilities: {
              image_input: { supported: true },
              structured_outputs: { supported: true },
              thinking: {
                supported: true,
                types: { adaptive: { supported: true } }
              }
            },
            display_name: "Claude Opus 4.8",
            id: "claude-opus-4-8",
            max_input_tokens: 1_000_000,
            max_tokens: 128_000
          }
        ]
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    const output = await fetchProviderModels({
      provider: {
        apiKey: "sk-ant",
        baseURL: "https://api.anthropic.com/v1",
        providerId: "anthropic"
      }
    })

    expect(output.models).toEqual([
      {
        capabilities: {
          contextWindow: 1_000_000,
          jsonMode: true,
          maxOutputTokens: 128_000,
          reasoning: true,
          vision: true
        },
        id: "claude-opus-4-8",
        isManual: undefined,
        name: "Claude Opus 4.8"
      }
    ])
  })

  it("filters non-chat models out of the openai models list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { id: "gpt-5.4" },
          { id: "whisper-1" },
          { id: "text-embedding-3-large" },
          { id: "dall-e-3" },
          { id: "gpt-4o-mini-tts" },
          { id: "omni-moderation-latest" }
        ]
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    const output = await fetchProviderModels({
      provider: {
        apiKey: "sk-test",
        baseURL: "https://api.openai.com/v1",
        providerId: "openai"
      }
    })

    expect(output.models.map((model) => model.id)).toEqual(["gpt-5.4"])
  })

  it("switches the moonshot models endpoint according to region", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [] }))

    vi.stubGlobal("fetch", fetchMock)

    await fetchProviderModels({
      provider: {
        apiKey: "msk-test",
        baseURL: "https://api.moonshot.cn/v1",
        providerId: "moonshot",
        region: "international"
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.moonshot.ai/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer msk-test"
        }),
        method: "GET"
      })
    )
  })
})
