import type { AppSettings } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { and, eq, isNull } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { memoryEntries } from "@/main/db/schema"
import { summarizeMemoryContent } from "@/main/memory/summarization"
import { getMessageText } from "@/shared/chat/context-usage"

/**
 * Rolling per-project memory digest: the cheap, always-on read tier.
 *
 * Unlike live retrieval (`buildMemorySystemPrompt`), reading the digest is a
 * single local `SELECT` — no LLM call, no embedding call — so it's safe to
 * include on every turn. Refreshing it is gated (not every turn) and, when
 * `memory.autoSummarize` is off (the default), `summarizeMemoryContent`
 * itself skips its LLM call too, so the write stays local by default as
 * well. Deep, specific recall beyond what the digest covers goes through the
 * `search_memory` tool instead of blocking this path.
 */

const PROJECT_DIGEST_SOURCE = "project-digest"
const DIGEST_REFRESH_INTERVAL_MESSAGES = 6
const DIGEST_RECENT_MESSAGE_COUNT = 12
const DIGEST_MAX_CHARS = 4000

const ROLE_LABELS: Record<string, string> = {
  assistant: "Assistant",
  system: "System",
  user: "User"
}

const truncateEnd = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) {
    return content
  }

  return content.slice(content.length - maxChars).trim()
}

/**
 * Shared gate for periodic long-term-memory writes (the digest and the
 * per-session archival entry both use it): once after the first exchange so
 * short conversations still get captured, then every `DIGEST_REFRESH_
 * INTERVAL_MESSAGES` messages after that — not on every single turn.
 */
export const shouldRefreshLongTermMemory = (messageCount: number): boolean =>
  messageCount === 2 || messageCount % DIGEST_REFRESH_INTERVAL_MESSAGES === 0

const findDigestEntry = (db: AppDatabase, projectPath: string) =>
  db
    .select()
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.source, PROJECT_DIGEST_SOURCE),
        eq(memoryEntries.sourceId, projectPath),
        isNull(memoryEntries.archivedAt)
      )
    )
    .limit(1)

export const getProjectMemoryDigest = async (
  db: AppDatabase,
  projectPath: string
): Promise<string> => {
  const [entry] = await findDigestEntry(db, projectPath)

  return entry?.content.trim() ?? ""
}

export const buildProjectDigestSystemPrompt = (digest: string): string => {
  const trimmed = digest.trim()

  if (!trimmed) {
    return ""
  }

  return [
    "Project memory digest (a rolling summary maintained across past sessions):",
    trimmed,
    "Use this as background context. Prefer the live conversation when they conflict, and use the search_memory tool for a specific past detail this digest doesn't cover."
  ].join("\n")
}

const buildFallbackDigestContent = ({
  previousDigest,
  recentMessages
}: {
  previousDigest: string
  recentMessages: UIMessage[]
}): string => {
  const lines = recentMessages
    .map((message) => ({
      role: message.role,
      text: getMessageText(message)
    }))
    .filter(({ text }) => text.length > 0)
    .map(({ role, text }) => `${ROLE_LABELS[role] ?? role}: ${text}`)

  return truncateEnd(
    [
      previousDigest ? `Previous digest:\n${previousDigest}` : "",
      lines.length > 0 ? `Recent conversation:\n${lines.join("\n")}` : ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    DIGEST_MAX_CHARS
  )
}

export const maybeRefreshProjectMemoryDigest = async ({
  db,
  messages,
  projectPath,
  settings
}: {
  db: AppDatabase
  messages: UIMessage[]
  projectPath: string
  settings: AppSettings
}): Promise<void> => {
  if (!settings.memory.enabled) {
    return
  }

  const [existing] = await findDigestEntry(db, projectPath)
  const shouldRefresh =
    !existing || shouldRefreshLongTermMemory(messages.length)

  if (!shouldRefresh) {
    return
  }

  const fallbackContent = buildFallbackDigestContent({
    previousDigest: existing?.content.trim() ?? "",
    recentMessages: messages.slice(-DIGEST_RECENT_MESSAGE_COUNT)
  })

  if (!fallbackContent) {
    return
  }

  const content = await summarizeMemoryContent({
    fallbackContent,
    heading: "Project memory digest",
    projectPath,
    settings
  })
  const now = new Date().toISOString()

  if (existing) {
    await db
      .update(memoryEntries)
      .set({ content, updatedAt: now })
      .where(eq(memoryEntries.id, existing.id))

    return
  }

  await db.insert(memoryEntries).values({
    accessCount: 0,
    archivedAt: null,
    content,
    createdAt: now,
    id: crypto.randomUUID(),
    kind: "semantic",
    lastAccessedAt: null,
    projectPath,
    scope: "project",
    sessionId: null,
    source: PROJECT_DIGEST_SOURCE,
    sourceId: projectPath,
    updatedAt: now
  })
}
