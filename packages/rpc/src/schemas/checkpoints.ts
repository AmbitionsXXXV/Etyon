import * as z from "zod"

const CHECKPOINT_LIST_MAX_LIMIT = 1000

export const CheckpointOriginSchema = z.enum(["bash", "edit", "write"])

export const CheckpointFileSchema = z.object({
  mode: z.number().int().optional(),
  overCap: z.literal(true).optional(),
  path: z.string(),
  preSha: z.string().nullable()
})

export const AgentCheckpointSchema = z.object({
  createdAt: z.string(),
  files: z.array(CheckpointFileSchema),
  gitSnapshotRef: z.string().nullable(),
  id: z.string(),
  origin: CheckpointOriginSchema,
  parentId: z.string().nullable(),
  projectHash: z.string(),
  runId: z.string(),
  toolCallId: z.string()
})

export const ListCheckpointsInputSchema = z.object({
  limit: z.number().int().positive().max(CHECKPOINT_LIST_MAX_LIMIT).optional(),
  sessionId: z.string().min(1)
})

export const ListCheckpointsOutputSchema = z.object({
  checkpoints: z.array(AgentCheckpointSchema)
})

export const RestoreCheckpointInputSchema = z.object({
  checkpointId: z.string().min(1),
  sessionId: z.string().min(1)
})

export const RestoreCheckpointOutputSchema = z.object({
  missingBlobs: z.array(z.string()),
  restored: z.array(z.string()),
  skipped: z.array(z.string())
})

export type AgentCheckpoint = z.infer<typeof AgentCheckpointSchema>
export type CheckpointFile = z.infer<typeof CheckpointFileSchema>
export type CheckpointOrigin = z.infer<typeof CheckpointOriginSchema>
export type ListCheckpointsInput = z.infer<typeof ListCheckpointsInputSchema>
export type ListCheckpointsOutput = z.infer<typeof ListCheckpointsOutputSchema>
export type RestoreCheckpointInput = z.infer<
  typeof RestoreCheckpointInputSchema
>
export type RestoreCheckpointOutput = z.infer<
  typeof RestoreCheckpointOutputSchema
>
