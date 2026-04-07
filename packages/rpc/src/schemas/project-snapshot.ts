import * as z from "zod"

export const ProjectSnapshotDocumentSchema = z.object({
  chunkCount: z.number().int().nonnegative(),
  embeddingRef: z.string().optional(),
  embeddingState: z.string().optional(),
  language: z.string().nullable(),
  mtimeMs: z.number().nonnegative(),
  path: z.string(),
  preview: z.string(),
  relativePath: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative()
})

export const ProjectSnapshotFileItemSchema = z.object({
  language: z.string().nullable(),
  mtimeMs: z.number().nonnegative(),
  path: z.string(),
  relativePath: z.string(),
  size: z.number().int().nonnegative(),
  snapshotId: z.string()
})

export const ProjectSnapshotStateSchema = z.object({
  projectPath: z.string(),
  refreshedAt: z.string(),
  snapshotId: z.string()
})

export const EnsureProjectSnapshotInputSchema = z.object({
  sessionId: z.string()
})

export const ListProjectSnapshotFilesInputSchema = z.object({
  query: z.string().default(""),
  sessionId: z.string()
})

export const ListProjectSnapshotFilesOutputSchema = z.object({
  files: z.array(ProjectSnapshotFileItemSchema),
  snapshotId: z.string()
})

export type EnsureProjectSnapshotInput = z.infer<
  typeof EnsureProjectSnapshotInputSchema
>
export type ListProjectSnapshotFilesInput = z.infer<
  typeof ListProjectSnapshotFilesInputSchema
>
export type ListProjectSnapshotFilesOutput = z.infer<
  typeof ListProjectSnapshotFilesOutputSchema
>
export type ProjectSnapshotDocument = z.infer<
  typeof ProjectSnapshotDocumentSchema
>
export type ProjectSnapshotFileItem = z.infer<
  typeof ProjectSnapshotFileItemSchema
>
export type ProjectSnapshotState = z.infer<typeof ProjectSnapshotStateSchema>
