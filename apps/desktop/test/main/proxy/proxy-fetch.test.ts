import { createServer } from "node:http"

import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  createProxyAwareFetch,
  disposeProxyAwareFetch
} from "@/main/proxy/proxy-fetch"

import { createConnectProxy } from "../../fixtures/http-proxy"
import { closeHttpServer, listenHttpServer } from "../../fixtures/http-server"

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
afterEach(async () => {
  await disposeProxyAwareFetch()
})

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
  it("uses a real CONNECT proxy with native Request overrides and streams a native Response", async () => {
    const requests: {
      body: string
      custom: string | undefined
      method: string | undefined
      url: string | undefined
    }[] = []
    const source = createServer(async (request, response) => {
      let body = ""
      for await (const chunk of request) {
        body += String(chunk)
      }
      requests.push({
        body,
        custom: request.headers["x-fixture"] as string | undefined,
        method: request.method,
        url: request.url
      })
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/result" }).end()
        return
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true }))
    })
    const sourcePort = await listenHttpServer(source)
    const proxy = await createConnectProxy(sourcePort)
    try {
      const fetch = createProxyAwareFetch({
        ...HTTP_PROXY,
        host: "127.0.0.1",
        password: "test-password",
        port: proxy.port,
        username: "test-user"
      })
      const request = new Request("http://api.example.com/submit", {
        body: "original",
        headers: { "x-fixture": "original" },
        method: "POST"
      })
      const response = await fetch(request, {
        // eslint-disable-next-line unicorn/no-invalid-fetch-options -- The native Request carries POST; this verifies inherited method with a body override.
        body: "overridden",
        headers: { "x-fixture": "override" }
      })
      expect(response).toBeInstanceOf(Response)
      expect(response.url).toBe("http://api.example.com/submit")
      const cloned = response.clone()
      expect(cloned.url).toBe(response.url)
      expect(await response.json()).toEqual({ ok: true })
      expect(await cloned.json()).toEqual({ ok: true })
      expect(requests[0]).toMatchObject({
        body: "overridden",
        custom: "override",
        method: "POST",
        url: "/submit"
      })
      const redirected = await fetch("http://api.example.com/redirect")
      expect(redirected.redirected).toBe(true)
      expect(redirected.url).toBe("http://api.example.com/result")
      await redirected.body?.cancel()
      await expect(
        fetch("http://api.example.com/cancelled", {
          signal: AbortSignal.abort(new Error("Test cancellation"))
        })
      ).rejects.toThrow("Test cancellation")
      expect(requests.some((entry) => entry.url === "/cancelled")).toBe(false)
      for (const tunnel of proxy.tunnels) {
        expect(tunnel.target).toBe("api.example.com:80")
        expect(tunnel.authorization).toBe(
          `Basic ${Buffer.from("test-user:test-password").toString("base64")}`
        )
      }
    } finally {
      await disposeProxyAwareFetch()
      await proxy.close()
      await closeHttpServer(source)
    }
  })
})
