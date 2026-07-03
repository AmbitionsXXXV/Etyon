import type { ProxySettings } from "@etyon/rpc"
import type { Dispatcher } from "undici"
import { ProxyAgent } from "undici"

type FetchInit = (RequestInit & { dispatcher?: Dispatcher }) | undefined

const buildProxyToken = (proxy: ProxySettings): string | undefined =>
  proxy.username
    ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`
    : undefined

const buildProxyUri = (proxy: ProxySettings): string =>
  `${proxy.type === "https" ? "https" : "http"}://${proxy.host}:${proxy.port}`

let cachedProxyAgent: { agent: ProxyAgent; key: string } | null = null

const getCachedProxyAgent = (proxy: ProxySettings): ProxyAgent => {
  const key = JSON.stringify(proxy)

  if (cachedProxyAgent?.key !== key) {
    cachedProxyAgent?.agent.close()
    cachedProxyAgent = {
      agent: new ProxyAgent({
        token: buildProxyToken(proxy),
        uri: buildProxyUri(proxy)
      }),
      key
    }
  }

  return cachedProxyAgent.agent
}

// Provider requests (fetching models, running chat completions) all go
// through the AI SDK's `fetch` override, which accepts undici's
// `dispatcher` option even though the DOM RequestInit type doesn't
// declare it.
export const createProxyAwareFetch = (
  proxy: ProxySettings,
  baseFetch: typeof fetch = fetch
): typeof fetch => {
  if (!proxy.enabled) {
    return baseFetch
  }

  if (proxy.type === "socks5") {
    throw new Error(
      "SOCKS5 proxy is not supported for AI provider requests yet."
    )
  }

  const dispatcher = getCachedProxyAgent(proxy)

  return ((input: RequestInfo | URL, init?: RequestInit) =>
    baseFetch(input, { ...init, dispatcher } as FetchInit)) as typeof fetch
}
