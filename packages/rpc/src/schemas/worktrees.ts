import * as z from "zod"

export const ManagedWorktreeSchema = z
  .object({
    baseCommit: z.string(),
    createdAt: z.string(),
    directory: z.string(),
    id: z.string().uuid(),
    label: z.string(),
    projectPath: z.string(),
    repositoryRoot: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    state: z.enum(["running", "ready", "applied", "orphaned"]),
    workspacePath: z.string()
  })
  .strict()

export const WorktreeDiffSchema = z.object({
  additions: z.number().int().nonnegative(),
  conflicts: z.array(z.string()),
  deletions: z.number().int().nonnegative(),
  fingerprint: z.string(),
  patch: z.string(),
  paths: z.array(z.string()),
  worktree: ManagedWorktreeSchema
})

export const WorktreeSessionInputSchema = z.object({
  sessionId: z.string().min(1)
})
export const WorktreeIdInputSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().min(1)
})
export const ListWorktreesOutputSchema = z.object({
  worktrees: z.array(ManagedWorktreeSchema)
})
export const ApplyWorktreeInputSchema = WorktreeIdInputSchema.extend({
  expectedFingerprint: z.string().min(1)
})
export const ApplyWorktreeOutputSchema = z.object({
  appliedPaths: z.array(z.string()),
  conflicts: z.array(z.string()),
  error: z.string().optional(),
  ok: z.boolean(),
  rollbackSnapshotPath: z.string().optional()
})
export const PruneWorktreeInputSchema = WorktreeIdInputSchema.extend({
  discardChanges: z.boolean().default(false)
})

export const BestOfNCandidateSchema = z.object({
  error: z.string().optional(),
  id: z.string().uuid(),
  modelId: z.string(),
  profileId: z.string().optional(),
  state: z.enum([
    "pending",
    "running",
    "ready",
    "failed",
    "applied",
    "discarded"
  ]),
  stats: z
    .object({
      additions: z.number().int().nonnegative(),
      changedFileCount: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative()
    })
    .optional(),
  summary: z.string(),
  worktreeId: z.string().uuid().optional()
})
export const BestOfNReviewSchema = z.object({
  recommendation: z.string(),
  recommendedCandidateId: z.string().nullable()
})
export const BestOfNRunSchema = z
  .object({
    candidates: z.array(BestOfNCandidateSchema),
    createdAt: z.string(),
    id: z.string().uuid(),
    prompt: z.string(),
    review: BestOfNReviewSchema.nullable(),
    runId: z.string(),
    selectedCandidateId: z.string().uuid().optional(),
    sessionId: z.string(),
    state: z.enum([
      "running",
      "ready",
      "failed",
      "applying",
      "applied",
      "cancelled"
    ])
  })
  .strict()
export const StartBestOfNInputSchema = z.object({
  models: z
    .array(
      z.object({ modelId: z.string().min(1), profileId: z.string().optional() })
    )
    .min(2)
    .max(4),
  prompt: z.string().min(1).max(16_000),
  sessionId: z.string().min(1)
})
export const ListBestOfNOutputSchema = z.object({
  runs: z.array(BestOfNRunSchema)
})
export const BestOfNIdInputSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().min(1)
})
export const ApplyBestOfNInputSchema = BestOfNIdInputSchema.extend({
  candidateId: z.string().uuid(),
  expectedFingerprint: z.string().min(1)
})
export type ManagedWorktree = z.infer<typeof ManagedWorktreeSchema>
export type WorktreeDiff = z.infer<typeof WorktreeDiffSchema>
export type ApplyWorktreeOutput = z.infer<typeof ApplyWorktreeOutputSchema>
export type BestOfNCandidate = z.infer<typeof BestOfNCandidateSchema>
export type BestOfNReview = z.infer<typeof BestOfNReviewSchema>
export type BestOfNRun = z.infer<typeof BestOfNRunSchema>
