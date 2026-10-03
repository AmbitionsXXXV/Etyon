import type { WebToolsSettings } from "@etyon/rpc"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { buildWebTools, searchWeb } from "@/main/agents/web/web-tools"

const state = vi.hoisted(() => ({
  decrypt: vi.fn(),
  fetch: vi.fn(),
  settings: {
    enabled: true,
    searchApiKey: "fixture-search-key",
    searchProvider: "brave"
  } as WebToolsSettings
}))
vi.mock("@/main/settings", () => ({
  getSettings: () => ({ proxy: { enabled: false }, webTools: state.settings })
}))
vi.mock("electron", () => ({ safeStorage: { decryptString: state.decrypt } }))
vi.mock("@electron-toolkit/utils", () => ({ platform: { isLinux: false } }))
vi.mock("@/main/agents/web/fetch", () => ({
  fetchPublicText: vi.fn(),
  requestPublicDocument: state.fetch
}))
const jsonResponse = (value: unknown) => ({
  body: JSON.stringify(value),
  contentType: "application/json",
  url: "https://search.example/"
})
beforeEach(() => {
  state.settings = {
    enabled: true,
    searchApiKey: "fixture-search-key",
    searchProvider: "brave"
  }
  state.fetch.mockReset()
  state.decrypt.mockReset()
})

describe("source-backed web search tools", () => {
  it("uses Brave's subscription header and returns bounded source fields", async () => {
    state.fetch.mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            {
              description: "x".repeat(2500),
              title: "Source",
              url: "https://example.com/article"
            }
          ]
        }
      })
    )
    const result = await searchWeb("MCP specification")
    expect(state.fetch.mock.calls[0]?.[0]).toContain(
      "q=MCP%20specification&count=5"
    )
    expect(state.fetch.mock.calls[0]?.[2]).toMatchObject({
      followRedirects: false,
      headers: { "X-Subscription-Token": "fixture-search-key" }
    })
    expect(result).toMatchObject({
      provider: "brave",
      results: [{ title: "Source", url: "https://example.com/article" }]
    })
    expect(result.results[0]?.snippet.length).toBe(2000)
  })
  it("uses Tavily Bearer auth and disables optional expensive search features", async () => {
    state.settings = {
      enabled: true,
      encryptedApiKey: Buffer.from("ciphertext").toString("base64"),
      searchApiKey: "",
      searchProvider: "tavily"
    }
    state.decrypt.mockReturnValue("fixture-tavily-key")
    state.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          {
            content: "Tavily snippet",
            title: "Article",
            url: "https://example.com"
          }
        ]
      })
    )
    const result = await searchWeb("test")
    expect(result.provider).toBe("tavily")
    const options = state.fetch.mock.calls[0]?.[2]
    expect(options).toMatchObject({
      followRedirects: false,
      headers: { authorization: "Bearer fixture-tavily-key" },
      method: "POST"
    })
    expect(JSON.parse(options.body)).toMatchObject({
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      max_results: 5,
      query: "test",
      search_depth: "basic"
    })
  })
  it("filters invalid, private and duplicate source URLs and limits results", async () => {
    state.fetch.mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            { url: "broken-url" },
            { url: "file:///tmp/private" },
            { url: "http://localhost/" },
            { url: "http://10.0.0.1/" },
            { url: "https://user:secret@example.com/" },
            { title: "First", url: "https://example.com/first#one" },
            { title: "Duplicate", url: "https://example.com/first#two" },
            ...Array.from({ length: 8 }, (_value, index) => ({
              title: `${index}`,
              url: `https://example.com/${index}`
            }))
          ]
        }
      })
    )
    const result = await searchWeb("test")
    expect(result.results).toHaveLength(5)
    expect(result.results[0]?.url).toBe("https://example.com/first")
  })
  it("distinguishes a valid empty search from malformed results", async () => {
    state.fetch.mockResolvedValueOnce(jsonResponse({ web: { results: [] } }))
    const result = await searchWeb("test")
    expect(result.results).toEqual([])
    state.fetch.mockResolvedValueOnce(
      jsonResponse({ web: { results: "invalid" } })
    )
    await expect(searchWeb("test")).rejects.toThrow("invalid results")
    state.fetch.mockResolvedValueOnce({
      body: "invalid",
      contentType: "application/json"
    })
    await expect(searchWeb("test")).rejects.toThrow("invalid response")
  })
  it("enforces query limits before spending search requests", async () => {
    await expect(searchWeb("x".repeat(601))).rejects.toThrow()
    await expect(searchWeb("word ".repeat(76))).rejects.toThrow("75 words")
    await expect(searchWeb("   ")).rejects.toThrow()
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it("disables tool exposure and execution when disabled or missing credentials", async () => {
    state.settings = {
      enabled: false,
      searchApiKey: "fixture-key",
      searchProvider: "brave"
    }
    expect(buildWebTools()).toEqual({})
    await expect(searchWeb("test")).rejects.toThrow("disabled")
    state.settings = {
      enabled: true,
      searchApiKey: "",
      searchProvider: "brave"
    }
    expect(Object.keys(buildWebTools())).toEqual(["web_fetch"])
    await expect(searchWeb("test")).rejects.toThrow("Configure")
  })
})
