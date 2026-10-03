import type { Transform } from "node:stream"
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib"

import type { ProxySettings } from "@etyon/rpc"
import { parseHTML } from "linkedom"
import { Agent, ProxyAgent, request } from "undici"
import type { Dispatcher } from "undici"

import { resolvePublicTarget } from "@/main/agents/web/url-policy"

const MAX_BODY_BYTES = 1024 * 1024
const MAX_TEXT_CHARACTERS = 24_000
const MAX_REDIRECTS = 4
const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:json|xhtml\+xml))/iu
const CHARSET_PATTERN = /charset=["']?([^\s;"']+)/iu
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const targetDispatcher = (
  proxy: ProxySettings,
  hostname: string
): Dispatcher => {
  if (!proxy.enabled) {
    return new Agent({ connect: { servername: hostname } })
  }
  if (proxy.type === "socks5") {
    throw new Error(
      "Web requests require an HTTP(S) proxy. SOCKS5 is not supported."
    )
  }
  return new ProxyAgent({
    proxyTunnel: true,
    requestTls: { servername: hostname },
    token: proxy.username
      ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`
      : undefined,
    uri: `${proxy.type === "https" ? "https" : "http"}://${proxy.host}:${proxy.port}`
  })
}

const decodeBody = (body: Uint8Array, contentType: string): string => {
  const charset = CHARSET_PATTERN.exec(contentType)?.[1] ?? "utf-8"
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder().decode(body)
  }
}

const responseHeader = (
  headers: Dispatcher.ResponseData["headers"],
  key: string
): string => {
  const value = headers[key]
  return typeof value === "string" ? value : ""
}

const discardBody = (body: Dispatcher.ResponseData["body"]): void => {
  body.once("error", () => {
    /* Discarding a response intentionally aborts the unread stream. */
  })
  body.destroy()
}

const contentDecoder = (encoding: string): Transform | null => {
  switch (encoding.trim().toLowerCase()) {
    case "":
    case "identity": {
      return null
    }
    case "gzip": {
      return createGunzip()
    }
    case "deflate": {
      return createInflate()
    }
    case "br": {
      return createBrotliDecompress()
    }
    default: {
      throw new Error("The page returned an unsupported content encoding")
    }
  }
}

const readResponseBody = async (
  response: Dispatcher.ResponseData,
  contentType: string
): Promise<string> => {
  let decoder: Transform | null
  try {
    decoder = contentDecoder(
      responseHeader(response.headers, "content-encoding")
    )
  } catch (error) {
    discardBody(response.body)
    throw error
  }
  let downloadedSize = 0
  if (decoder) {
    response.body.on("error", (error: Error) => {
      decoder.destroy(error)
    })
    response.body.on("data", (chunk: Uint8Array) => {
      downloadedSize += chunk.byteLength
      if (downloadedSize > MAX_BODY_BYTES) {
        response.body.destroy(new Error("The page exceeded the download limit"))
      }
    })
  }
  const stream = decoder ? response.body.pipe(decoder) : response.body
  const buffers: Uint8Array[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      const bytes: unknown = chunk
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("The page returned an invalid body chunk")
      }
      size += bytes.byteLength
      if (size > MAX_BODY_BYTES) {
        throw new Error("The page exceeded the download limit")
      }
      buffers.push(bytes)
    }
  } finally {
    response.body.destroy()
    decoder?.destroy()
  }
  return decodeBody(Buffer.concat(buffers), contentType)
}

export const requestPublicDocument = async (
  input: string,
  proxy: ProxySettings,
  options: {
    body?: string
    followRedirects: boolean
    headers?: Record<string, string>
    method?: "GET" | "POST"
    signal?: AbortSignal
  }
): Promise<{ body: string; contentType: string; url: string }> => {
  let destination = input
  const timeout = AbortSignal.timeout(30_000)
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    requestSignal.throwIfAborted()
    const { address, url } = await resolvePublicTarget(
      destination,
      requestSignal
    )
    const pinned = new URL(url)
    pinned.hostname = address.includes(":") ? `[${address}]` : address
    const hostname = url.hostname.replaceAll(/^\[|\]$/gu, "")
    const dispatcher = targetDispatcher(proxy, hostname)
    try {
      // Fetch forbids overriding Host. The request API preserves it while
      // the validated IP remains the physical connection target.
      const response = await request(pinned, {
        body: options.body,
        dispatcher,
        headers: {
          accept: "text/html,text/plain,application/json,application/xhtml+xml",
          "accept-encoding": "gzip, deflate, br",
          ...options.headers,
          host: url.host
        },
        method: options.method ?? "GET",
        signal: requestSignal
      })
      if (REDIRECT_STATUSES.has(response.statusCode)) {
        const location = responseHeader(response.headers, "location")
        discardBody(response.body)
        if (!options.followRedirects) {
          throw new Error(
            "Authenticated search requests cannot follow redirects"
          )
        }
        if (!location) {
          throw new Error("Redirect has no destination")
        }
        if (redirect === MAX_REDIRECTS) {
          throw new Error("The page exceeded the redirect limit")
        }
        destination = new URL(location, url).href
        continue
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        discardBody(response.body)
        throw new Error(`The page returned HTTP ${response.statusCode}`)
      }
      const contentType = responseHeader(
        response.headers,
        "content-type"
      ).toLowerCase()
      if (!TEXT_CONTENT_TYPE.test(contentType)) {
        discardBody(response.body)
        throw new Error("The URL is not a text document")
      }
      return {
        body: await readResponseBody(response, contentType),
        contentType,
        url: url.href
      }
    } finally {
      await dispatcher.destroy()
    }
  }
  throw new Error("The page exceeded the redirect limit")
}

export const fetchPublicText = async (
  input: string,
  proxy: ProxySettings,
  signal?: AbortSignal
): Promise<{
  text: string
  title: string
  truncated: boolean
  url: string
}> => {
  const response = await requestPublicDocument(input, proxy, {
    followRedirects: true,
    signal
  })
  let text = response.body
  let title = ""
  if (response.contentType.includes("html")) {
    const { document } = parseHTML(response.body)
    for (const node of document.querySelectorAll(
      "script,style,noscript,template,[hidden],[aria-hidden='true']"
    )) {
      node.remove()
    }
    title = document.title.trim().slice(0, 300)
    text =
      (document.querySelector("main,article") ?? document.body)?.textContent ??
      ""
  }
  const normalized = text
    .replaceAll(/[^\S\n]+/gu, " ")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim()
  return {
    text: normalized.slice(0, MAX_TEXT_CHARACTERS),
    title,
    truncated: normalized.length > MAX_TEXT_CHARACTERS,
    url: response.url
  }
}
