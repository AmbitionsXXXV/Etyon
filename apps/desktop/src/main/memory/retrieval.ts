import type { MemoryEntry, MemorySettings } from "@etyon/rpc"
import { desc, eq, isNull } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { memoryEmbeddings, memoryEntries } from "@/main/db/schema"
import { DEFAULT_EMBEDDING_MODEL_LABEL } from "@/shared/memory/embedding-model-catalog"

const MEMORY_PROMPT_ENTRY_MAX_CHARS = 1200
const MEMORY_RETRIEVAL_CANDIDATE_LIMIT = 200
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu

interface RetrieveMemoryEntriesInput {
  db: AppDatabase
  embeddingModel: string
  projectPath: null | string
  query: string
  queryEmbedding?: number[] | null
  settings: MemorySettings
}

interface ScoredMemoryEntry {
  entry: MemoryEntry
  lexicalScore: number
  recencyScore: number
  scopeScore: number
  totalScore: number
  vectorScore: number
}

const truncateStart = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) {
    return content
  }

  return `${content.slice(0, maxChars - 3).trim()}...`
}

const tokenize = (value: string): Set<string> =>
  new Set(
    Array.from(value.toLowerCase().matchAll(TOKEN_PATTERN), ([token]) => token)
  )

const scoreLexicalMemoryEntry = ({
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
  projectPath: null | string
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

const parseVector = (value: string): number[] | null => {
  try {
    const parsed = JSON.parse(value)

    if (!Array.isArray(parsed)) {
      return null
    }

    return parsed.filter((item): item is number => typeof item === "number")
  } catch {
    return null
  }
}

const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) {
    return 0
  }

  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0

    dotProduct += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

const scoreRecency = (entry: MemoryEntry): number => {
  const updatedAtMs = Date.parse(entry.updatedAt)

  if (Number.isNaN(updatedAtMs)) {
    return 0
  }

  const ageDays = Math.max(0, (Date.now() - updatedAtMs) / 86_400_000)

  return Math.max(0, 8 - Math.floor(ageDays / 7))
}

const scoreScope = ({
  entry,
  projectPath
}: {
  entry: MemoryEntry
  projectPath: null | string
}): number => {
  if (entry.projectPath && entry.projectPath === projectPath) {
    return 8
  }

  if (entry.scope === "global") {
    return 3
  }

  return 0
}

const getEmbeddingModelId = (settings: MemorySettings): string =>
  settings.embeddingModel || DEFAULT_EMBEDDING_MODEL_LABEL

const loadEmbeddingVectors = async ({
  db,
  model
}: {
  db: AppDatabase
  model: string
}): Promise<Map<string, number[]>> => {
  const rows = await db
    .select()
    .from(memoryEmbeddings)
    .where(eq(memoryEmbeddings.model, model))

  return new Map(
    rows.flatMap((row) => {
      const vector = parseVector(row.vectorJson)

      return vector ? [[row.memoryId, vector] as const] : []
    })
  )
}

const scoreMemoryEntry = ({
  embeddingVectors,
  entry,
  projectPath,
  queryEmbedding,
  queryTokens
}: {
  embeddingVectors: Map<string, number[]>
  entry: MemoryEntry
  projectPath: null | string
  queryEmbedding?: number[] | null
  queryTokens: Set<string>
}): ScoredMemoryEntry => {
  const lexicalScore = scoreLexicalMemoryEntry({ entry, queryTokens })
  const entryEmbedding = embeddingVectors.get(entry.id)
  const similarity =
    queryEmbedding && entryEmbedding
      ? cosineSimilarity(queryEmbedding, entryEmbedding)
      : 0
  const vectorScore = similarity > 0 ? similarity * 100 : 0
  const recencyScore = scoreRecency(entry)
  const scopeScore = scoreScope({ entry, projectPath })
  const totalScore =
    lexicalScore +
    vectorScore +
    recencyScore +
    scopeScore +
    Math.min(entry.accessCount, 8)

  return {
    entry,
    lexicalScore,
    recencyScore,
    scopeScore,
    totalScore,
    vectorScore
  }
}

const shouldKeepScoredEntry = ({
  queryEmbedding,
  queryTokens,
  scoredEntry,
  settings
}: {
  queryEmbedding?: number[] | null
  queryTokens: Set<string>
  scoredEntry: ScoredMemoryEntry
  settings: MemorySettings
}): boolean => {
  if (queryTokens.size === 0 && !queryEmbedding) {
    return true
  }

  if (scoredEntry.lexicalScore > 0) {
    return true
  }

  if (!queryEmbedding) {
    return false
  }

  return scoredEntry.vectorScore / 100 >= settings.similarityThreshold
}

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

export const formatMemoryPromptEntry = (
  entry: MemoryEntry,
  index: number
): string =>
  [
    `[${index + 1}] scope=${entry.scope} source=${entry.source}`,
    entry.projectPath ? `project=${entry.projectPath}` : "",
    `updated=${entry.updatedAt}`,
    truncateStart(entry.content, MEMORY_PROMPT_ENTRY_MAX_CHARS)
  ]
    .filter(Boolean)
    .join("\n")

export const retrieveMemoryEntries = async ({
  db,
  embeddingModel,
  projectPath,
  query,
  queryEmbedding,
  settings
}: RetrieveMemoryEntriesInput): Promise<MemoryEntry[]> => {
  if (!settings.enabled || !settings.autoRetrieve) {
    return []
  }

  const queryTokens = tokenize(query)
  const entries = await db
    .select()
    .from(memoryEntries)
    .where(isNull(memoryEntries.archivedAt))
    .orderBy(desc(memoryEntries.updatedAt))
    .limit(MEMORY_RETRIEVAL_CANDIDATE_LIMIT)
  const embeddingVectors = queryEmbedding
    ? await loadEmbeddingVectors({
        db,
        model: embeddingModel || getEmbeddingModelId(settings)
      })
    : new Map<string, number[]>()
  const rankedEntries = entries
    .filter((entry) => canUseEntryForScope({ entry, projectPath, settings }))
    .map((entry) =>
      scoreMemoryEntry({
        embeddingVectors,
        entry,
        projectPath,
        queryEmbedding,
        queryTokens
      })
    )
    .filter((scoredEntry) =>
      shouldKeepScoredEntry({
        queryEmbedding,
        queryTokens,
        scoredEntry,
        settings
      })
    )
    .toSorted((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore
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
