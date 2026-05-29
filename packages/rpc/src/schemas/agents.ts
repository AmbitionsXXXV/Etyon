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

export const AgentRunTraceArtifactSchema = z.object({
  byteLength: z.number().nullable(),
  createdAt: z.string(),
  id: z.string(),
  kind: z.string(),
  metadata: z.unknown(),
  path: z.string(),
  runId: z.string(),
  toolCallId: z.string().nullable()
})

export const InspectAgentRunInputSchema = z.object({
  runId: z.string(),
  sessionId: z.string().optional()
})

export const InspectAgentRunOutputSchema = z.object({
  artifacts: z.array(AgentRunTraceArtifactSchema),
  events: z.array(AgentRunTraceEventSchema),
  run: AgentRunTraceRunSchema,
  toolCalls: z.array(AgentRunTraceToolCallSchema)
})

export const AgentSessionTreeEntryTypeSchema = z.enum([
  "branch_summary",
  "compaction_summary",
  "custom_message",
  "leaf",
  "message"
])

export const AgentSessionTreeEntrySchema = z.object({
  id: z.string(),
  message: z.unknown().optional(),
  parentId: z.string().nullable(),
  sequence: z.number().int().min(1),
  summary: z.string().optional(),
  targetEntryId: z.string().nullable().optional(),
  type: AgentSessionTreeEntryTypeSchema
})

export const InspectAgentSessionInputSchema = z.object({
  runId: z.string().optional(),
  sessionId: z.string()
})

export const AgentSessionSnapshotOutputSchema = z.object({
  context: z.array(z.unknown()),
  entries: z.array(AgentSessionTreeEntrySchema),
  events: z.array(AgentRunTraceEventSchema),
  run: AgentRunTraceRunSchema.nullable()
})

export const MoveAgentSessionLeafInputSchema = z.object({
  branchSummary: z.string().trim().min(1).optional(),
  entryId: z.string().nullable(),
  runId: z.string().optional(),
  sessionId: z.string()
})

export const AppendAgentSessionCompactionSummaryInputSchema = z.object({
  runId: z.string().optional(),
  sessionId: z.string(),
  summary: z.string().trim().min(1)
})

export const ReadAgentArtifactInputSchema = z.object({
  artifactId: z.string(),
  maxChars: z.number().int().min(1).max(100_000).optional(),
  sessionId: z.string().optional()
})

export const ReadAgentArtifactOutputSchema = z.object({
  artifact: AgentRunTraceArtifactSchema,
  content: z.string(),
  omittedChars: z.number().int().min(0),
  totalChars: z.number().int().min(0),
  truncated: z.boolean()
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

export const ListAgentRunsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  sessionId: z.string().optional()
})

export const AgentRunsOutputSchema = z.object({
  runs: z.array(AgentRunTraceRunSchema)
})

export const ListRecoverableAgentRunsInputSchema = z.object({
  sessionId: z.string().optional()
})

export const RecoverableAgentRunsOutputSchema = z.object({
  runs: z.array(AgentRunTraceRunSchema)
})

export const AgentRunGraphTemplateIdSchema = z.enum([
  "harness-debug",
  "investigation",
  "plan-execute-review",
  "solo-coder"
])

export const AgentRunGraphTemplateNodeRoleSchema = z.enum([
  "execute",
  "explore",
  "final",
  "inspect",
  "plan",
  "review",
  "synthesize"
])

export const AgentRunGraphTemplateToolScopeSchema = z.enum([
  "approval-gated",
  "profile-default",
  "read-only"
])

export const AgentRunGraphExecutionNodeStatusSchema = z.enum([
  "failed",
  "pending",
  "running",
  "skipped",
  "succeeded",
  "suspended"
])

export const AgentRunGraphTemplateNodeSchema = z.object({
  dependsOn: z.array(z.string()),
  id: z.string(),
  label: z.string(),
  outputContract: z.string(),
  parallelGroup: z.string().optional(),
  profileId: z.string(),
  role: AgentRunGraphTemplateNodeRoleSchema,
  toolScope: AgentRunGraphTemplateToolScopeSchema
})

export const AgentRunGraphTemplateSchema = z.object({
  description: z.string(),
  id: AgentRunGraphTemplateIdSchema,
  name: z.string(),
  nodes: z.array(AgentRunGraphTemplateNodeSchema)
})

export const AgentRunGraphExecutionNodeSchema =
  AgentRunGraphTemplateNodeSchema.extend({
    activeToolNames: z.array(z.string()),
    attempt: z.number().int().min(0),
    childRunId: z.string().optional(),
    errorMessage: z.string().optional(),
    lastOutput: z.string().optional(),
    stage: z.number().int().min(0),
    status: AgentRunGraphExecutionNodeStatusSchema
  })

export const AgentRunGraphExecutionStageSchema = z.object({
  id: z.string(),
  index: z.number().int().min(0),
  nodeIds: z.array(z.string()),
  parallel: z.boolean()
})

export const AgentRunGraphExecutionPlanSchema =
  AgentRunGraphTemplateSchema.extend({
    nodes: z.array(AgentRunGraphExecutionNodeSchema),
    stages: z.array(AgentRunGraphExecutionStageSchema),
    task: z.string().optional()
  })

export const ListAgentRunGraphTemplatesOutputSchema = z.object({
  templates: z.array(AgentRunGraphTemplateSchema)
})

export const PreviewAgentRunGraphTemplateInputSchema = z.object({
  templateId: AgentRunGraphTemplateIdSchema
})

export const PreviewAgentRunGraphTemplateOutputSchema = z.object({
  plan: AgentRunGraphExecutionPlanSchema
})

export const InstantiateAgentRunGraphTemplateInputSchema = z.object({
  modelId: z.string().trim().min(1).nullable().optional(),
  sessionId: z.string(),
  task: z.string().trim().min(1).optional(),
  templateId: AgentRunGraphTemplateIdSchema
})

export const InstantiateAgentRunGraphTemplateOutputSchema = z.object({
  plan: AgentRunGraphExecutionPlanSchema,
  run: AgentRunTraceRunSchema
})

export const StartAgentRunGraphNextStageInputSchema = z.object({
  runId: z.string(),
  sessionId: z.string().optional()
})

export const StartAgentRunGraphNextStageOutputSchema = z.object({
  plan: AgentRunGraphExecutionPlanSchema,
  run: AgentRunTraceRunSchema,
  stage: AgentRunGraphExecutionStageSchema.nullable(),
  startedNodeIds: z.array(z.string()),
  startedRuns: z.array(AgentRunTraceRunSchema)
})

export const AdvanceAgentRunGraphInputSchema = z.object({
  runId: z.string(),
  sessionId: z.string().optional()
})

export const AdvanceAgentRunGraphOutputSchema =
  StartAgentRunGraphNextStageOutputSchema.extend({
    settledNodeIds: z.array(z.string())
  })

export const RetryAgentRunGraphNodeInputSchema = z.object({
  nodeId: z.string(),
  runId: z.string(),
  sessionId: z.string().optional()
})

export const RetryAgentRunGraphNodeOutputSchema =
  StartAgentRunGraphNextStageOutputSchema.extend({
    retriedNodeId: z.string()
  })

export const RespondAgentRunGraphApprovalInputSchema = z.object({
  approvalId: z.string().trim().min(1),
  approved: z.boolean(),
  reason: z.string().trim().min(1).optional(),
  rootRunId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  toolCallId: z.string().trim().min(1)
})

export const RespondAgentRunGraphApprovalOutputSchema =
  AdvanceAgentRunGraphOutputSchema.extend({
    childRun: AgentRunTraceRunSchema,
    nodeId: z.string(),
    stopReason: z.string(),
    turns: z.number().int().min(0)
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
export type AgentSessionSnapshotOutput = z.infer<
  typeof AgentSessionSnapshotOutputSchema
>
export type AgentSessionTreeEntry = z.infer<typeof AgentSessionTreeEntrySchema>
export type AgentSessionTreeEntryType = z.infer<
  typeof AgentSessionTreeEntryTypeSchema
>
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>
export type AgentRunTraceArtifact = z.infer<typeof AgentRunTraceArtifactSchema>
export type AgentRunTraceEvent = z.infer<typeof AgentRunTraceEventSchema>
export type AgentRunTraceRun = z.infer<typeof AgentRunTraceRunSchema>
export type AgentRunTraceToolCall = z.infer<typeof AgentRunTraceToolCallSchema>
export type AgentRunsOutput = z.infer<typeof AgentRunsOutputSchema>
export type AgentToolApprovalState = z.infer<
  typeof AgentToolApprovalStateSchema
>
export type AgentToolCallState = z.infer<typeof AgentToolCallStateSchema>
export type AdvanceAgentRunGraphInput = z.infer<
  typeof AdvanceAgentRunGraphInputSchema
>
export type AdvanceAgentRunGraphOutput = z.infer<
  typeof AdvanceAgentRunGraphOutputSchema
>
export type AppendAgentSessionCompactionSummaryInput = z.infer<
  typeof AppendAgentSessionCompactionSummaryInputSchema
>
export type RetryAgentRunGraphNodeInput = z.infer<
  typeof RetryAgentRunGraphNodeInputSchema
>
export type RetryAgentRunGraphNodeOutput = z.infer<
  typeof RetryAgentRunGraphNodeOutputSchema
>
export type RespondAgentRunGraphApprovalInput = z.infer<
  typeof RespondAgentRunGraphApprovalInputSchema
>
export type RespondAgentRunGraphApprovalOutput = z.infer<
  typeof RespondAgentRunGraphApprovalOutputSchema
>
export type AgentRunGraphExecutionNode = z.infer<
  typeof AgentRunGraphExecutionNodeSchema
>
export type AgentRunGraphExecutionNodeStatus = z.infer<
  typeof AgentRunGraphExecutionNodeStatusSchema
>
export type AgentRunGraphExecutionPlan = z.infer<
  typeof AgentRunGraphExecutionPlanSchema
>
export type AgentRunGraphExecutionStage = z.infer<
  typeof AgentRunGraphExecutionStageSchema
>
export type AgentRunGraphTemplate = z.infer<typeof AgentRunGraphTemplateSchema>
export type AgentRunGraphTemplateId = z.infer<
  typeof AgentRunGraphTemplateIdSchema
>
export type AgentRunGraphTemplateNode = z.infer<
  typeof AgentRunGraphTemplateNodeSchema
>
export type AgentRunGraphTemplateNodeRole = z.infer<
  typeof AgentRunGraphTemplateNodeRoleSchema
>
export type AgentRunGraphTemplateToolScope = z.infer<
  typeof AgentRunGraphTemplateToolScopeSchema
>
export type InspectAgentRunInput = z.infer<typeof InspectAgentRunInputSchema>
export type InspectAgentRunOutput = z.infer<typeof InspectAgentRunOutputSchema>
export type InspectAgentSessionInput = z.infer<
  typeof InspectAgentSessionInputSchema
>
export type InstantiateAgentRunGraphTemplateInput = z.infer<
  typeof InstantiateAgentRunGraphTemplateInputSchema
>
export type InstantiateAgentRunGraphTemplateOutput = z.infer<
  typeof InstantiateAgentRunGraphTemplateOutputSchema
>
export type ListAgentRunGraphTemplatesOutput = z.infer<
  typeof ListAgentRunGraphTemplatesOutputSchema
>
export type ListAgentRunsInput = z.infer<typeof ListAgentRunsInputSchema>
export type ListPendingAgentApprovalsInput = z.infer<
  typeof ListPendingAgentApprovalsInputSchema
>
export type ListQueuedAgentMessagesInput = z.infer<
  typeof ListQueuedAgentMessagesInputSchema
>
export type ListRecoverableAgentRunsInput = z.infer<
  typeof ListRecoverableAgentRunsInputSchema
>
export type MoveAgentSessionLeafInput = z.infer<
  typeof MoveAgentSessionLeafInputSchema
>
export type PendingAgentApproval = z.infer<typeof PendingAgentApprovalSchema>
export type PendingAgentApprovalsOutput = z.infer<
  typeof PendingAgentApprovalsOutputSchema
>
export type PreviewAgentRunGraphTemplateInput = z.infer<
  typeof PreviewAgentRunGraphTemplateInputSchema
>
export type PreviewAgentRunGraphTemplateOutput = z.infer<
  typeof PreviewAgentRunGraphTemplateOutputSchema
>
export type ReadAgentArtifactInput = z.infer<
  typeof ReadAgentArtifactInputSchema
>
export type ReadAgentArtifactOutput = z.infer<
  typeof ReadAgentArtifactOutputSchema
>
export type StartAgentRunGraphNextStageInput = z.infer<
  typeof StartAgentRunGraphNextStageInputSchema
>
export type StartAgentRunGraphNextStageOutput = z.infer<
  typeof StartAgentRunGraphNextStageOutputSchema
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
