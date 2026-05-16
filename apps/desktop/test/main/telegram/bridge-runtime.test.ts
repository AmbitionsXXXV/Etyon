import type { AppSettings, TelegramSettings } from "@etyon/rpc"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

type ChatHandler = (thread: ThreadMock, message: TelegramMessageMock) => unknown

interface ChatInstanceMock {
  config: unknown
  directHandlers: ChatHandler[]
  initialize: ReturnType<typeof vi.fn>
  mentionHandlers: ChatHandler[]
  patternHandlers: {
    handler: ChatHandler
    pattern: RegExp
  }[]
  shutdown: ReturnType<typeof vi.fn>
  subscribedHandlers: ChatHandler[]
}

interface TelegramAdapterMock {
  runtimeMode: string
  stopPolling: ReturnType<typeof vi.fn>
  userName: string
}

interface TelegramMessageMock {
  author: {
    isBot: boolean | "unknown"
    isMe: boolean
    userId: string
    userName: string
  }
  isMention?: boolean
  raw: {
    chat: {
      id: number
      type: "group" | "private" | "supergroup"
    }
    message_id: number
  }
  text: string
}

interface ThreadMock {
  allMessages: AsyncIterable<TelegramMessageMock>
  post: ReturnType<typeof vi.fn>
  startTyping: ReturnType<typeof vi.fn>
}

interface ToAiMessagesOptionsMock {
  transformMessage?: (
    aiMessage: { content: string; role: "assistant" | "user" },
    source: TelegramMessageMock
  ) =>
    | Promise<{ content: string; role: "assistant" | "user" } | null>
    | { content: string; role: "assistant" | "user" }
    | null
}

const {
  ChatMock,
  chatInstances,
  createMemoryStateMock,
  createTelegramAdapterMock,
  getDbMock,
  loggerErrorMock,
  loggerInfoMock,
  buildMemorySystemPromptMock,
  resolveModelMock,
  streamTextMock,
  telegramAdapters,
  toAiMessagesMock,
  upsertChatbotMemoryEntryMock
} = vi.hoisted(() => {
  const chatInstanceStore: ChatInstanceMock[] = []
  const telegramAdapterStore: TelegramAdapterMock[] = []
  const createChatInstance = (config: unknown): ChatInstanceMock => {
    const instance: ChatInstanceMock = {
      config,
      directHandlers: [],
      initialize: vi.fn(() => Promise.resolve()),
      mentionHandlers: [],
      patternHandlers: [],
      shutdown: vi.fn(() => Promise.resolve()),
      subscribedHandlers: []
    }

    return instance
  }
  const chatConstructorMock = vi.fn(function createChat(
    this: unknown,
    config: unknown
  ) {
    const instance = createChatInstance(config)

    chatInstanceStore.push(instance)

    return {
      ...instance,
      onDirectMessage(handler: ChatHandler) {
        instance.directHandlers.push(handler)
      },
      onNewMention(handler: ChatHandler) {
        instance.mentionHandlers.push(handler)
      },
      onNewMessage(pattern: RegExp, handler: ChatHandler) {
        instance.patternHandlers.push({ handler, pattern })
      },
      onSubscribedMessage(handler: ChatHandler) {
        instance.subscribedHandlers.push(handler)
      }
    }
  })
  const telegramAdapterFactoryMock = vi.fn((config: unknown) => {
    const adapter: TelegramAdapterMock = {
      runtimeMode: "polling",
      stopPolling: vi.fn(() => Promise.resolve()),
      userName: "etyon_bot"
    }

    telegramAdapterStore.push(adapter)

    return {
      ...adapter,
      config
    }
  })
  const aiMessagesConverterMock = vi.fn(
    async (
      messages: TelegramMessageMock[],
      options?: ToAiMessagesOptionsMock
    ) => {
      const result: { content: string; role: "assistant" | "user" }[] = []

      for (const message of messages) {
        const aiMessage = {
          content: message.text,
          role: message.author.isMe ? "assistant" : "user"
        } as const
        const transformed =
          (await options?.transformMessage?.(aiMessage, message)) ?? aiMessage

        if (transformed) {
          result.push(transformed)
        }
      }

      return result
    }
  )

  return {
    ChatMock: chatConstructorMock,
    buildMemorySystemPromptMock: vi.fn(),
    chatInstances: chatInstanceStore,
    createMemoryStateMock: vi.fn(() => ({ kind: "memory-state" })),
    createTelegramAdapterMock: telegramAdapterFactoryMock,
    getDbMock: vi.fn(() => ({ kind: "db" })),
    loggerErrorMock: vi.fn(),
    loggerInfoMock: vi.fn(),
    resolveModelMock: vi.fn(),
    streamTextMock: vi.fn(),
    telegramAdapters: telegramAdapterStore,
    toAiMessagesMock: aiMessagesConverterMock,
    upsertChatbotMemoryEntryMock: vi.fn()
  }
})

vi.mock("@chat-adapter/state-memory", () => ({
  createMemoryState: createMemoryStateMock
}))

vi.mock("@chat-adapter/telegram", () => ({
  createTelegramAdapter: createTelegramAdapterMock
}))

vi.mock("ai", () => ({
  streamText: streamTextMock
}))

vi.mock("chat", () => ({
  Chat: ChatMock,
  toAiMessages: toAiMessagesMock
}))

vi.mock("@/main/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: loggerErrorMock,
    info: loggerInfoMock
  }
}))

vi.mock("@/main/db", () => ({
  getDb: getDbMock
}))

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: resolveModelMock
}))

vi.mock("@/main/settings", () => ({
  getSettings: vi.fn()
}))

vi.mock("@/main/memory", () => ({
  buildMemorySystemPrompt: buildMemorySystemPromptMock,
  upsertChatbotMemoryEntry: upsertChatbotMemoryEntryMock
}))

const createTextStream = (text: string) =>
  (async function* streamChunks() {
    yield text
  })()

const createTelegramSettings = (
  override: Partial<TelegramSettings> = {}
): TelegramSettings => ({
  allowedChatIds: "-10042",
  allowedUserIds: "1001",
  botToken: "123:abc",
  botUsername: "etyon_bot",
  defaultModel: "",
  enabled: true,
  requireMentionInGroups: true,
  ...override
})

const createAppSettings = (
  telegram: TelegramSettings = createTelegramSettings()
): AppSettings =>
  ({
    memory: {
      enabled: true,
      includeChatbot: true,
      maxContextEntries: 8,
      shareAcrossProjects: true
    },
    telegram
  }) as AppSettings

const createTelegramMessage = (
  override: Partial<TelegramMessageMock> = {}
): TelegramMessageMock => ({
  author: {
    isBot: false,
    isMe: false,
    userId: "1001",
    userName: "ada"
  },
  isMention: true,
  raw: {
    chat: {
      id: -10_042,
      type: "supergroup"
    },
    message_id: 12
  },
  text: "@etyon_bot summarize this",
  ...override
})

const createThread = (messages: TelegramMessageMock[]): ThreadMock => ({
  allMessages: (async function* iterateMessages() {
    for (const message of messages) {
      yield message
    }
  })(),
  post: vi.fn(() => Promise.resolve()),
  startTyping: vi.fn(() => Promise.resolve())
})

const waitForMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe("telegram bridge runtime", () => {
  afterEach(async () => {
    const { stopTelegramBridge } = await import("@/main/telegram/bridge")

    stopTelegramBridge()
    chatInstances.length = 0
    telegramAdapters.length = 0
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("starts Chat SDK Telegram adapter in polling mode", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")

    syncTelegramBridge(createAppSettings())
    await waitForMicrotasks()

    expect(createMemoryStateMock).toHaveBeenCalledTimes(1)
    expect(createTelegramAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: "123:abc",
        longPolling: expect.objectContaining({
          dropPendingUpdates: true,
          retryDelayMs: 5000,
          timeout: 25
        }),
        mode: "polling",
        userName: "etyon_bot"
      })
    )
    expect(chatInstances).toHaveLength(1)
    expect(chatInstances[0]?.config).toEqual(
      expect.objectContaining({
        userName: "etyon_bot"
      })
    )
    expect(chatInstances[0]?.initialize).toHaveBeenCalledTimes(1)
    expect(chatInstances[0]?.directHandlers).toHaveLength(1)
    expect(chatInstances[0]?.mentionHandlers).toHaveLength(1)
    expect(chatInstances[0]?.patternHandlers).toHaveLength(1)
    expect(chatInstances[0]?.subscribedHandlers).toHaveLength(1)
  })

  it("lets the Telegram adapter auto-detect username when settings have no saved username", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")

    syncTelegramBridge(
      createAppSettings(
        createTelegramSettings({
          botUsername: ""
        })
      )
    )
    await waitForMicrotasks()

    expect(createTelegramAdapterMock).toHaveBeenCalledTimes(1)
    expect(createTelegramAdapterMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "userName"
    )
    expect(chatInstances[0]?.config).toEqual(
      expect.objectContaining({
        userName: "etyon"
      })
    )
  })

  it("streams AI replies through Chat SDK thread posting", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")
    const textStream = createTextStream("AI reply")

    resolveModelMock.mockReturnValue({ modelId: "test-model" })
    streamTextMock.mockReturnValue({ textStream })
    syncTelegramBridge(createAppSettings())
    await waitForMicrotasks()

    const message = createTelegramMessage()
    const thread = createThread([message])

    await chatInstances[0]?.mentionHandlers[0]?.(thread, message)

    expect(resolveModelMock).toHaveBeenCalledWith(undefined)
    expect(thread.startTyping).toHaveBeenCalledTimes(1)
    expect(toAiMessagesMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            content: "summarize this",
            role: "user"
          }
        ],
        model: { modelId: "test-model" }
      })
    )
    expect(thread.post).toHaveBeenCalledWith(textStream)
  })

  it("uses the Telegram channel default model when configured", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")
    const textStream = createTextStream("AI reply")

    resolveModelMock.mockReturnValue({ modelId: "test-model" })
    streamTextMock.mockReturnValue({ textStream })
    syncTelegramBridge(
      createAppSettings(
        createTelegramSettings({
          defaultModel: "moonshot/kimi-k2.6"
        })
      )
    )
    await waitForMicrotasks()

    const message = createTelegramMessage()
    const thread = createThread([message])

    await chatInstances[0]?.mentionHandlers[0]?.(thread, message)

    expect(resolveModelMock).toHaveBeenCalledWith("moonshot/kimi-k2.6")
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: "test-model" }
      })
    )
  })

  it("connects Telegram replies to the shared memory layer", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")
    const textStream = createTextStream("AI reply")

    buildMemorySystemPromptMock.mockResolvedValue("Shared memory: dense UI")
    resolveModelMock.mockReturnValue({ modelId: "test-model" })
    streamTextMock.mockReturnValue({ textStream })
    syncTelegramBridge(createAppSettings())
    await waitForMicrotasks()

    const message = createTelegramMessage()
    const thread = createThread([message])

    await chatInstances[0]?.mentionHandlers[0]?.(thread, message)

    expect(buildMemorySystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: null,
        query: "summarize this"
      })
    )
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Shared memory: dense UI")
      })
    )
    expect(upsertChatbotMemoryEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatbotId: "telegram:-10042",
        messages: [
          {
            content: "summarize this",
            role: "user"
          }
        ]
      })
    )
  })

  it("ignores non-mentioned group messages when group mentions are required", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")

    syncTelegramBridge(createAppSettings())
    await waitForMicrotasks()

    const message = createTelegramMessage({
      isMention: false,
      text: "summarize this"
    })
    const thread = createThread([message])

    await chatInstances[0]?.patternHandlers[0]?.handler(thread, message)

    expect(streamTextMock).not.toHaveBeenCalled()
    expect(thread.post).not.toHaveBeenCalled()
  })

  it("allows non-mentioned group messages when mention requirement is disabled", async () => {
    const { syncTelegramBridge } = await import("@/main/telegram/bridge")
    const textStream = createTextStream("AI reply")

    resolveModelMock.mockReturnValue({ modelId: "test-model" })
    streamTextMock.mockReturnValue({ textStream })
    syncTelegramBridge(
      createAppSettings(
        createTelegramSettings({
          requireMentionInGroups: false
        })
      )
    )
    await waitForMicrotasks()

    const message = createTelegramMessage({
      isMention: false,
      text: "summarize this"
    })
    const thread = createThread([message])

    await chatInstances[0]?.patternHandlers[0]?.handler(thread, message)

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(thread.post).toHaveBeenCalledWith(textStream)
  })

  it("stops polling through the Chat SDK adapter", async () => {
    const { stopTelegramBridge, syncTelegramBridge } =
      await import("@/main/telegram/bridge")

    syncTelegramBridge(createAppSettings())
    await waitForMicrotasks()
    stopTelegramBridge()
    await waitForMicrotasks()

    expect(telegramAdapters[0]?.stopPolling).toHaveBeenCalledTimes(1)
    expect(chatInstances[0]?.shutdown).toHaveBeenCalledTimes(1)
  })
})
