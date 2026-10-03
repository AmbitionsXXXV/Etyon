import { createServer } from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"
import { gzipSync } from "node:zlib"

import type { ProxySettings } from "@etyon/rpc"
import { describe, expect, it, vi } from "vite-plus/test"

import { fetchPublicText } from "@/main/agents/web/fetch"

import { closeHttpServer, listenHttpServer } from "../../fixtures/http-server"

const state = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }))

describe("public fetching through a real HTTP proxy", () => {
  it("CONNECTs to the pinned public IP, keeps Host, auth and redirect origin, and never makes a direct request", async () => {
    state.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    const hosts: (string | undefined)[] = []
    const tunnels: {
      authorization: string | undefined
      target: string | undefined
    }[] = []
    const sockets = new Set<Duplex>()
    const source = createServer((request, response) => {
      hosts.push(request.headers.host)
      if (request.url === "/first") {
        response.writeHead(302, { location: "/second" }).end()
      } else {
        response
          .writeHead(200, {
            "content-encoding": "gzip",
            "content-type": "text/html"
          })
          .end(
            gzipSync(
              "<html><head><title>Proxy fixture</title></head><body><main><p>Source through proxy.</p></main></body></html>"
            )
          )
      }
    })
    const sourcePort = await listenHttpServer(source)
    const proxyServer = createServer()
    proxyServer.on("request", (_request, response) => {
      response.writeHead(501).end()
    })
    proxyServer.on("connect", (request, socket, head) => {
      sockets.add(socket)
      tunnels.push({
        authorization: request.headers["proxy-authorization"],
        target: request.url
      })
      const upstream = connect(sourcePort, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length) {
          upstream.write(head)
        }
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      sockets.add(upstream)
      socket.on("close", () => {
        sockets.delete(socket)
        upstream.destroy()
      })
      socket.on("end", () => {
        socket.destroy()
      })
      upstream.on("close", () => {
        sockets.delete(upstream)
        socket.destroy()
      })
      upstream.on("error", () => {
        socket.destroy()
      })
    })
    const proxyPort = await listenHttpServer(proxyServer)
    const proxy: ProxySettings = {
      enabled: true,
      host: "127.0.0.1",
      password: "fixture-password",
      port: proxyPort,
      type: "http",
      username: "fixture-user"
    }
    try {
      const result = await fetchPublicText("http://source.example/first", proxy)
      expect(result).toMatchObject({
        text: "Source through proxy.",
        title: "Proxy fixture",
        url: "http://source.example/second"
      })
      expect(hosts).toEqual(["source.example", "source.example"])
      expect(tunnels).toHaveLength(2)
      for (const tunnel of tunnels) {
        expect(tunnel.target).toBe("93.184.216.34:80")
        expect(tunnel.authorization).toBe(
          `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`
        )
      }
      expect(state.lookup).toHaveBeenCalledTimes(2)
    } finally {
      for (const socket of sockets) {
        socket.destroy()
      }
      await Promise.all([closeHttpServer(source), closeHttpServer(proxyServer)])
    }
  })
})
