import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchProviderModels } from "./fetch-provider-models"

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
