import fs from "node:fs"
import path from "node:path"

import type { AppSettings } from "@etyon/rpc"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { RouterClient } from "@orpc/server"
import type * as Ai from "ai"
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test"

import { getLocalConnectionToken } from "@/main/local-connection"
import type { AppRouter } from "@/main/rpc"
import { app } from "@/main/server/app"

interface MockChatSession {
  archivedAt: string | null
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
  buildMemorySystemPromptMock,
  buildProjectDigestSystemPromptMock,
  buildSkillsSystemPromptMock,
  buildSessionMemorySystemPromptMock,
  convertToModelMessagesMock,
  getChatSessionByIdMock,
  getChatSessionMemoryMock,
  getProjectMemoryDigestMock,
  getSettingsMock,
  listSkillPromptTemplatesMock,
  mockedHomeDir,
  persistSubmittedChatMessagesMock,
  replaceChatMessagesMock,
  resolveModelMock,
  stepCountIsMock,
  streamTextMock
} = vi.hoisted(() => {
  const defaultChatSession = {
    archivedAt: null,
    createdAt: "2026-04-06T09:00:00.000Z",
    id: "session-1",
    lastOpenedAt: "2026-04-06T09:01:00.000Z",
    modelId: "moonshot/kimi-k2.5",
    pinnedAt: null,
    projectPath: "/tmp/project-a",
    title: "",
    updatedAt: "2026-04-06T09:00:00.000Z"
  } satisfies MockChatSession
  // Keep this inside vi.hoisted so settings mocks are initialized before imports.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const buildSettings = (agents?: Record<string, unknown>) =>
    ({
      agents: {
        allowSubagentDelegation: false,
        defaultProfileId: "general-purpose",
        enabled: false,
        maxConcurrentSubagents: 2,
        profiles: [],
        requireApprovalForWrites: true,
        ...agents
      },
      memory: {
        autoRetrieve: true,
        autoSummarize: false,
        embeddingModel: "",
        enabled: true,
        includeChatbot: true,
        maxContextEntries: 8,
        maxRetrievedMemories: 8,
        memoryToolModel: "__auto__",
        queryRewriting: true,
        shareAcrossProjects: true,
        similarityThreshold: 0.1
      },
      skills: {
        enabled: true,
        includeGlobal: true,
        includeProject: true,
        maxContextSkills: 4
      }
    }) as unknown as AppSettings

  return {
    buildMentionContextMock: vi.fn(() => ({
      snapshotId: "snapshot-1",
      system: "snapshot context"
    })),
    buildMemorySystemPromptMock: vi.fn(() =>
      Promise.resolve("long-term memory context")
    ),
    buildProjectDigestSystemPromptMock: vi.fn(() => "project digest context"),
    buildSkillsSystemPromptMock: vi.fn(() => "skills context"),
    buildSessionMemorySystemPromptMock: vi.fn(() => "session memory context"),
    convertToModelMessagesMock: vi.fn((messages) => Promise.resolve(messages)),
    getChatSessionByIdMock: vi.fn(() => Promise.resolve(defaultChatSession)),
    getChatSessionMemoryMock: vi.fn(() =>
      Promise.resolve({
        content: "remember prior context",
        createdAt: "2026-04-06T09:00:00.000Z",
        messageCount: 2,
        sessionId: "session-1",
        updatedAt: "2026-04-06T09:01:00.000Z"
      })
    ),
    getProjectMemoryDigestMock: vi.fn(() => Promise.resolve("")),
    getSettingsMock: vi.fn(() => buildSettings()),
    listSkillPromptTemplatesMock: vi.fn(() => []),
    mockedHomeDir: `/tmp/etyon-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    persistSubmittedChatMessagesMock: vi.fn(() => Promise.resolve([])),
    replaceChatMessagesMock: vi.fn(() => Promise.resolve([])),
    resolveModelMock: vi.fn(() => ({ modelId: "test-model" })),
    stepCountIsMock: vi.fn((stepCount: number) => ({
      kind: "step-count",
      stepCount
    })),
    streamTextMock: vi.fn(() => ({
      toUIMessageStream: vi.fn(
        () =>
          new ReadableStream({
            start(controller) {
              controller.close()
            }
          })
      )
    }))
  }
})

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>()

  return {
    ...actual,
    convertToModelMessages: convertToModelMessagesMock,
    isStepCount: stepCountIsMock,
    streamText: streamTextMock,
    tool: (definition: unknown) => definition
  }
})

const getFirstStreamTextCallOptions = ():
  | Record<string, unknown>
  | undefined => {
  const calls = streamTextMock.mock.calls as unknown as [
    Record<string, unknown> | undefined
  ][]

  return calls[0]?.[0]
}

const consumeChatResponse = async (response: Response): Promise<void> => {
  if (!response.body) {
    return
  }

  const reader = response.body.getReader()

  while (true) {
    const { done } = await reader.read()

    if (done) {
      break
    }
  }
}

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

vi.mock("electron-store", () => {
  class MockElectronStore {
    readonly store = new Map<string, unknown>()

    get(key: string): unknown {
      return this.store.get(key)
    }

    set(key: string, value: unknown): void {
      this.store.set(key, value)
    }
  }

  return {
    default: MockElectronStore
  }
})

vi.mock("electron", () => {
  const electronMock = {
    BrowserWindow: {
      getAllWindows: () => []
    },
    app: {
      getLocale: () => "en-US",
      getName: () => "Etyon",
      getPath: () => mockedHomeDir,
      getVersion: () => "0.1.0-test",
      name: "Etyon"
    },
    ipcMain: {
      on: vi.fn()
    }
  }

  return {
    ...electronMock,
    default: electronMock
  }
})

vi.mock("@/main/server/lib/providers", () => ({
  resolveEffortProviderOptionsForSelection: vi.fn(),
  resolveModel: resolveModelMock
}))

vi.mock("@/main/chat-messages", () => ({
  persistSubmittedChatMessages: persistSubmittedChatMessagesMock,
  replaceChatMessages: replaceChatMessagesMock
}))

vi.mock("@/main/chat-session-memory", () => ({
  buildSessionMemorySystemPrompt: buildSessionMemorySystemPromptMock,
  getChatSessionMemory: getChatSessionMemoryMock
}))

vi.mock("@/main/chat-sessions", () => ({
  getChatSessionById: getChatSessionByIdMock
}))

vi.mock("@/main/memory", () => ({
  buildMemorySystemPrompt: buildMemorySystemPromptMock
}))

vi.mock("@/main/memory/project-digest", () => ({
  buildProjectDigestSystemPrompt: buildProjectDigestSystemPromptMock,
  getProjectMemoryDigest: getProjectMemoryDigestMock
}))

vi.mock("@/main/project-snapshot", () => ({
  buildMentionContext: buildMentionContextMock
}))

vi.mock("@/main/skills", () => ({
  buildSkillsSystemPrompt: buildSkillsSystemPromptMock,
  listSkillPromptTemplates: listSkillPromptTemplatesMock
}))

vi.mock("@/main/settings", () => ({
  getSettings: getSettingsMock
}))

const getLogFilePath = (): string =>
  path.join(
    mockedHomeDir,
    ".etyon-dev",
    "logs",
    `${new Date().toISOString().slice(0, 10)}.jsonl`
  )

const readLogEntries = (): Record<string, unknown>[] => {
  const logFilePath = getLogFilePath()

  if (!fs.existsSync(logFilePath)) {
    return []
  }

  return fs
    .readFileSync(logFilePath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

const buildAuthorizedHeaders = (init?: HeadersInit): Headers => {
  const headers = new Headers(init)

  headers.set("authorization", `Bearer ${getLocalConnectionToken()}`)

  return headers
}

const authorizeRequest = (request: Request): Request => {
  const headers = buildAuthorizedHeaders(request.headers)

  return new Request(request, { headers })
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

  it("rejects protected routes without the local connection token", async () => {
    const rpcResponse = await app.request("/rpc/ping", {
      body: JSON.stringify({ message: "via-http" }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })
    const chatResponse = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [],
        sessionId: "session-1"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(rpcResponse.status).toBe(401)
    expect(chatResponse.status).toBe(401)
  })

  it("allows localhost preflight requests before local token authorization", async () => {
    const response = await app.request("/api/chat", {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "http://localhost:5173"
      },
      method: "OPTIONS"
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    )
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST"
    )
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization,Content-Type"
    )
  })

  it("adds CORS headers to authorized localhost chat responses", async () => {
    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [],
        sessionId: "session-1"
      }),
      headers: {
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    )
    await consumeChatResponse(response)
  })

  it("serves oRPC over /rpc and logs a single structured request event", async () => {
    let capturedResponse: Response | undefined

    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({
        fetch: async (request) => {
          const response = await app.request(authorizeRequest(request))
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
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    await consumeChatResponse(response)
    expect(resolveModelMock).toHaveBeenCalledWith("openai/gpt-4o-mini")
    expect(getChatSessionByIdMock).toHaveBeenCalledWith(
      expect.anything(),
      "session-1"
    )
    expect(persistSubmittedChatMessagesMock).toHaveBeenCalledWith({
      db: expect.anything(),
      messages: [
        {
          id: "message-1",
          parts: [],
          role: "user"
        }
      ],
      sessionId: "session-1"
    })
    expect(buildMentionContextMock).toHaveBeenCalledWith({
      mentions,
      projectPath: "/tmp/project-a"
    })
    expect(getProjectMemoryDigestMock).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/project-a"
    )
    expect(buildSkillsSystemPromptMock).toHaveBeenCalledWith({
      projectPath: "/tmp/project-a",
      query: "",
      selectedSkills: [],
      settings: {
        enabled: true,
        includeGlobal: true,
        includeProject: true,
        maxContextSkills: 4
      }
    })
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions:
          "session memory context\n\nproject digest context\n\nskills context\n\nsnapshot context"
      })
    )
    expect(replaceChatMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user"
          }),
          expect.objectContaining({
            role: "assistant"
          })
        ])
      })
    )
  })

  it("checkpoints the submitted prompt before provider resolution fails", async () => {
    resolveModelMock.mockImplementationOnce(() => {
      throw new TypeError("Failed to fetch")
    })

    const message = {
      id: "failed-message",
      parts: [{ text: "Keep this failed prompt", type: "text" }],
      role: "user"
    }
    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [message],
        model: "cursor/gpt-5.6-terra",
        sessionId: "session-1"
      }),
      headers: {
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(500)
    expect(persistSubmittedChatMessagesMock).toHaveBeenCalledWith({
      db: expect.anything(),
      messages: [message],
      sessionId: "session-1"
    })
    expect(replaceChatMessagesMock).not.toHaveBeenCalled()
  })

  it("does not inject agent tools into chat requests while agents are disabled", async () => {
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
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    await consumeChatResponse(response)
    const streamOptions = getFirstStreamTextCallOptions()

    expect(streamOptions).not.toHaveProperty("tools")
    expect(streamOptions).not.toHaveProperty("stopWhen")
    expect(stepCountIsMock).not.toHaveBeenCalled()
  })

  it("completes unresolved tool calls before disabled chat provider requests", async () => {
    const unresolvedMessages = [
      {
        content: "Inspect source.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              path: "src/index.ts"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: "Continue without that tool result.",
        role: "user"
      }
    ] satisfies Ai.ModelMessage[]

    convertToModelMessagesMock.mockResolvedValueOnce(unresolvedMessages)

    const response = await app.request("/api/chat", {
      body: JSON.stringify({
        messages: [
          {
            id: "message-1",
            parts: [
              {
                text: "Continue without that tool result.",
                type: "text"
              }
            ],
            role: "user"
          }
        ],
        sessionId: "session-1"
      }),
      headers: {
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    await consumeChatResponse(response)

    const streamOptions = getFirstStreamTextCallOptions() as
      | {
          messages?: Ai.ModelMessage[]
        }
      | undefined

    expect(streamOptions?.messages).toEqual([
      {
        content: "Inspect source.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              path: "src/index.ts"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "error-text",
              value:
                "Tool execution did not complete before the next user message."
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: "Continue without that tool result.",
        role: "user"
      }
    ])
  })

  it("forwards the chat request abort signal to the model stream", async () => {
    const abortController = new AbortController()
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
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST",
      signal: abortController.signal
    })

    expect(response.status).toBe(200)
    await consumeChatResponse(response)
    const streamOptions = getFirstStreamTextCallOptions() as
      | {
          abortSignal?: AbortSignal
        }
      | undefined

    expect(streamOptions?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(streamOptions?.abortSignal?.aborted).toBe(false)

    abortController.abort()

    expect(streamOptions?.abortSignal?.aborted).toBe(true)
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
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    await consumeChatResponse(response)
    expect(resolveModelMock).toHaveBeenCalledWith("moonshot/kimi-k2.5")
  })

  it("delegates default-model fallback to the provider resolver when the session model is empty", async () => {
    ;(
      getChatSessionByIdMock as {
        mockResolvedValueOnce: (value: MockChatSession) => void
      }
    ).mockResolvedValueOnce({
      archivedAt: null,
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
        authorization: `Bearer ${getLocalConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST"
    })

    expect(response.status).toBe(200)
    await consumeChatResponse(response)
    expect(resolveModelMock).toHaveBeenCalledWith(undefined)
  })
})
