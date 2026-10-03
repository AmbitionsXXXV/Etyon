import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const options = new Set(process.argv.slice(2))
const timers = new Set()
const input = createInterface({ input: process.stdin })
if (process.env.MCP_TEST_SPAWN_LOG) {
  appendFileSync(process.env.MCP_TEST_SPAWN_LOG, `${process.pid}\n`)
}
const addTool = {
  description: "Add two numbers",
  inputSchema: {
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    type: "object"
  },
  name: "add"
}
const respond = (request) => {
  let result = {}
  if (request.method === "initialize") {
    result = {
      capabilities: { tools: {} },
      protocolVersion: "2025-11-25",
      serverInfo: { name: "etyon-test", version: "1.0.0" }
    }
  } else if (request.method === "tools/list") {
    const tools = [addTool]
    if (options.has("--lifecycle")) {
      for (const name of ["identity", "secret", "error", "large", "slow"]) {
        tools.push({
          description: name,
          inputSchema: { properties: {}, type: "object" },
          name
        })
      }
    }
    if (options.has("--large-catalog") || options.has("--small-catalog")) {
      for (let index = 0; index < 60; index += 1) {
        tools.push({
          description: options.has("--small-catalog")
            ? "Small tool"
            : "description ".repeat(100),
          inputSchema: { properties: {}, type: "object" },
          name: `tool_${index}`
        })
      }
      if (options.has("--large-catalog")) {
        tools.unshift({
          description: "oversized schema",
          inputSchema: {
            properties: {
              data: { description: "x".repeat(20_000), type: "string" }
            },
            type: "object"
          },
          name: "oversized"
        })
      }
    }
    result = { tools }
    if (options.has("--pagination")) {
      result = request.params?.cursor
        ? {
            tools: [
              {
                description: "Second page",
                inputSchema: { properties: {}, type: "object" },
                name: "page_two"
              }
            ]
          }
        : { nextCursor: "second", tools }
    }
  } else if (request.method === "tools/call") {
    const { name } = request.params
    if (name === "error") {
      process.stdout.write(
        `${JSON.stringify({ error: { code: -32603, message: `Fixture error ${process.env.MCP_TEST_SECRET}` }, id: request.id, jsonrpc: "2.0" })}\n`
      )
      return
    }
    const text =
      name === "identity"
        ? JSON.stringify({
            hasParentSecret: Boolean(process.env.ETYON_TEST_PARENT_SECRET),
            path: process.env.PATH,
            pid: process.pid
          })
        : name === "secret"
          ? process.env.MCP_TEST_SECRET
          : name === "large"
            ? "x".repeat(129 * 1024)
            : String(request.params.arguments.a + request.params.arguments.b)
    result = { content: [{ text, type: "text" }] }
  } else {
    process.stdout.write(
      `${JSON.stringify({ error: { code: -32601, message: "Method not found" }, id: request.id, jsonrpc: "2.0" })}\n`
    )
    return
  }
  process.stdout.write(
    `${JSON.stringify({ id: request.id, jsonrpc: "2.0", result })}\n`
  )
}
input.on("line", (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) {
    return
  }
  const delay =
    request.method === "initialize" && options.has("--delay")
      ? 1000
      : request.method === "tools/call" && request.params.name === "slow"
        ? 1000
        : 0
  if (!delay) {
    respond(request)
    return
  }
  const timer = setTimeout(() => {
    timers.delete(timer)
    respond(request)
  }, delay)
  timers.add(timer)
})
input.on("close", () => {
  for (const timer of timers) {
    clearTimeout(timer)
  }
})
