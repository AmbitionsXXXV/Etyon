import * as z from "zod"

export const ChatSessionSummarySchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  lastOpenedAt: z.string(),
  pinnedAt: z.string().nullable(),
  projectPath: z.string(),
  title: z.string(),
  updatedAt: z.string()
})

export const ChatSessionsListOutputSchema = z.array(ChatSessionSummarySchema)

export const CreateChatSessionInputSchema = z.object({
  currentSessionId: z.string().optional()
})

export const OpenChatSessionInputSchema = z.object({
  sessionId: z.string()
})

export const SetPinnedChatSessionInputSchema = z.object({
  pinned: z.boolean(),
  sessionId: z.string()
})

export type ChatSessionSummary = z.infer<typeof ChatSessionSummarySchema>
export type CreateChatSessionInput = z.infer<
  typeof CreateChatSessionInputSchema
>
export type OpenChatSessionInput = z.infer<typeof OpenChatSessionInputSchema>
export type SetPinnedChatSessionInput = z.infer<
  typeof SetPinnedChatSessionInputSchema
>
