import type { UIMessage } from "ai"
import { and, asc, eq, isNull } from "drizzle-orm"

import { compactChatMessages } from "@/main/chat-auto-compact"
import { upsertChatSessionMemory } from "@/main/chat-session-memory"
import type { AppDatabase } from "@/main/db"
import { chatMessages, chatSessions } from "@/main/db/schema"
import { upsertChatSessionMemoryEntry } from "@/main/memory"
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

export const replaceChatMessages = async ({
  db,
  messages,
  sessionId
}: {
  db: AppDatabase
  messages: UIMessage[]
  sessionId: string
}): Promise<UIMessage[]> => {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.archivedAt)))
    .limit(1)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const settings = getSettings()
  const compactedMessages = await compactChatMessages({
    messages,
    settings
  })
  const normalizedMessages = normalizeMessageIds(compactedMessages)
  const now = new Date().toISOString()
  const nextTitle = session.title.trim()
    ? session.title
    : buildChatSessionTitle(messages)

  await db.transaction(async (tx) => {
    await tx.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))

    if (normalizedMessages.length > 0) {
      await tx.insert(chatMessages).values(
        normalizedMessages.map((message, index) => ({
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

  await upsertChatSessionMemory({
    db,
    messages: normalizedMessages,
    sessionId
  })
  if (settings.memory.enabled) {
    await upsertChatSessionMemoryEntry({
      db,
      messages: normalizedMessages,
      session
    })
  }

  return listChatMessages({
    db,
    sessionId
  })
}
