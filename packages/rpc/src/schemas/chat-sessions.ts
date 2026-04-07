import * as z from "zod"

export const ChatMentionSchema = z.object({
  kind: z.literal("file"),
  path: z.string(),
  relativePath: z.string(),
  snapshotId: z.string()
})

export const ChatSessionSummarySchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  lastOpenedAt: z.string(),
  modelId: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  projectPath: z.string(),
  title: z.string(),
  updatedAt: z.string()
})

export const ChatSessionsListOutputSchema = z.array(ChatSessionSummarySchema)

export const CreateChatSessionInputSchema = z.object({
  currentSessionId: z.string().optional(),
  projectPath: z.string().min(1).optional()
})

export const OpenChatSessionInputSchema = z.object({
  sessionId: z.string()
})

export const SetPinnedChatSessionInputSchema = z.object({
  pinned: z.boolean(),
  sessionId: z.string()
})

export const SetChatSessionModelInputSchema = z.object({
  modelId: z.string().nullable(),
  sessionId: z.string()
})

export type ChatSessionSummary = z.infer<typeof ChatSessionSummarySchema>
export type ChatMention = z.infer<typeof ChatMentionSchema>
export type CreateChatSessionInput = z.infer<
  typeof CreateChatSessionInputSchema
>
export type OpenChatSessionInput = z.infer<typeof OpenChatSessionInputSchema>
export type SetChatSessionModelInput = z.infer<
  typeof SetChatSessionModelInputSchema
>
export type SetPinnedChatSessionInput = z.infer<
  typeof SetPinnedChatSessionInputSchema
>
