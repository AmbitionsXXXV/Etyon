import type { ProxySettings } from "@etyon/rpc"
import type { FetchLike } from "@modelcontextprotocol/client"
import { Agent, ProxyAgent, fetch } from "undici"
import type { Dispatcher, Response as UndiciResponse } from "undici"

const MAX_RESPONSE_BYTES = 1024 * 1024

const limitedResponseBody = (
  response: UndiciResponse
): ReadableStream<Uint8Array> | null => {
  const reader = response.body?.getReader()
  if (!reader) {
    return null
  }
  let size = 0
  return new ReadableStream<Uint8Array>({
    cancel: async (reason: unknown) => {
      await reader.cancel(reason)
    },
    pull: async (controller) => {
      const chunk = await reader.read()
      if (chunk.done) {
        controller.close()
        return
      }
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        controller.error(new Error("MCP response exceeded the download limit"))
        return
      }
      controller.enqueue(chunk.value)
    }
  })
}

export const createMcpHttpFetch = (endpoint: URL, proxy: ProxySettings) => {
  if (proxy.enabled && proxy.type === "socks5") {
    throw new Error(
      "MCP HTTP requests require an HTTP(S) proxy. SOCKS5 is not supported."
    )
  }
  const dispatcher: Dispatcher = proxy.enabled
    ? new ProxyAgent({
        proxyTunnel: true,
        token: proxy.username
          ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`
          : undefined,
        uri: `${proxy.type === "https" ? "https" : "http"}://${proxy.host}:${proxy.port}`
      })
    : new Agent()
  const limitedFetch: FetchLike = async (input, init) => {
    const destination = new URL(input)
    if (destination.origin !== endpoint.origin) {
      throw new Error("MCP requests cannot send credentials to another origin")
    }
    const body = init?.body ?? undefined
    if (body !== undefined && typeof body !== "string") {
      throw new TypeError(
        "MCP transport only supports JSON string request bodies"
      )
    }
    // Use this package's fetch with its dispatcher: Node's bundled undici may
    // implement an older dispatcher handler contract than installed undici 8.
    const response = await fetch(destination, {
      body,
      dispatcher,
      headers: [...new Headers(init?.headers).entries()],
      method: init?.method,
      redirect: "error",
      signal: init?.signal ?? undefined
    })
    return new Response(limitedResponseBody(response), {
      headers: [...response.headers.entries()],
      status: response.status,
      statusText: response.statusText
    })
  }
  return {
    close: async () => {
      await dispatcher.destroy()
    },
    fetch: limitedFetch
  }
}
