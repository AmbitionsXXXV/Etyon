import crypto from "node:crypto"

import { createOpenAI } from "@ai-sdk/openai"
import type { AppSettings, MemoryEntry } from "@etyon/rpc"
import { embed } from "ai"
import { and, eq } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { memoryEmbeddings } from "@/main/db/schema"
import { getLocalEmbeddingModelOption } from "@/main/memory/embedding-models"
import { DEFAULT_EMBEDDING_MODEL_LABEL } from "@/shared/memory/embedding-model-catalog"

export interface MemoryEmbeddingProvider {
  embed: (input: string) => Promise<number[]>
  model: string
}

export interface UpsertMemoryEmbeddingInput {
  db: AppDatabase
  entry: MemoryEntry
  provider?: MemoryEmbeddingProvider
  settings: AppSettings
}

const LOCAL_EMBEDDING_MODEL_PREFIX = "local:"

const createContentHash = (content: string): string =>
  crypto.createHash("sha256").update(content).digest("hex")

const resolveEmbeddingModelId = (settings: AppSettings): string =>
  settings.memory.embeddingModel || DEFAULT_EMBEDDING_MODEL_LABEL

const createOpenAiEmbeddingProvider = (
  settings: AppSettings,
  modelId: string
): MemoryEmbeddingProvider => {
  const providerConfig = settings.ai.providers.openai
  const apiKey = providerConfig.apiKey.trim()

  if (!apiKey) {
    throw new Error("OpenAI API Key is required for default memory embeddings.")
  }

  const openai = createOpenAI({
    apiKey,
    ...(providerConfig.baseURL ? { baseURL: providerConfig.baseURL } : {})
  })
  const model = openai.embedding(modelId)

  return {
    async embed(input: string) {
      const result = await embed({
        model,
        value: input
      })

      return result.embedding
    },
    model: modelId
  }
}

export const createMemoryEmbeddingProvider = (
  settings: AppSettings
): MemoryEmbeddingProvider => {
  const modelId = resolveEmbeddingModelId(settings)

  if (modelId.startsWith(LOCAL_EMBEDDING_MODEL_PREFIX)) {
    const localModel = getLocalEmbeddingModelOption(modelId)

    if (!localModel) {
      throw new Error(`Unknown local memory embedding model: ${modelId}`)
    }

    if (!localModel.installed) {
      throw new Error(
        `Local memory embedding model is not installed: ${modelId}`
      )
    }

    return {
      embed() {
        return Promise.reject(
          new Error(
            `Local memory embedding runtime is not available yet: ${modelId}`
          )
        )
      },
      model: modelId
    }
  }

  return createOpenAiEmbeddingProvider(settings, modelId)
}

export const upsertMemoryEmbedding = async ({
  db,
  entry,
  provider,
  settings
}: UpsertMemoryEmbeddingInput): Promise<void> => {
  const embeddingProvider = provider ?? createMemoryEmbeddingProvider(settings)
  const contentHash = createContentHash(entry.content)
  const now = new Date().toISOString()
  const [existingEmbedding] = await db
    .select()
    .from(memoryEmbeddings)
    .where(
      and(
        eq(memoryEmbeddings.memoryId, entry.id),
        eq(memoryEmbeddings.model, embeddingProvider.model)
      )
    )
    .limit(1)

  if (existingEmbedding?.contentHash === contentHash) {
    return
  }

  const vector = await embeddingProvider.embed(entry.content)
  const values = {
    contentHash,
    dimensions: vector.length,
    memoryId: entry.id,
    model: embeddingProvider.model,
    updatedAt: now,
    vectorJson: JSON.stringify(vector)
  }

  if (existingEmbedding) {
    await db
      .update(memoryEmbeddings)
      .set(values)
      .where(
        and(
          eq(memoryEmbeddings.memoryId, entry.id),
          eq(memoryEmbeddings.model, embeddingProvider.model)
        )
      )
    return
  }

  await db.insert(memoryEmbeddings).values({
    ...values,
    createdAt: now
  })
}
