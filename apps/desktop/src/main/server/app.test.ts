import fs from "node:fs"
import path from "node:path"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { RouterClient } from "@orpc/server"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import type { AppRouter } from "@/main/rpc"

import { app } from "./app"

const {
  convertToModelMessagesMock,
  mockedHomeDir,
  resolveModelMock,
  streamTextMock
} = vi.hoisted(() => ({
  convertToModelMessagesMock: vi.fn((messages) => Promise.resolve(messages)),
  mockedHomeDir: `/tmp/etyon-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  resolveModelMock: vi.fn(() => ({ modelId: "test-model" })),
  streamTextMock: vi.fn(() => ({
    toUIMessageStreamResponse: () =>
      Response.json(
        { ok: true },
        {
          status: 200
        }
      )
  }))
}))

vi.mock("ai", () => ({
  convertToModelMessages: convertToModelMessagesMock,
  streamText: streamTextMock
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: resolveModelMock
}))

const getLogFilePath = (): string =>
  path.join(
    mockedHomeDir,
    ".etyon",
    "logs",
    `${new Date().toISOString().slice(0, 10)}.jsonl`
  )

const readLogEntries = (): Record<string, unknown>[] => {
  const logFilePath = getLogFilePath()

  if (!fs.existsSync(logFilePath)) {
    return []
  }

  return fs
    .readFileSync(logFilePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("hono app", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the health route working", async () => {
    const response = await app.request("/health")

    expect(response.status).toBe(200)
    expect(response.headers.get("x-request-id")).toBeTruthy()
    expect(await response.json()).toEqual({ ok: true })
  })

  it("serves oRPC over /rpc and logs a single structured request event", async () => {
    let capturedResponse: Response | undefined

    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({
        fetch: async (request) => {
          const response = await app.request(request)
          capturedResponse = response.clone()
          return response
        },
        url: "http://127.0.0.1/rpc"
      })
    )

    const result = await client.ping({ message: "via-http" })
    const requestId = capturedResponse?.headers.get("x-request-id")
    const matchingEntries = readLogEntries().filter(
      (entry) =>
        entry.endpoint_kind === "rpc" &&
        entry.event === "http_request" &&
        entry.request_id === requestId
    )

    expect(result.echo).toBe("via-http")
    expect(requestId).toBeTruthy()
    expect(matchingEntries).toHaveLength(1)
    expect(matchingEntries[0]).toMatchObject({
      endpoint_kind: "rpc",
      path: expect.stringContaining("/rpc"),
      status_code: 200
    })
  })

  it("keeps the chat route behavior intact", async () => {
    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [
          {
            id: "message-1",
            parts: [],
            role: "user"
          }
        ],
        model: "test-model"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(resolveModelMock).toHaveBeenCalledWith("test-model")
    expect(streamTextMock).toHaveBeenCalled()
  })
})
