import type { ProxySettings } from "@etyon/rpc"
import { ProxyAgent, fetch as undiciFetch } from "undici"
import type { Dispatcher, Response as UndiciResponse } from "undici"

const buildProxyToken = (proxy: ProxySettings): string | undefined =>
  proxy.username
    ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`
    : undefined
const buildProxyUri = (proxy: ProxySettings): string =>
  `${proxy.type === "https" ? "https" : "http"}://${proxy.host}:${proxy.port}`

let cachedProxyAgent: { agent: ProxyAgent; key: string } | null = null
const closePreviousAgent = async (agent: ProxyAgent): Promise<void> => {
  try {
    await agent.close()
  } catch {
    await agent.destroy()
  }
}
const getCachedProxyAgent = (proxy: ProxySettings): ProxyAgent => {
  const key = JSON.stringify(proxy)
  if (cachedProxyAgent?.key !== key) {
    if (cachedProxyAgent) {
      void closePreviousAgent(cachedProxyAgent.agent)
    }
    cachedProxyAgent = {
      agent: new ProxyAgent({
        proxyTunnel: true,
        token: buildProxyToken(proxy),
        uri: buildProxyUri(proxy)
      }),
      key
    }
  }
  return cachedProxyAgent.agent
}
export const disposeProxyAwareFetch = async (): Promise<void> => {
  const previous = cachedProxyAgent
  cachedProxyAgent = null
  await previous?.agent.destroy()
}

const iterableBody = (
  body: ReadableStream<Uint8Array>
): AsyncIterable<Uint8Array> => ({
  [Symbol.asyncIterator]: () => {
    const reader = body.getReader()
    let finished = false
    const release = (): void => {
      if (!finished) {
        finished = true
        reader.releaseLock()
      }
    }
    return {
      next: async (): Promise<IteratorResult<Uint8Array>> => {
        if (finished) {
          return { done: true, value: undefined }
        }
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            release()
            return { done: true, value: undefined }
          }
          return { done: false, value: chunk.value }
        } catch (error) {
          release()
          throw error
        }
      },
      return: async (): Promise<IteratorResult<Uint8Array>> => {
        if (!finished) {
          try {
            await reader.cancel()
          } finally {
            release()
          }
        }
        return { done: true, value: undefined }
      }
    }
  }
})

const nativeResponseBody = (
  response: UndiciResponse
): ReadableStream<Uint8Array> | null => {
  const reader = response.body?.getReader()
  if (!reader) {
    return null
  }
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
      if (!(chunk.value instanceof Uint8Array)) {
        throw new TypeError("Invalid response stream chunk")
      }
      controller.enqueue(chunk.value)
    }
  })
}

const copyResponseMetadata = (
  response: Response,
  source: Pick<UndiciResponse, "redirected" | "type" | "url">
): Response => {
  const clone = response.clone.bind(response)
  Object.defineProperties(response, {
    clone: { value: () => copyResponseMetadata(clone(), source) },
    redirected: { value: source.redirected },
    type: { value: source.type },
    url: { value: source.url }
  })
  return response
}

const installedProxyFetch =
  (dispatcher: Dispatcher): typeof globalThis.fetch =>
  async (input, init) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    let body: ArrayBuffer | AsyncIterable<Uint8Array> | undefined
    if (request.body) {
      body = request.keepalive
        ? await request.arrayBuffer()
        : iterableBody(request.body)
    }
    const response = await undiciFetch(request.url, {
      body,
      cache: request.cache,
      credentials: request.credentials,
      dispatcher,
      duplex: "half",
      headers: [...request.headers.entries()],
      integrity: request.integrity,
      keepalive: request.keepalive,
      method: request.method,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal
    })
    return copyResponseMetadata(
      new Response(nativeResponseBody(response), {
        headers: [...response.headers.entries()],
        status: response.status,
        statusText: response.statusText
      }),
      response
    )
  }

// Native fetch and installed undici 8 have different dispatcher contracts.
// Pair the installed dispatcher with its fetch, then bridge Web API types.
export const createProxyAwareFetch = (
  proxy: ProxySettings,
  baseFetch?: typeof globalThis.fetch
): typeof globalThis.fetch => {
  if (!proxy.enabled) {
    return baseFetch ?? globalThis.fetch
  }
  if (proxy.type === "socks5") {
    throw new Error(
      "SOCKS5 proxy is not supported for AI provider requests yet."
    )
  }
  const dispatcher = getCachedProxyAgent(proxy)
  if (baseFetch && baseFetch !== globalThis.fetch) {
    return async (input, init) => {
      const requestInit: RequestInit & { dispatcher: Dispatcher } = {
        ...init,
        dispatcher
      }
      return await baseFetch(input, requestInit)
    }
  }
  return installedProxyFetch(dispatcher)
}
