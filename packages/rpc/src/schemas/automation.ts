import { z } from "zod"

export const AutomationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({
    kind: z.literal("interval"),
    minutes: z.number().int().min(1).max(525_600)
  }),
  z.object({
    expression: z.string().trim().min(1).max(120),
    kind: z.literal("cron"),
    timeZone: z.string().trim().min(1).max(100)
  })
])

export const AutomationTaskDraftSchema = z.object({
  enabled: z.boolean().default(false),
  id: z.string().min(1).max(64).optional(),
  modelId: z.string().trim().max(200).nullable().default(null),
  name: z.string().trim().min(1).max(100),
  notifyDesktop: z.boolean().default(true),
  notifyTelegram: z.boolean().default(false),
  permissionMode: z.enum(["default", "acceptEdits"]).default("default"),
  profileId: z.string().trim().max(64).nullable().default(null),
  prompt: z.string().trim().min(1).max(32_000),
  schedule: AutomationScheduleSchema,
  sessionId: z.string().min(1).max(64),
  timeoutMinutes: z.number().int().min(1).max(1440).default(30)
})

export const AutomationTaskSchema = AutomationTaskDraftSchema.extend({
  createdAt: z.string(),
  id: z.string(),
  nextRunAt: z.string().nullable(),
  updatedAt: z.string()
})

export const AutomationRunStatusSchema = z.enum([
  "cancelled",
  "failed",
  "interrupted",
  "running",
  "skipped",
  "succeeded",
  "suspended"
])

export const AutomationRunSchema = z.object({
  agentRunId: z.string().nullable(),
  error: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.string(),
  notificationError: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  sessionId: z.string(),
  startedAt: z.string(),
  status: AutomationRunStatusSchema,
  summary: z.string().nullable(),
  taskId: z.string(),
  trigger: z.enum(["manual", "scheduled"]),
  updatedAt: z.string()
})

export const AutomationTaskInputSchema = z.object({ taskId: z.string().min(1) })
export const AutomationRunInputSchema = z.object({ runId: z.string().min(1) })
export const AutomationSetEnabledInputSchema = z.object({
  enabled: z.boolean(),
  taskId: z.string().min(1)
})
export const AutomationListRunsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(30),
  taskId: z.string().min(1).optional()
})
export const AutomationListOutputSchema = z.object({
  runs: z.array(AutomationRunSchema),
  tasks: z.array(AutomationTaskSchema)
})
export const AutomationRunsOutputSchema = z.object({
  runs: z.array(AutomationRunSchema)
})
export const AutomationMutationOutputSchema = z.object({ ok: z.boolean() })

export type AutomationSchedule = z.infer<typeof AutomationScheduleSchema>
export type AutomationTask = z.infer<typeof AutomationTaskSchema>
export type AutomationTaskDraft = z.infer<typeof AutomationTaskDraftSchema>
export type AutomationRun = z.infer<typeof AutomationRunSchema>
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>
