import http from "node:http"
import https from "node:https"
import type { Socket } from "node:net"
import tls from "node:tls"

import type { TestProxyInput, TestProxyOutput } from "@etyon/rpc"

const IP_TEST_HOST = "ipinfo.io"
const IP_TEST_PATH = "/json"
const IP_TEST_PORT = 443

const COUNTRY_FLAG_OFFSET = 0x1_f1_e6 - 65

const buildProxyAuth = (username: string, password: string): string | null => {
  if (!username) {
    return null
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

const connectTunnel = (
  proxy: TestProxyInput["proxy"],
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<Socket> =>
  // eslint-disable-next-line promise/avoid-new -- low-level socket plumbing requires Promise constructor
  new Promise((resolve, reject) => {
    const proxyAuth = buildProxyAuth(proxy.username, proxy.password)
    const target = `${targetHost}:${targetPort}`

    const doConnect = (proxySocket?: Socket) => {
      const connectReq = http.request({
        headers: {
          Host: target,
          ...(proxyAuth ? { "Proxy-Authorization": proxyAuth } : {})
        },
        host: proxy.host,
        method: "CONNECT",
        path: target,
        port: proxy.port,
        timeout: timeoutMs,
        ...(proxySocket ? { createConnection: () => proxySocket } : {})
      })

      connectReq.on("connect", (_res, socket) => {
        resolve(socket)
      })

      connectReq.on("response", (res) => {
        res.resume()
        reject(
          new Error(
            `Proxy returned HTTP ${res.statusCode} instead of CONNECT tunnel`
          )
        )
      })

      connectReq.on("error", reject)

      connectReq.on("timeout", () => {
        connectReq.destroy()
        reject(new Error("Proxy connection timed out"))
      })

      connectReq.end()
    }

    if (proxy.type === "https") {
      const proxyTls = tls.connect(
        { host: proxy.host, port: proxy.port, servername: proxy.host },
        () => {
          doConnect(proxyTls)
        }
      )
      proxyTls.on("error", reject)
    } else {
      doConnect()
    }
  })

const httpsGetViaSocket = (
  rawSocket: Socket,
  host: string,
  path: string,
  timeoutMs: number
): Promise<{ body: string; status: number }> =>
  // eslint-disable-next-line promise/avoid-new -- low-level socket plumbing requires Promise constructor
  new Promise((resolve, reject) => {
    const tlsSocket = tls.connect(
      { host, servername: host, socket: rawSocket },
      () => {
        const req = https.request(
          {
            createConnection: () => tlsSocket,
            headers: { Host: host },
            hostname: host,
            method: "GET",
            path,
            port: IP_TEST_PORT
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on("data", (c: Buffer) => chunks.push(c))
            res.on("end", () => {
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                status: res.statusCode ?? 0
              })
              tlsSocket.destroy()
            })
          }
        )
        req.on("error", (e) => {
          tlsSocket.destroy()
          reject(e)
        })
        req.on("timeout", () => {
          tlsSocket.destroy()
          reject(new Error("Target request timed out"))
        })
        req.setTimeout(timeoutMs)
        req.end()
      }
    )

    tlsSocket.on("error", reject)
  })

interface IpInfo {
  city?: string
  country?: string
  ip?: string
  region?: string
}

const countryCodeToFlag = (code: string): string => {
  const upper = code.toUpperCase()
  const cp0 = upper.codePointAt(0)
  const cp1 = upper.codePointAt(1)
  if (cp0 === undefined || cp1 === undefined) {
    return code
  }
  return String.fromCodePoint(
    cp0 + COUNTRY_FLAG_OFFSET,
    cp1 + COUNTRY_FLAG_OFFSET
  )
}

export const testProxy = async (
  input: TestProxyInput
): Promise<TestProxyOutput> => {
  const { proxy, timeoutMs } = input
  const startTime = performance.now()

  try {
    if (proxy.type === "socks5") {
      throw new Error("SOCKS5 proxy testing is not yet supported")
    }

    const rawSocket = await connectTunnel(
      proxy,
      IP_TEST_HOST,
      IP_TEST_PORT,
      timeoutMs
    )
    const { body, status } = await httpsGetViaSocket(
      rawSocket,
      IP_TEST_HOST,
      IP_TEST_PATH,
      timeoutMs
    )
    const latencyMs = Math.round(performance.now() - startTime)

    let ipInfo: IpInfo = {}
    try {
      ipInfo = JSON.parse(body) as IpInfo
    } catch {
      // ipinfo.io returned non-JSON
    }

    const countryCode = ipInfo.country ?? undefined
    const countryFlag = countryCode ? countryCodeToFlag(countryCode) : undefined

    return {
      countryCode,
      countryFlag,
      ip: ipInfo.ip,
      latencyMs,
      ok: true,
      status
    }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime)

    return {
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
      ok: false
    }
  }
}
