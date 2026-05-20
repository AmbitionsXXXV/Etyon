import * as z from "zod"

export const MemoryScopeSchema = z.enum(["chatbot", "global", "project"])

export const MemorySourceSchema = z.enum(["chat-session", "chatbot"])

export const MemoryKindSchema = z.enum(["episodic", "semantic", "working"])

export const MEMORY_TOOL_MODEL_AUTO_VALUE = "__auto__"

export const MemorySettingsSchema = z
  .object({
    autoRetrieve: z.boolean().default(true),
    autoSummarize: z.boolean().default(false),
    embeddingModel: z.string().default(""),
    enabled: z.boolean().default(true),
    includeChatbot: z.boolean().default(true),
    maxContextEntries: z.number().int().min(1).max(20).default(8),
    maxRetrievedMemories: z.number().int().min(1).max(20).optional(),
    memoryToolModel: z.string().default(MEMORY_TOOL_MODEL_AUTO_VALUE),
    queryRewriting: z.boolean().default(true),
    shareAcrossProjects: z.boolean().default(true),
    similarityThreshold: z.number().min(0).max(1).default(0.1)
  })
  .transform((settings) => ({
    ...settings,
    maxRetrievedMemories:
      settings.maxRetrievedMemories ?? settings.maxContextEntries
  }))

export const MemoryEntrySchema = z.object({
  accessCount: z.number().int().nonnegative(),
  archivedAt: z.string().nullable(),
  content: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: MemoryKindSchema,
  lastAccessedAt: z.string().nullable(),
  projectPath: z.string().nullable(),
  scope: MemoryScopeSchema,
  sessionId: z.string().nullable(),
  source: MemorySourceSchema,
  sourceId: z.string(),
  updatedAt: z.string()
})

export const ListMemoryEntriesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50)
})

export const MemoryEntriesOutputSchema = z.object({
  entries: z.array(MemoryEntrySchema)
})

export const MemoryStatsOutputSchema = z.object({
  lastUpdatedAt: z.string().nullable(),
  totalEntries: z.number().int().nonnegative()
})

export const MemoryEmbeddingModelSourceSchema = z.enum(["default", "local"])

export const MemoryEmbeddingModelStatusSchema = z.enum([
  "available",
  "downloading",
  "missing"
])

export const MemoryEmbeddingModelSchema = z.object({
  downloadSize: z.string().nullable(),
  id: z.string(),
  isDefault: z.boolean(),
  label: z.string(),
  source: MemoryEmbeddingModelSourceSchema,
  status: MemoryEmbeddingModelStatusSchema
})

export const MemoryEmbeddingModelsOutputSchema = z.object({
  models: z.array(MemoryEmbeddingModelSchema)
})

export const InstallMemoryEmbeddingModelInputSchema = z.object({
  modelId: z.string()
})

export type ListMemoryEntriesInput = z.infer<
  typeof ListMemoryEntriesInputSchema
>
export type InstallMemoryEmbeddingModelInput = z.infer<
  typeof InstallMemoryEmbeddingModelInputSchema
>
export type MemoryEntriesOutput = z.infer<typeof MemoryEntriesOutputSchema>
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>
export type MemoryEmbeddingModel = z.infer<typeof MemoryEmbeddingModelSchema>
export type MemoryEmbeddingModelSource = z.infer<
  typeof MemoryEmbeddingModelSourceSchema
>
export type MemoryEmbeddingModelStatus = z.infer<
  typeof MemoryEmbeddingModelStatusSchema
>
export type MemoryEmbeddingModelsOutput = z.infer<
  typeof MemoryEmbeddingModelsOutputSchema
>
export type MemoryKind = z.infer<typeof MemoryKindSchema>
export type MemoryScope = z.infer<typeof MemoryScopeSchema>
export type MemorySettings = z.infer<typeof MemorySettingsSchema>
export type MemorySource = z.infer<typeof MemorySourceSchema>
export type MemoryStatsOutput = z.infer<typeof MemoryStatsOutputSchema>
