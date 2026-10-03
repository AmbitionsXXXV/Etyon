import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib"

import type { ProxySettings } from "@etyon/rpc"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { fetchPublicText, requestPublicDocument } from "@/main/agents/web/fetch"

const state = vi.hoisted(() => ({
  agents: [] as unknown[],
  destroy: vi.fn(),
  fetch: vi.fn(),
  lookup: vi.fn(),
  proxies: [] as unknown[]
}))
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }))
vi.mock("undici", async () => {
  const { Readable } = await import("node:stream")
  class TestDispatcher {
    constructor(options: unknown) {
      if (options && typeof options === "object" && "uri" in options) {
        state.proxies.push(options)
      } else {
        state.agents.push(options)
      }
    }
    destroy = state.destroy
  }
  return {
    Agent: TestDispatcher,
    ProxyAgent: TestDispatcher,
    request: async (input: URL, init: Record<string, unknown>) => {
      const response: Response = await state.fetch(input, {
        ...init,
        redirect: "manual"
      })
      return {
        body: Readable.from([new Uint8Array(await response.arrayBuffer())]),
        headers: Object.fromEntries(response.headers.entries()),
        statusCode: response.status
      }
    }
  }
})
const direct: ProxySettings = {
  enabled: false,
  host: "localhost",
  password: "",
  port: 7890,
  type: "http",
  username: ""
}
const textResponse = (body: string, contentType = "text/html") =>
  new Response(body, { headers: { "content-type": contentType } })
beforeEach(() => {
  state.agents = []
  state.proxies = []
  state.destroy.mockReset().mockImplementation(() => Promise.resolve())
  state.fetch.mockReset()
  state.lookup
    .mockReset()
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
})

describe("bounded public document fetch", () => {
  it.each([
    { compress: gzipSync, encoding: "gzip" },
    { compress: deflateSync, encoding: "deflate" },
    { compress: brotliCompressSync, encoding: "br" }
  ])(
    "decodes $encoding text and enforces the decompressed budget",
    async ({ compress, encoding }) => {
      state.fetch.mockResolvedValueOnce(
        new Response(
          new Uint8Array(compress(Buffer.from("Compressed source text."))),
          {
            headers: {
              "content-encoding": encoding,
              "content-type": "text/plain"
            }
          }
        )
      )
      const result = await fetchPublicText("https://example.com", direct)
      expect(result.text).toBe("Compressed source text.")
      state.fetch.mockResolvedValueOnce(
        new Response(
          new Uint8Array(compress(Buffer.from("x".repeat(1024 * 1024 + 1)))),
          {
            headers: {
              "content-encoding": encoding,
              "content-type": "text/plain"
            }
          }
        )
      )
      await expect(
        fetchPublicText("https://example.com", direct)
      ).rejects.toThrow("download limit")
    }
  )
  it("pins DNS while preserving HTTP Host and TLS SNI and extracts article text", async () => {
    state.fetch.mockResolvedValue(
      textResponse(
        "<html><head><title>Source title</title></head><body><nav>Navigation</nav><main><h1>Heading</h1><p>First paragraph.</p><p>Second paragraph.</p><script>steal()</script><style>hidden</style><p hidden>private-hidden</p></main></body></html>"
      )
    )
    const result = await fetchPublicText("https://example.com/path", direct)
    expect(state.fetch.mock.calls[0]?.[0].href).toBe(
      "https://93.184.216.34/path"
    )
    expect(state.fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { host: "example.com" },
      redirect: "manual"
    })
    expect(state.agents[0]).toMatchObject({
      connect: { servername: "example.com" }
    })
    expect(result).toMatchObject({
      title: "Source title",
      truncated: false,
      url: "https://example.com/path"
    })
    expect(result.text).toContain("First paragraph.")
    expect(result.text).toContain("Second paragraph.")
    expect(result.text).not.toContain("Navigation")
    expect(result.text).not.toContain("steal")
    expect(result.text).not.toContain("private-hidden")
    expect(state.destroy).toHaveBeenCalledTimes(1)
  })
  it("revalidates every redirect and rejects a private redirect target", async () => {
    state.fetch.mockResolvedValue(
      new Response(null, {
        headers: { location: "http://169.254.169.254/latest/meta-data" },
        status: 302
      })
    )
    await expect(
      fetchPublicText("https://example.com", direct)
    ).rejects.toThrow("private")
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it("blocks a DNS rebind across a relative redirect", async () => {
    state.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
    state.fetch.mockResolvedValue(
      new Response(null, { headers: { location: "/second" }, status: 301 })
    )
    await expect(
      fetchPublicText("https://example.com/first", direct)
    ).rejects.toThrow("private")
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it("uses the configured HTTPS proxy and keeps destination TLS identity", async () => {
    state.fetch.mockResolvedValue(textResponse("public", "text/plain"))
    await fetchPublicText("https://example.com", {
      ...direct,
      enabled: true,
      host: "proxy.example",
      password: "test-password",
      type: "https",
      username: "test-user"
    })
    expect(state.agents).toHaveLength(0)
    expect(state.proxies[0]).toMatchObject({
      requestTls: { servername: "example.com" },
      token: `Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
      uri: "https://proxy.example:7890"
    })
  })
  it("fails a SOCKS5 configuration without falling back to direct requests", async () => {
    await expect(
      fetchPublicText("https://example.com", {
        ...direct,
        enabled: true,
        type: "socks5"
      })
    ).rejects.toThrow("SOCKS5")
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.agents).toHaveLength(0)
  })
  it("refuses to redirect an authenticated search request", async () => {
    state.fetch.mockResolvedValue(
      new Response(null, {
        headers: { location: "https://another.example/" },
        status: 307
      })
    )
    await expect(
      requestPublicDocument("https://example.com", direct, {
        followRedirects: false,
        headers: { authorization: "Bearer fake-key" },
        method: "POST"
      })
    ).rejects.toThrow("cannot follow redirects")
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it("enforces the redirect budget", async () => {
    state.fetch.mockImplementation(
      () => new Response(null, { headers: { location: "/next" }, status: 302 })
    )
    await expect(
      fetchPublicText("https://example.com", direct)
    ).rejects.toThrow("redirect limit")
    expect(state.fetch).toHaveBeenCalledTimes(5)
  })
  it("rejects oversized and non-text responses and always destroys the dispatcher", async () => {
    state.fetch.mockResolvedValueOnce(
      textResponse("x".repeat(1024 * 1024 + 1), "text/plain")
    )
    await expect(
      fetchPublicText("https://example.com", direct)
    ).rejects.toThrow("download limit")
    state.fetch.mockResolvedValueOnce(
      textResponse("binary", "application/octet-stream")
    )
    await expect(
      fetchPublicText("https://example.com", direct)
    ).rejects.toThrow("text document")
    expect(state.destroy).toHaveBeenCalledTimes(2)
  })
  it("bounds returned text and honors the response charset", async () => {
    state.fetch.mockResolvedValueOnce(
      textResponse("x".repeat(24_001), "text/plain")
    )
    const long = await fetchPublicText("https://example.com", direct)
    expect(long.text.length).toBe(24_000)
    expect(long.truncated).toBe(true)
    state.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), {
        headers: { "content-type": "text/plain; charset=iso-8859-1" }
      })
    )
    const decoded = await fetchPublicText("https://example.com", direct)
    expect(decoded.text).toBe("café")
  })
  it("does no work for an already cancelled request", async () => {
    await expect(
      fetchPublicText(
        "https://example.com",
        direct,
        AbortSignal.abort(new Error("Cancelled"))
      )
    ).rejects.toThrow("Cancelled")
    expect(state.lookup).not.toHaveBeenCalled()
    expect(state.fetch).not.toHaveBeenCalled()
  })
})
