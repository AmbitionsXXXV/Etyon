import { describe, expect, it, vi } from "vite-plus/test"

import { createProxyAwareFetch } from "@/main/proxy/proxy-fetch"

const DISABLED_PROXY = {
  enabled: false,
  host: "",
  password: "",
  port: 8080,
  type: "http" as const,
  username: ""
}

const HTTP_PROXY = {
  enabled: true,
  host: "proxy.example.com",
  password: "",
  port: 8080,
  type: "http" as const,
  username: ""
}

describe("createProxyAwareFetch", () => {
  it("passes through the base fetch untouched when the proxy is disabled", () => {
    const baseFetch = vi.fn() as unknown as typeof fetch

    expect(createProxyAwareFetch(DISABLED_PROXY, baseFetch)).toBe(baseFetch)
  })

  it("throws for socks5 proxies instead of silently ignoring them", () => {
    expect(() =>
      createProxyAwareFetch(
        { ...HTTP_PROXY, type: "socks5" },
        vi.fn() as unknown as typeof fetch
      )
    ).toThrow("SOCKS5 proxy is not supported")
  })

  it("injects an undici dispatcher into requests when the proxy is enabled", async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValue(new Response("ok")) as unknown as typeof fetch
    const proxyAwareFetch = createProxyAwareFetch(HTTP_PROXY, baseFetch)

    expect(proxyAwareFetch).not.toBe(baseFetch)

    await proxyAwareFetch("https://api.example.com/v1/models")

    expect(baseFetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({ dispatcher: expect.anything() })
    )
  })

  it("reuses the same dispatcher for an unchanged proxy config", async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValue(new Response("ok")) as unknown as typeof fetch
    const proxyAwareFetch = createProxyAwareFetch(HTTP_PROXY, baseFetch)

    await proxyAwareFetch("https://a.example.com")
    await proxyAwareFetch("https://b.example.com")

    const mockedBaseFetch = vi.mocked(baseFetch)
    const [[, firstInit], [, secondInit]] = mockedBaseFetch.mock.calls

    expect(firstInit).toMatchObject({ dispatcher: expect.anything() })
    expect((firstInit as { dispatcher?: unknown })?.dispatcher).toBe(
      (secondInit as { dispatcher?: unknown })?.dispatcher
    )
  })
})
