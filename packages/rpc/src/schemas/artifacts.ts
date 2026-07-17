import * as z from "zod"

export const ArtifactReadErrorReasonSchema = z.enum([
  "binary-file",
  "file-missing",
  "io-error",
  "not-file",
  "outside-project",
  "too-large"
])

export const ReadArtifactFileInputSchema = z.object({
  filePath: z.string().min(1),
  sessionId: z.string().min(1),
  toolCallId: z.string().optional()
})

export const ReadArtifactFileOutputSchema = z.discriminatedUnion("status", [
  z.object({
    content: z.string(),
    language: z.string().nullable(),
    relativePath: z.string(),
    restoredFromSnapshot: z.boolean(),
    status: z.literal("ok"),
    workspaceRecreated: z.boolean()
  }),
  z.object({
    reason: ArtifactReadErrorReasonSchema,
    status: z.literal("error"),
    workspaceRecreated: z.boolean()
  })
])

export type ArtifactReadErrorReason = z.infer<
  typeof ArtifactReadErrorReasonSchema
>
export type ReadArtifactFileInput = z.infer<typeof ReadArtifactFileInputSchema>
export type ReadArtifactFileOutput = z.infer<
  typeof ReadArtifactFileOutputSchema
>
