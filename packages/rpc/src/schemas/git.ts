import * as z from "zod"

export const GitFileStatusSchema = z.enum([
  "added",
  "deleted",
  "ignored",
  "modified",
  "renamed",
  "untracked"
])

export const GitStatusFileSchema = z.object({
  path: z.string(),
  status: GitFileStatusSchema
})

export const GitProjectStatusSchema = z.object({
  added: z.number().int().nonnegative(),
  changedFileCount: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  error: z.string().optional(),
  files: z.array(GitStatusFileSchema),
  isRepository: z.boolean(),
  modified: z.number().int().nonnegative(),
  projectPath: z.string(),
  renamed: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative()
})

export const GitProjectDiffInputSchema = z.object({
  sessionId: z.string()
})

export const GitProjectDiffFileSnapshotSchema = z.object({
  newContent: z.string(),
  oldContent: z.string(),
  oldPath: z.string().optional(),
  path: z.string(),
  stage: z.enum(["staged", "unstaged"])
})

export const GitProjectDiffOutputSchema = z.object({
  fileSnapshots: z.array(GitProjectDiffFileSnapshotSchema),
  hasPatch: z.boolean(),
  patch: z.string(),
  projectPath: z.string(),
  truncated: z.boolean()
})

export type GitFileStatus = z.infer<typeof GitFileStatusSchema>
export type GitProjectDiffFileSnapshot = z.infer<
  typeof GitProjectDiffFileSnapshotSchema
>
export type GitProjectDiffInput = z.infer<typeof GitProjectDiffInputSchema>
export type GitProjectDiffOutput = z.infer<typeof GitProjectDiffOutputSchema>
export type GitProjectStatus = z.infer<typeof GitProjectStatusSchema>
export type GitStatusFile = z.infer<typeof GitStatusFileSchema>
