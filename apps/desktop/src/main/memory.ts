import type {
  AppSettings,
  ChatSessionSummary,
  MemoryEntry,
  MemorySettings
} from "@etyon/rpc"
import { and, count, desc, eq, isNull, max } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { memoryEntries } from "@/main/db/schema"
import {
  embedMemoryQuery,
  upsertMemoryEmbedding
} from "@/main/memory/embeddings"
import {
  formatMemoryPromptEntry,
  retrieveMemoryEntries
} from "@/main/memory/retrieval"
import {
  rewriteMemoryQuery,
  summarizeMemoryContent
} from "@/main/memory/summarization"
import { getSettings } from "@/main/settings"

const MEMORY_ENTRY_MAX_CHARS = 6000
const MEMORY_ENTRY_MAX_MESSAGES = 20
const WHITESPACE_PATTERN = /\s+/gu

const ROLE_LABELS: Record<string, string> = {
  assistant: "Assistant",
  system: "System",
  user: "User"
}

interface MemoryMessageLike {
  content?: unknown
  parts?: unknown
  role: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const normalizeText = (value: string): string =>
  value.replace(WHITESPACE_PATTERN, " ").trim()

const throwIfAborted = (abortSignal?: AbortSignal): void => {
  if (!abortSignal?.aborted) {
    return
  }

  throw abortSignal.reason instanceof Error
    ? abortSignal.reason
    : new Error("Memory retrieval aborted.")
}

const formatMemorySystemPrompt = (entries: MemoryEntry[]): string =>
  [
    "Long-term memory retrieved from Etyon:",
    ...entries.map(formatMemoryPromptEntry),
    "Use these memories only when relevant. Prefer the current request and live session messages when they conflict."
  ].join("\n\n")

const truncateEnd = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) {
    return content
  }

  return content.slice(content.length - maxChars).trim()
}

const readTextValues = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap(readTextValues)
  }

  if (!isRecord(value)) {
    return []
  }

  if (typeof value.text === "string") {
    return [value.text]
  }

  if ("content" in value) {
    return readTextValues(value.content)
  }

  return []
}

const getMessageText = (message: MemoryMessageLike): string =>
  normalizeText(
    [...readTextValues(message.parts), ...readTextValues(message.content)].join(
      "\n"
    )
  )

const getRoleLabel = (role: string): string => ROLE_LABELS[role] ?? role

const buildDeterministicMemoryEntryContent = ({
  heading,
  messages,
  projectPath
}: {
  heading: string
  messages: MemoryMessageLike[]
  projectPath?: string | null
}): string => {
  const messageLines = messages
    .map((message) => ({
      role: message.role,
      text: getMessageText(message)
    }))
    .filter(({ text }) => text.length > 0)
    .slice(-MEMORY_ENTRY_MAX_MESSAGES)
    .map(({ role, text }) => `${getRoleLabel(role)}: ${text}`)

  return truncateEnd(
    [
      heading,
      projectPath ? `Project: ${projectPath}` : "",
      messageLines.length > 0 ? "Conversation:" : "",
      ...messageLines
    ]
      .filter(Boolean)
      .join("\n"),
    MEMORY_ENTRY_MAX_CHARS
  )
}

const buildMemoryEntryContent = ({
  appSettings,
  heading,
  messages,
  projectPath
}: {
  appSettings: AppSettings
  heading: string
  messages: MemoryMessageLike[]
  projectPath?: null | string
}): Promise<string> => {
  const fallbackContent = buildDeterministicMemoryEntryContent({
    heading,
    messages,
    projectPath
  })

  return summarizeMemoryContent({
    fallbackContent,
    heading,
    projectPath: projectPath ?? null,
    settings: appSettings
  })
}

const upsertMemoryEntry = async ({
  content,
  db,
  kind,
  projectPath,
  scope,
  sessionId,
  source,
  sourceId
}: {
  content: string
  db: AppDatabase
  kind: MemoryEntry["kind"]
  projectPath: string | null
  scope: MemoryEntry["scope"]
  sessionId: string | null
  source: MemoryEntry["source"]
  sourceId: string
}): Promise<MemoryEntry | undefined> => {
  const normalizedContent = content.trim()
  const now = new Date().toISOString()
  const [existingEntry] = await db
    .select()
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.source, source),
        eq(memoryEntries.sourceId, sourceId)
      )
    )
    .limit(1)

  if (!normalizedContent) {
    if (existingEntry) {
      await db
        .update(memoryEntries)
        .set({
          archivedAt: now,
          updatedAt: now
        })
        .where(eq(memoryEntries.id, existingEntry.id))
    }

    return undefined
  }

  if (existingEntry) {
    const [updatedEntry] = await db
      .update(memoryEntries)
      .set({
        archivedAt: null,
        content: normalizedContent,
        kind,
        projectPath,
        scope,
        sessionId,
        updatedAt: now
      })
      .where(eq(memoryEntries.id, existingEntry.id))
      .returning()

    return updatedEntry
  }

  const [createdEntry] = await db
    .insert(memoryEntries)
    .values({
      accessCount: 0,
      archivedAt: null,
      content: normalizedContent,
      createdAt: now,
      id: crypto.randomUUID(),
      kind,
      lastAccessedAt: null,
      projectPath,
      scope,
      sessionId,
      source,
      sourceId,
      updatedAt: now
    })
    .returning()

  return createdEntry
}

const upsertMemoryEntryEmbedding = async ({
  db,
  entry,
  settings
}: {
  db: AppDatabase
  entry: MemoryEntry
  settings: AppSettings
}): Promise<void> => {
  try {
    await upsertMemoryEmbedding({
      db,
      entry,
      settings
    })
  } catch {
    // Embeddings are best-effort until local model downloads and diagnostics land.
  }
}

export const listMemoryEntries = (
  db: AppDatabase,
  limit = 50
): Promise<MemoryEntry[]> =>
  db
    .select()
    .from(memoryEntries)
    .where(isNull(memoryEntries.archivedAt))
    .orderBy(desc(memoryEntries.updatedAt))
    .limit(limit)

export const getMemoryStats = async (
  db: AppDatabase
): Promise<{ lastUpdatedAt: string | null; totalEntries: number }> => {
  const [stats] = await db
    .select({
      lastUpdatedAt: max(memoryEntries.updatedAt),
      totalEntries: count()
    })
    .from(memoryEntries)
    .where(isNull(memoryEntries.archivedAt))

  return {
    lastUpdatedAt: stats?.lastUpdatedAt ?? null,
    totalEntries: Number(stats?.totalEntries ?? 0)
  }
}

export const buildMemorySystemPrompt = async ({
  abortSignal,
  db,
  projectPath,
  query,
  settings
}: {
  abortSignal?: AbortSignal
  db: AppDatabase
  projectPath: string | null
  query: string
  settings: MemorySettings
}): Promise<string> => {
  if (!settings.enabled || !settings.autoRetrieve) {
    return ""
  }

  const appSettings = {
    ...getSettings(),
    memory: settings
  }
  const lexicalEntries = await retrieveMemoryEntries({
    db,
    embeddingModel: appSettings.memory.embeddingModel,
    projectPath,
    query,
    queryEmbedding: null,
    settings
  })

  if (lexicalEntries.length > 0) {
    return formatMemorySystemPrompt(lexicalEntries)
  }

  throwIfAborted(abortSignal)

  const effectiveQuery = await rewriteMemoryQuery({
    abortSignal,
    query,
    settings: appSettings
  })

  throwIfAborted(abortSignal)

  const queryEmbedding = await embedMemoryQuery({
    abortSignal,
    input: effectiveQuery,
    settings: appSettings
  }).catch(() => null)

  throwIfAborted(abortSignal)

  const entries = await retrieveMemoryEntries({
    db,
    embeddingModel: appSettings.memory.embeddingModel,
    projectPath,
    query: effectiveQuery,
    queryEmbedding,
    settings
  })

  if (entries.length === 0) {
    return ""
  }

  return formatMemorySystemPrompt(entries)
}

export const upsertChatSessionMemoryEntry = async ({
  db,
  messages,
  session
}: {
  db: AppDatabase
  messages: MemoryMessageLike[]
  session: ChatSessionSummary
}): Promise<MemoryEntry | undefined> => {
  const appSettings = getSettings()

  const entry = await upsertMemoryEntry({
    content: await buildMemoryEntryContent({
      appSettings,
      heading: "Chat session memory",
      messages,
      projectPath: session.projectPath
    }),
    db,
    kind: "episodic",
    projectPath: session.projectPath,
    scope: "project",
    sessionId: session.id,
    source: "chat-session",
    sourceId: session.id
  })

  if (entry) {
    await upsertMemoryEntryEmbedding({
      db,
      entry,
      settings: appSettings
    })
  }

  return entry
}

/**
 * Direct write for the `save_memory` agent tool: the agent that's already
 * generating this turn writes the note itself, so unlike the other memory
 * writes above there's no extra summarization call — only the embedding
 * call needed to make the note searchable later.
 */
export const saveAgentMemoryNote = async ({
  content,
  db,
  projectPath
}: {
  content: string
  db: AppDatabase
  projectPath: string
}): Promise<MemoryEntry | undefined> => {
  const appSettings = getSettings()
  const entry = await upsertMemoryEntry({
    content,
    db,
    kind: "semantic",
    projectPath,
    scope: "project",
    sessionId: null,
    source: "agent-note",
    sourceId: crypto.randomUUID()
  })

  if (entry) {
    await upsertMemoryEntryEmbedding({
      db,
      entry,
      settings: appSettings
    })
  }

  return entry
}

export const upsertChatbotMemoryEntry = async ({
  chatbotId,
  db,
  messages
}: {
  chatbotId: string
  db: AppDatabase
  messages: MemoryMessageLike[]
}): Promise<MemoryEntry | undefined> => {
  const appSettings = getSettings()
  const entry = await upsertMemoryEntry({
    content: await buildMemoryEntryContent({
      appSettings,
      heading: `Chatbot memory: ${chatbotId}`,
      messages
    }),
    db,
    kind: "episodic",
    projectPath: null,
    scope: "chatbot",
    sessionId: null,
    source: "chatbot",
    sourceId: chatbotId
  })

  if (entry) {
    await upsertMemoryEntryEmbedding({
      db,
      entry,
      settings: appSettings
    })
  }

  return entry
}
