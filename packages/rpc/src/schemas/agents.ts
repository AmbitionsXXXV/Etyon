import * as z from "zod"

export const AgentRunStatusSchema = z.enum([
  "failed",
  "running",
  "succeeded",
  "suspended"
])

export const AgentToolApprovalStateSchema = z.enum([
  "approved",
  "denied",
  "not_required",
  "pending"
])

export const AgentToolCallStateSchema = z.enum([
  "approval_requested",
  "failed",
  "finished",
  "requested",
  "running"
])

export const AgentRunTraceEventSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  payload: z.unknown(),
  runId: z.string(),
  sequence: z.number(),
  type: z.string()
})

export const AgentRunTraceRunSchema = z.object({
  chatSessionId: z.string(),
  errorMessage: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.string(),
  modelId: z.string().nullable(),
  parentRunId: z.string().nullable(),
  profileId: z.string(),
  startedAt: z.string(),
  status: AgentRunStatusSchema
})

export const AgentRunTraceToolCallSchema = z.object({
  approvalState: AgentToolApprovalStateSchema,
  errorMessage: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  parentToolCallId: z.string().nullable(),
  runId: z.string(),
  startedAt: z.string(),
  state: AgentToolCallStateSchema,
  toolName: z.string()
})

export const InspectAgentRunInputSchema = z.object({
  runId: z.string(),
  sessionId: z.string().optional()
})

export const InspectAgentRunOutputSchema = z.object({
  events: z.array(AgentRunTraceEventSchema),
  run: AgentRunTraceRunSchema,
  toolCalls: z.array(AgentRunTraceToolCallSchema)
})

export const PendingAgentApprovalSchema = z.object({
  approvalId: z.string().nullable(),
  approvalState: AgentToolApprovalStateSchema,
  chatSessionId: z.string(),
  errorMessage: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  parentToolCallId: z.string().nullable(),
  profileId: z.string(),
  runId: z.string(),
  runStatus: AgentRunStatusSchema,
  startedAt: z.string(),
  state: AgentToolCallStateSchema,
  toolName: z.string()
})

export const ListPendingAgentApprovalsInputSchema = z.object({
  sessionId: z.string().optional()
})

export const PendingAgentApprovalsOutputSchema = z.object({
  approvals: z.array(PendingAgentApprovalSchema)
})

export const ListRecoverableAgentRunsInputSchema = z.object({
  sessionId: z.string().optional()
})

export const RecoverableAgentRunsOutputSchema = z.object({
  runs: z.array(AgentRunTraceRunSchema)
})

export const AgentSessionQueuedMessageQueueSchema = z.enum([
  "follow-up",
  "steer"
])

export const AgentSessionQueuedMessageSchema = z.object({
  chatSessionId: z.string(),
  content: z.string(),
  createdAt: z.string(),
  id: z.string(),
  queue: AgentSessionQueuedMessageQueueSchema,
  runId: z.string()
})

export const ListQueuedAgentMessagesInputSchema = z.object({
  sessionId: z.string()
})

export const QueuedAgentMessagesOutputSchema = z.object({
  messages: z.array(AgentSessionQueuedMessageSchema)
})

export const QueueAgentMessageInputSchema = z.object({
  content: z.string().trim().min(1),
  queue: AgentSessionQueuedMessageQueueSchema.default("steer"),
  sessionId: z.string()
})

export const QueueAgentMessageOutputSchema = z.object({
  message: AgentSessionQueuedMessageSchema
})

export const UpdateQueuedAgentMessageInputSchema = z
  .object({
    content: z.string().trim().min(1).optional(),
    id: z.string(),
    queue: AgentSessionQueuedMessageQueueSchema.optional(),
    sessionId: z.string()
  })
  .refine((input) => input.content !== undefined || input.queue !== undefined, {
    message: "Expected content or queue to update."
  })

export const RemoveQueuedAgentMessageInputSchema = z.object({
  id: z.string(),
  sessionId: z.string()
})

export const ReorderQueuedAgentMessagesInputSchema = z.object({
  ids: z.array(z.string()),
  sessionId: z.string()
})

export type AgentSessionQueuedMessage = z.infer<
  typeof AgentSessionQueuedMessageSchema
>
export type AgentSessionQueuedMessageQueue = z.infer<
  typeof AgentSessionQueuedMessageQueueSchema
>
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>
export type AgentRunTraceEvent = z.infer<typeof AgentRunTraceEventSchema>
export type AgentRunTraceRun = z.infer<typeof AgentRunTraceRunSchema>
export type AgentRunTraceToolCall = z.infer<typeof AgentRunTraceToolCallSchema>
export type AgentToolApprovalState = z.infer<
  typeof AgentToolApprovalStateSchema
>
export type AgentToolCallState = z.infer<typeof AgentToolCallStateSchema>
export type InspectAgentRunInput = z.infer<typeof InspectAgentRunInputSchema>
export type InspectAgentRunOutput = z.infer<typeof InspectAgentRunOutputSchema>
export type ListPendingAgentApprovalsInput = z.infer<
  typeof ListPendingAgentApprovalsInputSchema
>
export type ListQueuedAgentMessagesInput = z.infer<
  typeof ListQueuedAgentMessagesInputSchema
>
export type ListRecoverableAgentRunsInput = z.infer<
  typeof ListRecoverableAgentRunsInputSchema
>
export type PendingAgentApproval = z.infer<typeof PendingAgentApprovalSchema>
export type PendingAgentApprovalsOutput = z.infer<
  typeof PendingAgentApprovalsOutputSchema
>
export type QueuedAgentMessagesOutput = z.infer<
  typeof QueuedAgentMessagesOutputSchema
>
export type QueueAgentMessageInput = z.infer<
  typeof QueueAgentMessageInputSchema
>
export type QueueAgentMessageOutput = z.infer<
  typeof QueueAgentMessageOutputSchema
>
export type RemoveQueuedAgentMessageInput = z.infer<
  typeof RemoveQueuedAgentMessageInputSchema
>
export type ReorderQueuedAgentMessagesInput = z.infer<
  typeof ReorderQueuedAgentMessagesInputSchema
>
export type RecoverableAgentRunsOutput = z.infer<
  typeof RecoverableAgentRunsOutputSchema
>
export type UpdateQueuedAgentMessageInput = z.infer<
  typeof UpdateQueuedAgentMessageInputSchema
>
