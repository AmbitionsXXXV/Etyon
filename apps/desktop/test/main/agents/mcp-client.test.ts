import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { McpServerConfig } from "@etyon/rpc"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  callMcpTool,
  connectMcpServer,
  disconnectMcpServer,
  disposeMcpConnections,
  getMcpTools,
  listMcpStatuses,
  syncMcpConnections
} from "@/main/agents/mcp/client-manager"

import { closeHttpServer, listenHttpServer } from "../../fixtures/http-server"

const state = vi.hoisted(() => ({
  proxy: {
    enabled: false,
    host: "127.0.0.1",
    password: "",
    port: 7890,
    type: "http" as const,
    username: ""
  },
  servers: [] as McpServerConfig[]
}))
vi.mock("@/main/settings", () => ({
  getSettings: () => ({ mcp: { servers: state.servers }, proxy: state.proxy })
}))
const fixtureServer = (
  args: string[] = [],
  env: Record<string, string> = {}
): McpServerConfig => ({
  args: [
    fileURLToPath(
      new URL("../../fixtures/mcp-stdio-server.mjs", import.meta.url)
    ),
    ...args
  ],
  command: process.execPath,
  enabled: true,
  env,
  id: "test",
  name: "Test server",
  protocol: "legacy",
  transport: "stdio"
})
vi.mock("electron", () => ({
  app: { getVersion: () => "0.1.0-test" },
  safeStorage: {}
}))

afterEach(async () => {
  await disposeMcpConnections()
  state.servers = []
  vi.unstubAllEnvs()
})
describe("MCP client lifecycle", () => {
  it("connects to a real stdio fixture, discovers tools and invokes them", async () => {
    state.servers = [
      {
        args: [
          fileURLToPath(
            new URL("../../fixtures/mcp-stdio-server.mjs", import.meta.url)
          )
        ],
        command: process.execPath,
        enabled: true,
        env: {},
        id: "test",
        name: "Test server",
        protocol: "legacy",
        transport: "stdio"
      }
    ]
    await connectMcpServer("test")
    expect(listMcpStatuses()).toMatchObject([
      { serverId: "test", state: "connected", tools: [{ name: "add" }] }
    ])
    const tools = getMcpTools()
    const [name] = Object.keys(tools)
    expect(name).toMatch(/^mcp__/u)
    const result = await callMcpTool("test", "add", { a: 2, b: 3 })
    expect(result).toMatchObject({ content: [{ text: "5", type: "text" }] })
    expect(getMcpTools(true)).toEqual({})
  })
  it("rejects disabled servers and disposes connections when disabled", async () => {
    state.servers = [
      {
        args: [
          fileURLToPath(
            new URL("../../fixtures/mcp-stdio-server.mjs", import.meta.url)
          )
        ],
        command: process.execPath,
        enabled: true,
        env: {},
        id: "test",
        name: "Test server",
        protocol: "legacy",
        transport: "stdio"
      }
    ]
    await connectMcpServer("test")
    state.servers = state.servers.map((server) => ({
      ...server,
      enabled: false
    }))
    await syncMcpConnections()
    expect(getMcpTools()).toEqual({})
    await expect(connectMcpServer("test")).rejects.toThrow("disabled")
  })
  it("shares concurrent connection attempts and keeps explicit disconnects closed", async () => {
    state.servers = [fixtureServer(["--lifecycle"])]
    const [first, second] = await Promise.all([
      connectMcpServer("test"),
      connectMcpServer("test")
    ])
    expect(first).toBe(second)
    await disconnectMcpServer("test")
    await syncMcpConnections()
    expect(listMcpStatuses()[0]?.state).toBe("disconnected")
    await expect(callMcpTool("test", "identity", {})).rejects.toThrow(
      "disconnected"
    )
    await connectMcpServer("test", true)
    expect(listMcpStatuses()[0]?.state).toBe("connected")
  })
  it("cancels connecting processes on disconnect and shutdown without restoring them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "etyon-mcp-"))
    const spawnLog = path.join(directory, "spawn.log")
    try {
      for (const teardown of [
        disconnectMcpServer,
        async () => {
          await disposeMcpConnections()
        }
      ]) {
        state.servers = [
          fixtureServer(["--delay"], { MCP_TEST_SPAWN_LOG: spawnLog })
        ]
        let previousPids = ""
        try {
          previousPids = await readFile(spawnLog, "utf-8")
        } catch {
          /* First spawn has no log yet. */
        }
        const pending = connectMcpServer("test", true)
        const rejected = expect(pending).rejects.toThrow()
        await vi.waitFor(async () => {
          const contents = await readFile(spawnLog, "utf-8")
          expect(contents.length).toBeGreaterThan(previousPids.length)
        })
        await teardown("test")
        await rejected
        expect(listMcpStatuses()[0]?.state).toBe("disconnected")
        const contents = await readFile(spawnLog, "utf-8")
        const pids = contents.trim().split("\n").map(Number)
        await vi.waitFor(() => {
          for (const pid of pids) {
            expect(() => process.kill(pid, 0)).toThrow()
          }
        })
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
  it("rejects stale tool closures after a configuration change", async () => {
    state.servers = [fixtureServer()]
    await connectMcpServer("test")
    const [descriptor] = Object.values(getMcpTools())
    state.servers = [fixtureServer(["--lifecycle"])]
    await syncMcpConnections()
    await expect(
      descriptor?.execute?.(
        { a: 1, b: 2 },
        { context: {}, messages: [], toolCallId: "stale" }
      )
    ).rejects.toThrow("changed")
    expect(
      listMcpStatuses()[0]?.tools.some((entry) => entry.name === "identity")
    ).toBe(true)
  })
  it("filters parent secrets, preserves Homebrew PATH, and redacts configured secrets", async () => {
    vi.stubEnv("ETYON_TEST_PARENT_SECRET", "parent-secret-never-inherit")
    state.servers = [
      fixtureServer(["--lifecycle"], {
        MCP_TEST_SECRET: "fixture-test-secret-123"
      })
    ]
    const result = await callMcpTool("test", "identity", {})
    const block = result.content?.[0]
    expect(block?.type).toBe("text")
    if (block?.type !== "text" || typeof block.text !== "string") {
      throw new Error("Expected text")
    }
    const identity = JSON.parse(block.text) as {
      hasParentSecret: boolean
      path: string
    }
    expect(identity.hasParentSecret).toBe(false)
    expect(identity.path).toContain("/opt/homebrew/bin")
    await expect(callMcpTool("test", "error", {})).rejects.toThrow("[REDACTED]")
    expect(await callMcpTool("test", "secret", {})).toMatchObject({
      content: [{ text: "[REDACTED]" }]
    })
    await expect(callMcpTool("test", "large", {})).rejects.toThrow(
      "output limit"
    )
  })
  it("bounds catalogs and schemas and reads paginated discovery", async () => {
    state.servers = [fixtureServer(["--large-catalog"])]
    await connectMcpServer("test")
    const [status] = listMcpStatuses()
    expect(status).toMatchObject({ catalogTruncated: true, toolCount: 62 })
    expect(status?.tools.length).toBe(40)
    expect(status?.descriptionBytes).toBeLessThanOrEqual(64 * 1024)
    expect(status?.tools.some((entry) => entry.name === "oversized")).toBe(
      false
    )
    for (const alias of Object.keys(getMcpTools())) {
      expect(alias.length).toBeLessThanOrEqual(64)
    }
    state.servers = [fixtureServer(["--pagination"])]
    await connectMcpServer("test", true)
    expect(listMcpStatuses()[0]?.tools.map((entry) => entry.name)).toEqual([
      "add",
      "page_two"
    ])
  })
  it("propagates cancellation to a real stdio call", async () => {
    state.servers = [fixtureServer(["--lifecycle"])]
    await connectMcpServer("test")
    const controller = new AbortController()
    const pending = callMcpTool("test", "slow", {}, controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    controller.abort(new Error("Test cancellation"))
    await rejected
  })
  it("limits the combined catalog and reports the tools actually exposed", async () => {
    state.servers = ["one", "two", "three"].map((id) => ({
      ...fixtureServer(["--small-catalog"]),
      id
    }))
    await Promise.all(
      state.servers.map(async (server) => await connectMcpServer(server.id))
    )
    expect(Object.keys(getMcpTools())).toHaveLength(80)
    const statuses = listMcpStatuses()
    expect(statuses.map((status) => status.tools.length)).toEqual([40, 40, 0])
    expect(
      statuses.reduce((bytes, status) => bytes + status.descriptionBytes, 0)
    ).toBeLessThanOrEqual(64 * 1024)
    expect(statuses[2]?.catalogTruncated).toBe(true)
  })
  it("connects to a real HTTP fixture with headers and invokes its tool", async () => {
    const requests: { authorization: string | undefined; method: string }[] = []
    const server = createServer(async (request, response) => {
      requests.push({
        authorization: request.headers.authorization,
        method: request.method ?? ""
      })
      if (request.method !== "POST") {
        response.writeHead(405).end()
        return
      }
      let body = ""
      for await (const chunk of request) {
        body += String(chunk)
      }
      const message = JSON.parse(body) as {
        id?: number
        method: string
        params?: { arguments: { a: number; b: number } }
      }
      if (message.id === undefined) {
        response.writeHead(202).end()
        return
      }
      const result =
        message.method === "initialize"
          ? {
              capabilities: { tools: {} },
              protocolVersion: "2025-11-25",
              serverInfo: { name: "http-fixture", version: "1.0" }
            }
          : message.method === "tools/list"
            ? {
                tools: [
                  {
                    description: "Add",
                    inputSchema: {
                      properties: {
                        a: { type: "number" },
                        b: { type: "number" }
                      },
                      type: "object"
                    },
                    name: "add"
                  }
                ]
              }
            : {
                content: [
                  {
                    text: String(
                      (message.params?.arguments.a ?? 0) +
                        (message.params?.arguments.b ?? 0)
                    ),
                    type: "text"
                  }
                ]
              }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: message.id, jsonrpc: "2.0", result }))
    })
    const port = await listenHttpServer(server)
    try {
      state.servers = [
        {
          enabled: true,
          headers: { Authorization: "Bearer http-fixture-test-token" },
          id: "http",
          name: "HTTP fixture",
          protocol: "legacy",
          transport: "http",
          url: `http://127.0.0.1:${port}/mcp`
        }
      ]
      await connectMcpServer("http")
      expect(await callMcpTool("http", "add", { a: 4, b: 8 })).toMatchObject({
        content: [{ text: "12" }]
      })
      expect(
        requests
          .filter((request) => request.method === "POST")
          .every(
            (request) =>
              request.authorization === "Bearer http-fixture-test-token"
          )
      ).toBe(true)
    } finally {
      await disposeMcpConnections()
      await closeHttpServer(server)
    }
  })
})

vi.mock("@electron-toolkit/utils", () => ({ platform: { isLinux: false } }))
