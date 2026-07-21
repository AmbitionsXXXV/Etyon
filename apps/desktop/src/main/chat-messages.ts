import type { UIMessage } from "ai"
import { and, asc, eq, isNull } from "drizzle-orm"

import { persistDataUrlAttachments } from "@/main/attachments"
import { compactChatMessages } from "@/main/chat-auto-compact"
import { upsertChatSessionMemory } from "@/main/chat-session-memory"
import type { AppDatabase } from "@/main/db"
import { chatMessages, chatSessions } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import { upsertChatSessionMemoryEntry } from "@/main/memory"
import {
  maybeRefreshProjectMemoryDigest,
  shouldRefreshLongTermMemory
} from "@/main/memory/project-digest"
import { getSettings } from "@/main/settings"
import { isRecord } from "@/renderer/lib/utils"

const CHAT_TITLE_MAX_LENGTH = 64
const GENERATED_MESSAGE_ID_PREFIX = "etyon-generated-message"
const WHITESPACE_PATTERN = /\s+/gu

const parseJson = (value: string): unknown => JSON.parse(value)

const parseOptionalJson = (value: string | null): unknown | undefined =>
  value === null ? undefined : parseJson(value)

const serializeOptionalJson = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value)

/** Reads the agent run id stamped on an assistant message's metadata, so the
 * chat row can be linked back to (and rebuilt from) its event-sourced run. */
const getAgentProjectionRunId = (metadata: unknown): string | null => {
  if (!isRecord(metadata)) {
    return null
  }

  const projection = metadata.agentProjection

  if (!isRecord(projection)) {
    return null
  }

  return typeof projection.runId === "string" ? projection.runId : null
}

const getTextParts = (
  message: UIMessage
): Extract<UIMessage["parts"][number], { type: "text" }>[] =>
  message.parts.filter(
    (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
      part.type === "text"
  )

const getMessageText = (message: UIMessage): string =>
  getTextParts(message)
    .map((part) => part.text)
    .join(" ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()

const buildChatSessionTitle = (messages: UIMessage[]): string => {
  const firstUserMessage = messages.find((message) => message.role === "user")
  const title = firstUserMessage ? getMessageText(firstUserMessage) : ""

  if (title.length <= CHAT_TITLE_MAX_LENGTH) {
    return title
  }

  return `${title.slice(0, CHAT_TITLE_MAX_LENGTH - 3)}...`
}

const buildGeneratedMessageId = ({
  index,
  seenMessageIds
}: {
  index: number
  seenMessageIds: Set<string>
}): string => {
  let suffix = 0
  let messageId = `${GENERATED_MESSAGE_ID_PREFIX}-${index}`

  while (seenMessageIds.has(messageId)) {
    suffix += 1
    messageId = `${GENERATED_MESSAGE_ID_PREFIX}-${index}-${suffix}`
  }

  return messageId
}

const normalizeMessageIds = (messages: UIMessage[]): UIMessage[] => {
  const seenMessageIds = new Set<string>()

  return messages.map((message, index) => {
    const candidateMessageId = message.id.trim()
    const messageId =
      candidateMessageId && !seenMessageIds.has(candidateMessageId)
        ? candidateMessageId
        : buildGeneratedMessageId({
            index,
            seenMessageIds
          })

    seenMessageIds.add(messageId)

    if (message.id === messageId) {
      return message
    }

    return {
      ...message,
      id: messageId
    }
  })
}

const toUiMessage = (row: typeof chatMessages.$inferSelect): UIMessage => {
  const metadata = parseOptionalJson(row.metadataJson)
  const message = {
    id: row.messageId,
    parts: parseJson(row.partsJson),
    role: row.role
  }

  if (metadata === undefined) {
    return message as UIMessage
  }

  return {
    ...message,
    metadata
  } as UIMessage
}

const getActiveChatSession = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<typeof chatSessions.$inferSelect> => {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
    .limit(1)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  return session
}

const writeChatMessageSnapshot = async ({
  db,
  messages,
  session,
  sessionId
}: {
  db: AppDatabase
  messages: UIMessage[]
  session: typeof chatSessions.$inferSelect
  sessionId: string
}): Promise<void> => {
  const now = new Date().toISOString()
  const nextTitle = session.title.trim()
    ? session.title
    : buildChatSessionTitle(messages)

  await runExclusiveDbWrite(() =>
    db.transaction(async (tx) => {
      await tx.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))

      if (messages.length > 0) {
        await tx.insert(chatMessages).values(
          messages.map((message, index) => ({
            agentProjectionRunId: getAgentProjectionRunId(message.metadata),
            createdAt: now,
            messageId: message.id,
            metadataJson: serializeOptionalJson(message.metadata),
            partsJson: JSON.stringify(message.parts),
            role: message.role,
            sequence: index,
            sessionId,
            updatedAt: now
          }))
        )
      }

      await tx
        .update(chatSessions)
        .set({
          title: nextTitle,
          updatedAt: now
        })
        .where(eq(chatSessions.id, sessionId))
    })
  )
}

export const listChatMessages = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<UIMessage[]> => {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.sequence))

  return rows.map(toUiMessage)
}

/** Saves the submitted transcript before provider work begins. This checkpoint
 * deliberately skips compaction and memory writes so preserving a failed
 * prompt stays bounded and never treats an incomplete turn as memory. */
export const persistSubmittedChatMessages = async ({
  db,
  messages,
  sessionId
}: {
  db: AppDatabase
  messages: UIMessage[]
  sessionId: string
}): Promise<UIMessage[]> => {
  const session = await getActiveChatSession({ db, sessionId })
  const persistableMessages = await persistDataUrlAttachments(messages)
  const normalizedMessages = normalizeMessageIds(persistableMessages)

  await writeChatMessageSnapshot({
    db,
    messages: normalizedMessages,
    session,
    sessionId
  })

  return listChatMessages({ db, sessionId })
}

export const replaceChatMessages = async ({
  db,
  messages,
  sessionId
}: {
  db: AppDatabase
  messages: UIMessage[]
  sessionId: string
}): Promise<UIMessage[]> => {
  const session = await getActiveChatSession({ db, sessionId })

  // Move base64 image `data:` URLs out of the message JSON and onto disk before
  // anything serializes them, so the SQLite chat log stays small and every
  // downstream path (compaction, memory, title) sees the compact url refs.
  const persistableMessages = await persistDataUrlAttachments(messages)
  const settings = getSettings()
  const compactedMessages = await compactChatMessages({
    messages: persistableMessages,
    settings
  })
  const normalizedMessages = normalizeMessageIds(compactedMessages)

  await writeChatMessageSnapshot({
    db,
    messages: normalizedMessages,
    session,
    sessionId
  })

  await upsertChatSessionMemory({
    db,
    messages: normalizedMessages,
    sessionId
  })
  // Both writes below are best-effort and deliberately not awaited: this
  // turn's response is already persisted above, and long-term memory (an
  // LLM/embedding round trip) must never delay the chat stream's close
  // signal. Gated the same way chat-auto-compact gates its own LLM call —
  // not every turn, only once meaningful new content has accumulated.
  if (
    settings.memory.enabled &&
    shouldRefreshLongTermMemory(normalizedMessages.length)
  ) {
    void (async () => {
      try {
        await upsertChatSessionMemoryEntry({
          db,
          messages: normalizedMessages,
          session
        })
      } catch (error) {
        logger.error("chat_session_memory_entry_failed", { error, sessionId })
      }
    })()

    void (async () => {
      try {
        await maybeRefreshProjectMemoryDigest({
          db,
          messages: normalizedMessages,
          projectPath: session.projectPath,
          settings
        })
      } catch (error) {
        logger.error("project_memory_digest_refresh_failed", {
          error,
          projectPath: session.projectPath,
          sessionId
        })
      }
    })()
  }

  return listChatMessages({
    db,
    sessionId
  })
}
