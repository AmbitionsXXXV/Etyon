import * as z from "zod"

const ChatFileMentionSchema = z.object({
  kind: z.literal("file"),
  path: z.string(),
  relativePath: z.string(),
  snapshotId: z.string()
})

const ChatFolderMentionSchema = z.object({
  kind: z.literal("folder"),
  path: z.string(),
  relativePath: z.string(),
  snapshotId: z.string()
})

export const ChatMentionSchema = z.discriminatedUnion("kind", [
  ChatFileMentionSchema,
  ChatFolderMentionSchema
])

export const ChatSessionSummarySchema = z.object({
  archivedAt: z.string().nullable(),
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

export const ArchiveChatSessionInputSchema = z.object({
  sessionId: z.string()
})

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

export type ArchiveChatSessionInput = z.infer<
  typeof ArchiveChatSessionInputSchema
>
export type ChatMention = z.infer<typeof ChatMentionSchema>
export type ChatSessionSummary = z.infer<typeof ChatSessionSummarySchema>
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
