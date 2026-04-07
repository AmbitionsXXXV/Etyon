import fs from "node:fs"
import path from "node:path"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { RouterClient } from "@orpc/server"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import type { AppRouter } from "@/main/rpc"

import { app } from "./app"

interface MockChatSession {
  createdAt: string
  id: string
  lastOpenedAt: string
  modelId: string | null
  pinnedAt: string | null
  projectPath: string
  title: string
  updatedAt: string
}

const {
  buildMentionContextMock,
  convertToModelMessagesMock,
  getChatSessionByIdMock,
  mockedHomeDir,
  resolveModelMock,
  streamTextMock
} = vi.hoisted(() => {
  const defaultChatSession = {
    createdAt: "2026-04-06T09:00:00.000Z",
    id: "session-1",
    lastOpenedAt: "2026-04-06T09:01:00.000Z",
    modelId: "moonshot/kimi-k2.5",
    pinnedAt: null,
    projectPath: "/tmp/project-a",
    title: "",
    updatedAt: "2026-04-06T09:00:00.000Z"
  } satisfies MockChatSession

  return {
    buildMentionContextMock: vi.fn(() => ({
      snapshotId: "snapshot-1",
      system: "snapshot context"
    })),
    convertToModelMessagesMock: vi.fn((messages) => Promise.resolve(messages)),
    getChatSessionByIdMock: vi.fn(() => Promise.resolve(defaultChatSession)),
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
  }
})

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

vi.mock("@/main/chat-sessions", () => ({
  getChatSessionById: getChatSessionByIdMock
}))

vi.mock("@/main/project-snapshot", () => ({
  buildMentionContext: buildMentionContextMock
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
    vi.clearAllMocks()
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

  it("prefers an explicit request model and forwards mentions into snapshot context", async () => {
    const mentions = [
      {
        kind: "file" as const,
        path: "/tmp/project-a/src/main.ts",
        relativePath: "src/main.ts",
        snapshotId: "snapshot-1"
      }
    ]
    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        mentions,
        messages: [
          {
            id: "message-1",
            parts: [],
            role: "user"
          }
        ],
        model: "openai/gpt-4o-mini",
        sessionId: "session-1"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(resolveModelMock).toHaveBeenCalledWith("openai/gpt-4o-mini")
    expect(getChatSessionByIdMock).toHaveBeenCalledWith(
      expect.anything(),
      "session-1"
    )
    expect(buildMentionContextMock).toHaveBeenCalledWith({
      mentions,
      projectPath: "/tmp/project-a"
    })
    expect(streamTextMock).toHaveBeenCalled()
  })

  it("falls back to the session model when the request body does not provide one", async () => {
    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [
          {
            id: "message-1",
            parts: [],
            role: "user"
          }
        ],
        sessionId: "session-1"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    expect(resolveModelMock).toHaveBeenCalledWith("moonshot/kimi-k2.5")
  })

  it("delegates default-model fallback to the provider resolver when the session model is empty", async () => {
    ;(
      getChatSessionByIdMock as {
        mockResolvedValueOnce: (value: MockChatSession) => void
      }
    ).mockResolvedValueOnce({
      createdAt: "2026-04-06T09:00:00.000Z",
      id: "session-1",
      lastOpenedAt: "2026-04-06T09:01:00.000Z",
      modelId: null,
      pinnedAt: null,
      projectPath: "/tmp/project-a",
      title: "",
      updatedAt: "2026-04-06T09:00:00.000Z"
    })

    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [
          {
            id: "message-1",
            parts: [],
            role: "user"
          }
        ],
        sessionId: "session-1"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    expect(resolveModelMock).toHaveBeenCalledWith(undefined)
  })
})
