import { createServer } from "node:http"

import type { ProxySettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import { createMcpHttpFetch } from "@/main/agents/mcp/http-transport"

import { closeHttpServer, listenHttpServer } from "../../fixtures/http-server"

const direct: ProxySettings = {
  enabled: false,
  host: "localhost",
  password: "",
  port: 7890,
  type: "http",
  username: ""
}
describe("MCP HTTP transport boundaries", () => {
  it("bounds a real streaming response and refuses redirects and different origins", async () => {
    let requests = 0
    const server = createServer((request, response) => {
      requests += 1
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "http://localhost:1/secret" }).end()
      } else {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end("x".repeat(1024 * 1024 + 1))
      }
    })
    const port = await listenHttpServer(server)
    const endpoint = new URL(`http://127.0.0.1:${port}/mcp`)
    const http = createMcpHttpFetch(endpoint, direct)
    try {
      const response = await http.fetch(endpoint)
      await expect(response.text()).rejects.toThrow("download limit")
      await expect(
        http.fetch(new URL("/redirect", endpoint), {
          headers: { authorization: "Bearer fixture-key" }
        })
      ).rejects.toThrow()
      await expect(
        http.fetch("https://another.example/mcp", {
          headers: { authorization: "Bearer fixture-key" }
        })
      ).rejects.toThrow("another origin")
      expect(requests).toBe(2)
    } finally {
      await http.close()
      await closeHttpServer(server)
    }
  })
})
