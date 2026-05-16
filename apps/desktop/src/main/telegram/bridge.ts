import { createMemoryState } from "@chat-adapter/state-memory"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import type {
  TelegramAdapter,
  TelegramRawMessage
} from "@chat-adapter/telegram"
import type { AppSettings, MemorySettings, TelegramSettings } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { streamText } from "ai"
import { Chat, toAiMessages } from "chat"
import type {
  AiMessage,
  AiMessagePart,
  Logger as ChatSdkLogger,
  Message,
  Thread
} from "chat"

import { getDb } from "@/main/db"
import { logger } from "@/main/logger"
import {
  buildMemorySystemPrompt,
  upsertChatbotMemoryEntry
} from "@/main/memory"
import { resolveModel } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"
import { toTelegramErrorMessage } from "@/main/telegram/client"
import {
  parseTelegramIdList,
  stripTelegramBotMention
} from "@/main/telegram/utils"

const MAX_TELEGRAM_HISTORY_MESSAGES = 20
const TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 25
const TELEGRAM_POLL_BACKOFF_MS = 5000
const TELEGRAM_POLLING_UPDATES = ["message", "edited_message"] as const
const TELEGRAM_TEXT_MESSAGE_PATTERN = /\S/
const TELEGRAM_SYSTEM_PROMPT =
  "You are Etyon, a concise desktop AI assistant. Reply in the user's language."
const TELEGRAM_FALLBACK_USER_NAME = "etyon"

type TelegramChatMessage = Message
type TelegramChatThread = Thread<Record<string, unknown>>

interface TelegramBridgeRuntime {
  bot: Chat<{ telegram: TelegramAdapter }>
  signature: string
  stopped: boolean
  telegram: TelegramAdapter
}

let activeBridge: TelegramBridgeRuntime | null = null

const buildBridgeSignature = (
  memory: MemorySettings,
  settings: TelegramSettings
): string =>
  JSON.stringify({
    allowedChatIds: settings.allowedChatIds,
    allowedUserIds: settings.allowedUserIds,
    botToken: settings.botToken,
    botUsername: settings.botUsername,
    enabled: settings.enabled,
    memory,
    requireMentionInGroups: settings.requireMentionInGroups
  })

const createChatSdkLogger = (scope = "telegram"): ChatSdkLogger => ({
  child(prefix: string) {
    return createChatSdkLogger(`${scope}.${prefix}`)
  },

  debug(message: string, ...args: unknown[]) {
    logger.debug("telegram_chat_sdk_debug", { args, message, scope })
  },

  error(message: string, ...args: unknown[]) {
    logger.error("telegram_chat_sdk_error", { args, message, scope })
  },

  info(message: string, ...args: unknown[]) {
    logger.info("telegram_chat_sdk_info", { args, message, scope })
  },

  warn(message: string, ...args: unknown[]) {
    logger.info("telegram_chat_sdk_warn", { args, message, scope })
  }
})

const getTelegramRawMessage = (
  message: TelegramChatMessage
): TelegramRawMessage => message.raw as TelegramRawMessage

const isGroupChat = (message: TelegramChatMessage): boolean =>
  getTelegramRawMessage(message).chat.type === "group" ||
  getTelegramRawMessage(message).chat.type === "supergroup"

const isTelegramMessageAuthorized = (
  message: TelegramChatMessage,
  settings: TelegramSettings
): boolean => {
  const allowedChatIds = parseTelegramIdList(settings.allowedChatIds)
  const allowedUserIds = parseTelegramIdList(settings.allowedUserIds)
  const chatId = String(getTelegramRawMessage(message).chat.id)
  const { userId } = message.author

  if (allowedChatIds.size > 0 && !allowedChatIds.has(chatId)) {
    return false
  }

  if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
    return false
  }

  return true
}

const shouldHandleTelegramMessage = ({
  message,
  settings
}: {
  message: TelegramChatMessage
  settings: TelegramSettings
}): boolean => {
  if (!message.text.trim() || message.author.isBot === true) {
    return false
  }

  if (!isTelegramMessageAuthorized(message, settings)) {
    return false
  }

  if (isGroupChat(message) && settings.requireMentionInGroups) {
    return Boolean(message.isMention)
  }

  return true
}

const normalizeTelegramAiContent = (
  content: AiMessage["content"],
  botUserName: string
): AiMessage["content"] => {
  if (typeof content === "string") {
    return stripTelegramBotMention(content, botUserName)
  }

  let didStripMention = false

  return content.map((part): AiMessagePart => {
    if (part.type !== "text" || didStripMention) {
      return part
    }

    didStripMention = true
    return {
      text: stripTelegramBotMention(part.text, botUserName),
      type: "text"
    }
  })
}

const hasTelegramAiContent = (content: AiMessage["content"]): boolean => {
  if (typeof content === "string") {
    return Boolean(content.trim())
  }

  return content.some((part) => {
    if (part.type !== "text") {
      return true
    }

    return Boolean(part.text.trim())
  })
}

const normalizeTelegramAiMessage = (
  aiMessage: AiMessage,
  botUserName: string
): AiMessage | null => {
  if (aiMessage.role !== "user") {
    return aiMessage
  }

  const content = normalizeTelegramAiContent(aiMessage.content, botUserName)

  if (!hasTelegramAiContent(content)) {
    return null
  }

  return {
    content,
    role: "user"
  }
}

const collectThreadMessages = async (
  thread: TelegramChatThread
): Promise<TelegramChatMessage[]> => {
  const messages: TelegramChatMessage[] = []

  for await (const message of thread.allMessages) {
    messages.push(message)
  }

  return messages.slice(-MAX_TELEGRAM_HISTORY_MESSAGES)
}

const buildTelegramAiMessages = async ({
  botUserName,
  message,
  thread
}: {
  botUserName: string
  message: TelegramChatMessage
  thread: TelegramChatThread
}): Promise<ModelMessage[]> => {
  const recentMessages = await collectThreadMessages(thread)
  const messages = await toAiMessages(recentMessages, {
    transformMessage: (aiMessage) =>
      normalizeTelegramAiMessage(aiMessage, botUserName)
  })

  if (messages.length > 0) {
    return messages as ModelMessage[]
  }

  return [
    {
      content: stripTelegramBotMention(message.text, botUserName),
      role: "user"
    }
  ]
}

const buildTelegramSystemPrompt = async ({
  memory,
  prompt
}: {
  memory: MemorySettings
  prompt: string
}): Promise<string> => {
  const memorySystemPrompt = await buildMemorySystemPrompt({
    db: getDb(),
    projectPath: null,
    query: prompt,
    settings: memory
  })

  return [TELEGRAM_SYSTEM_PROMPT, memorySystemPrompt]
    .filter(Boolean)
    .join("\n\n")
}

const handleTelegramMessage = async ({
  botUserName,
  memory,
  message,
  settings,
  thread
}: {
  botUserName: string
  memory: MemorySettings
  message: TelegramChatMessage
  settings: TelegramSettings
  thread: TelegramChatThread
}): Promise<void> => {
  if (!shouldHandleTelegramMessage({ message, settings })) {
    return
  }

  const prompt = stripTelegramBotMention(message.text, botUserName)

  if (!prompt) {
    return
  }

  try {
    await thread.startTyping()
  } catch {
    // Typing indicators are best-effort and should not block replies.
  }

  try {
    const messages = await buildTelegramAiMessages({
      botUserName,
      message,
      thread
    })
    const system = await buildTelegramSystemPrompt({
      memory,
      prompt
    })
    const result = streamText({
      messages,
      model: resolveModel(),
      system
    })

    await thread.post(result.textStream)
    if (memory.enabled && memory.includeChatbot) {
      await upsertChatbotMemoryEntry({
        chatbotId: `telegram:${getTelegramRawMessage(message).chat.id}`,
        db: getDb(),
        messages
      })
    }
  } catch (error) {
    const rawMessage = getTelegramRawMessage(message)

    logger.error("telegram_message_failed", {
      chat_id: rawMessage.chat.id,
      error,
      message_id: rawMessage.message_id
    })

    try {
      await thread.post(
        `Etyon Telegram bridge failed: ${toTelegramErrorMessage(error)}`
      )
    } catch (replyError) {
      logger.error("telegram_error_reply_failed", {
        chat_id: rawMessage.chat.id,
        error: replyError,
        message_id: rawMessage.message_id
      })
    }
  }
}

const registerTelegramHandlers = ({
  bot,
  memory,
  settings,
  telegram
}: {
  bot: Chat<{ telegram: TelegramAdapter }>
  memory: MemorySettings
  settings: TelegramSettings
  telegram: TelegramAdapter
}): void => {
  const handleMessage = (
    thread: TelegramChatThread,
    message: TelegramChatMessage
  ) =>
    handleTelegramMessage({
      botUserName: telegram.userName,
      memory,
      message,
      settings,
      thread
    })

  bot.onDirectMessage(handleMessage)
  bot.onNewMention(handleMessage)
  bot.onNewMessage(TELEGRAM_TEXT_MESSAGE_PATTERN, handleMessage)
  bot.onSubscribedMessage(handleMessage)
}

const createTelegramBridgeRuntime = (
  memory: MemorySettings,
  settings: TelegramSettings,
  signature: string
): TelegramBridgeRuntime => {
  const chatLogger = createChatSdkLogger()
  const botUserName = settings.botUsername.trim()
  const telegram = createTelegramAdapter({
    botToken: settings.botToken,
    logger: chatLogger.child("adapter"),
    longPolling: {
      allowedUpdates: [...TELEGRAM_POLLING_UPDATES],
      dropPendingUpdates: true,
      retryDelayMs: TELEGRAM_POLL_BACKOFF_MS,
      timeout: TELEGRAM_LONG_POLL_TIMEOUT_SECONDS
    },
    mode: "polling",
    ...(botUserName ? { userName: botUserName } : {})
  })
  const adapters = { telegram }
  const bot = new Chat<typeof adapters>({
    adapters,
    concurrency: "queue",
    fallbackStreamingPlaceholderText: null,
    logger: chatLogger.child("bot"),
    state: createMemoryState(),
    threadHistory: {
      maxMessages: MAX_TELEGRAM_HISTORY_MESSAGES
    },
    userName: botUserName || TELEGRAM_FALLBACK_USER_NAME
  })

  registerTelegramHandlers({ bot, memory, settings, telegram })

  return {
    bot,
    signature,
    stopped: false,
    telegram
  }
}

const shutdownTelegramBridge = async (
  bridge: TelegramBridgeRuntime
): Promise<void> => {
  try {
    await bridge.telegram.stopPolling()
  } catch (error) {
    logger.error("telegram_polling_stop_failed", { error })
  }

  try {
    await bridge.bot.shutdown()
  } catch (error) {
    logger.error("telegram_bridge_shutdown_failed", { error })
  }
}

const startTelegramBridge = async (
  bridge: TelegramBridgeRuntime
): Promise<void> => {
  try {
    await bridge.bot.initialize()

    if (bridge.stopped || activeBridge !== bridge) {
      await shutdownTelegramBridge(bridge)
      return
    }

    logger.info("telegram_bridge_initialized", {
      runtime_mode: bridge.telegram.runtimeMode
    })
  } catch (error) {
    if (bridge.stopped || activeBridge !== bridge) {
      return
    }

    logger.error("telegram_bridge_start_failed", { error })
    activeBridge = null
    bridge.stopped = true
    await shutdownTelegramBridge(bridge)
  }
}

export const stopTelegramBridge = (): void => {
  if (!activeBridge) {
    return
  }

  const bridge = activeBridge

  activeBridge = null
  bridge.stopped = true
  void shutdownTelegramBridge(bridge)
  logger.info("telegram_bridge_stopped")
}

export const syncTelegramBridge = (
  appSettings: AppSettings = getSettings()
): void => {
  const { memory, telegram } = appSettings
  const signature = buildBridgeSignature(memory, telegram)

  if (!telegram.enabled || !telegram.botToken.trim()) {
    stopTelegramBridge()
    return
  }

  if (activeBridge?.signature === signature) {
    return
  }

  stopTelegramBridge()
  const bridge = createTelegramBridgeRuntime(memory, telegram, signature)

  activeBridge = bridge

  logger.info("telegram_bridge_started", {
    has_allowed_chat_ids: Boolean(telegram.allowedChatIds.trim()),
    has_allowed_user_ids: Boolean(telegram.allowedUserIds.trim()),
    require_mention_in_groups: telegram.requireMentionInGroups
  })

  void startTelegramBridge(bridge)
}
