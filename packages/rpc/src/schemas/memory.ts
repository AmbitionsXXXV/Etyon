import * as z from "zod"

export const MemoryScopeSchema = z.enum(["chatbot", "global", "project"])

export const MemorySourceSchema = z.enum(["chat-session", "chatbot"])

export const MemoryKindSchema = z.enum(["episodic", "semantic", "working"])

export const MemorySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  includeChatbot: z.boolean().default(true),
  maxContextEntries: z.number().int().min(1).max(20).default(8),
  shareAcrossProjects: z.boolean().default(true)
})

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

export type ListMemoryEntriesInput = z.infer<
  typeof ListMemoryEntriesInputSchema
>
export type MemoryEntriesOutput = z.infer<typeof MemoryEntriesOutputSchema>
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>
export type MemoryKind = z.infer<typeof MemoryKindSchema>
export type MemoryScope = z.infer<typeof MemoryScopeSchema>
export type MemorySettings = z.infer<typeof MemorySettingsSchema>
export type MemorySource = z.infer<typeof MemorySourceSchema>
export type MemoryStatsOutput = z.infer<typeof MemoryStatsOutputSchema>
