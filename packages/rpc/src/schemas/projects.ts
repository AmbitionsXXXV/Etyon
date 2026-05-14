import * as z from "zod"

export const ArchiveProjectChatsInputSchema = z.object({
  projectPath: z.string().min(1)
})

export const RemoveProjectInputSchema = z.object({
  projectPath: z.string().min(1)
})

export const RenameProjectInputSchema = z.object({
  displayName: z.string().max(120),
  projectPath: z.string().min(1)
})

export const SetProjectPinnedInputSchema = z.object({
  pinned: z.boolean(),
  projectPath: z.string().min(1)
})

export type ArchiveProjectChatsInput = z.infer<
  typeof ArchiveProjectChatsInputSchema
>
export type RemoveProjectInput = z.infer<typeof RemoveProjectInputSchema>
export type RenameProjectInput = z.infer<typeof RenameProjectInputSchema>
export type SetProjectPinnedInput = z.infer<typeof SetProjectPinnedInputSchema>
