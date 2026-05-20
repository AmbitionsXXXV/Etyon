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
  rewriteMemoryQuery,
  summarizeMemoryContent
} from "@/main/memory/summarization"
import { getSettings } from "@/main/settings"

const MEMORY_ENTRY_MAX_CHARS = 6000
const MEMORY_ENTRY_MAX_MESSAGES = 20
const MEMORY_PROMPT_ENTRY_MAX_CHARS = 1200
const MEMORY_RETRIEVAL_CANDIDATE_LIMIT = 200
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu
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

const truncateEnd = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) {
    return content
  }

  return content.slice(content.length - maxChars).trim()
}

const truncateStart = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) {
    return content
  }

  return `${content.slice(0, maxChars - 3).trim()}...`
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

const tokenize = (value: string): Set<string> =>
  new Set(
    Array.from(value.toLowerCase().matchAll(TOKEN_PATTERN), ([token]) => token)
  )

const scoreMemoryEntry = ({
  entry,
  queryTokens
}: {
  entry: MemoryEntry
  queryTokens: Set<string>
}): number => {
  if (queryTokens.size === 0) {
    return 0
  }

  const contentTokens = tokenize(entry.content)
  let overlap = 0

  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap * 10 + Math.min(entry.accessCount, 10)
}

const canUseEntryForScope = ({
  entry,
  projectPath,
  settings
}: {
  entry: MemoryEntry
  projectPath: string | null
  settings: MemorySettings
}): boolean => {
  if (entry.source === "chatbot" && !settings.includeChatbot) {
    return false
  }

  if (settings.shareAcrossProjects) {
    return true
  }

  if (!entry.projectPath) {
    return projectPath === null || entry.scope !== "project"
  }

  return entry.projectPath === projectPath
}

const formatMemoryPromptEntry = (entry: MemoryEntry, index: number): string =>
  [
    `[${index + 1}] scope=${entry.scope} source=${entry.source}`,
    entry.projectPath ? `project=${entry.projectPath}` : "",
    `updated=${entry.updatedAt}`,
    truncateStart(entry.content, MEMORY_PROMPT_ENTRY_MAX_CHARS)
  ]
    .filter(Boolean)
    .join("\n")

const markMemoryEntriesAccessed = async ({
  db,
  entries
}: {
  db: AppDatabase
  entries: MemoryEntry[]
}): Promise<void> => {
  const now = new Date().toISOString()

  for (const entry of entries) {
    await db
      .update(memoryEntries)
      .set({
        accessCount: entry.accessCount + 1,
        lastAccessedAt: now
      })
      .where(eq(memoryEntries.id, entry.id))
  }
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

export const retrieveMemoryEntries = async ({
  db,
  projectPath,
  query,
  settings
}: {
  db: AppDatabase
  projectPath: string | null
  query: string
  settings: MemorySettings
}): Promise<MemoryEntry[]> => {
  if (!settings.enabled || !settings.autoRetrieve) {
    return []
  }

  const queryTokens = tokenize(query)
  const entries = await listMemoryEntries(db, MEMORY_RETRIEVAL_CANDIDATE_LIMIT)
  const rankedEntries = entries
    .filter((entry) => canUseEntryForScope({ entry, projectPath, settings }))
    .map((entry) => ({
      entry,
      score: scoreMemoryEntry({ entry, queryTokens })
    }))
    .filter(({ score }) => queryTokens.size === 0 || score > 0)
    .toSorted((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.entry.updatedAt.localeCompare(left.entry.updatedAt)
    })
    .slice(0, settings.maxRetrievedMemories)
    .map(({ entry }) => entry)

  await markMemoryEntriesAccessed({
    db,
    entries: rankedEntries
  })

  return rankedEntries
}

export const buildMemorySystemPrompt = async ({
  db,
  projectPath,
  query,
  settings
}: {
  db: AppDatabase
  projectPath: string | null
  query: string
  settings: MemorySettings
}): Promise<string> => {
  const appSettings = {
    ...getSettings(),
    memory: settings
  }
  const effectiveQuery = await rewriteMemoryQuery({
    query,
    settings: appSettings
  })
  const entries = await retrieveMemoryEntries({
    db,
    projectPath,
    query: effectiveQuery,
    settings
  })

  if (entries.length === 0) {
    return ""
  }

  return [
    "Long-term memory retrieved from Etyon:",
    ...entries.map(formatMemoryPromptEntry),
    "Use these memories only when relevant. Prefer the current request and live session messages when they conflict."
  ].join("\n\n")
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

  return upsertMemoryEntry({
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
}

export const upsertChatbotMemoryEntry = async ({
  chatbotId,
  db,
  messages
}: {
  chatbotId: string
  db: AppDatabase
  messages: MemoryMessageLike[]
}): Promise<MemoryEntry | undefined> =>
  upsertMemoryEntry({
    content: await buildMemoryEntryContent({
      appSettings: getSettings(),
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
