import type { AppSettings, MemoryEntry } from "@etyon/rpc"
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { memoryEmbeddings, memoryEntries } from "@/main/db/schema"
import { DEFAULT_EMBEDDING_MODEL_LABEL } from "@/shared/memory/embedding-model-catalog"

export interface MemoryLifecycleDiagnostics {
  activeEntries: number
  archivedEntries: number
  duplicateEntries: number
  embeddingModel: string
  missingEmbeddings: number
  staleEmbeddings: number
}

const normalizeContent = (content: string): string =>
  content.replaceAll(/\s+/gu, " ").trim().toLowerCase()

const getEmbeddingModelId = (settings: AppSettings): string =>
  settings.memory.embeddingModel || DEFAULT_EMBEDDING_MODEL_LABEL

const getDuplicateEntryIds = (entries: MemoryEntry[]): string[] => {
  const entriesByContent = new Map<string, MemoryEntry[]>()

  for (const entry of entries) {
    const key = normalizeContent(entry.content)
    const existingEntries = entriesByContent.get(key) ?? []

    existingEntries.push(entry)
    entriesByContent.set(key, existingEntries)
  }

  return [...entriesByContent.values()].flatMap((duplicates) =>
    duplicates
      .toSorted((left, right) => {
        if (right.accessCount !== left.accessCount) {
          return right.accessCount - left.accessCount
        }

        return right.updatedAt.localeCompare(left.updatedAt)
      })
      .slice(1)
      .map((entry) => entry.id)
  )
}

export const getMemoryDecayScore = (
  entry: MemoryEntry,
  now = Date.now()
): number => {
  const updatedAtMs = Date.parse(entry.updatedAt)

  if (Number.isNaN(updatedAtMs)) {
    return 0
  }

  const ageDays = Math.max(0, (now - updatedAtMs) / 86_400_000)
  const accessBoost = Math.min(20, entry.accessCount * 2)

  return Math.max(0, 100 - ageDays + accessBoost)
}

export const buildMemoryLifecycleDiagnostics = async ({
  db,
  settings
}: {
  db: AppDatabase
  settings: AppSettings
}): Promise<MemoryLifecycleDiagnostics> => {
  const embeddingModel = getEmbeddingModelId(settings)
  const activeEntries = await db
    .select()
    .from(memoryEntries)
    .where(isNull(memoryEntries.archivedAt))
  const archivedEntries = await db
    .select()
    .from(memoryEntries)
    .where(isNotNull(memoryEntries.archivedAt))
  const embeddings = await db
    .select()
    .from(memoryEmbeddings)
    .where(eq(memoryEmbeddings.model, embeddingModel))
  const embeddingsByMemoryId = new Map(
    embeddings.map((embedding) => [embedding.memoryId, embedding])
  )
  let staleEmbeddings = 0
  let missingEmbeddings = 0

  for (const entry of activeEntries) {
    const embedding = embeddingsByMemoryId.get(entry.id)

    if (!embedding) {
      missingEmbeddings += 1
      continue
    }

    if (embedding.updatedAt < entry.updatedAt) {
      staleEmbeddings += 1
    }
  }

  return {
    activeEntries: activeEntries.length,
    archivedEntries: archivedEntries.length,
    duplicateEntries: getDuplicateEntryIds(activeEntries).length,
    embeddingModel,
    missingEmbeddings,
    staleEmbeddings
  }
}

export const archiveDuplicateMemoryEntries = async (
  db: AppDatabase
): Promise<number> => {
  const activeEntries = await db
    .select()
    .from(memoryEntries)
    .where(isNull(memoryEntries.archivedAt))
  const duplicateEntryIds = getDuplicateEntryIds(activeEntries)
  const now = new Date().toISOString()

  for (const entryId of duplicateEntryIds) {
    await db
      .update(memoryEntries)
      .set({
        archivedAt: now,
        updatedAt: now
      })
      .where(eq(memoryEntries.id, entryId))
  }

  return duplicateEntryIds.length
}

export const archiveDecayedMemoryEntries = async ({
  db,
  maxAccessCount,
  updatedBefore
}: {
  db: AppDatabase
  maxAccessCount: number
  updatedBefore: string
}): Promise<number> => {
  const now = new Date().toISOString()
  const candidates = await db
    .select()
    .from(memoryEntries)
    .where(
      and(
        isNull(memoryEntries.archivedAt),
        lt(memoryEntries.accessCount, maxAccessCount + 1),
        lt(memoryEntries.updatedAt, updatedBefore)
      )
    )

  for (const entry of candidates) {
    await db
      .update(memoryEntries)
      .set({
        archivedAt: now,
        updatedAt: now
      })
      .where(eq(memoryEntries.id, entry.id))
  }

  return candidates.length
}
