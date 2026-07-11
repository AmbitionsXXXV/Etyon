export const CHAT_REQUEST_PHASE_DATA_NAME = "chat-request-phase" as const

export type ChatRequestPhase = "agent-turn" | "memory-loading" | "model-start"

export interface ChatRequestPhaseData {
  phase: ChatRequestPhase
}

export const CHAT_RUN_LIMIT_DATA_NAME = "run-limit" as const

/** Persisted marker the agent loop writes when a run hits the step limit. */
export interface ChatRunLimitData {
  maxSteps: number
}

export const CHAT_WORKFLOW_PROGRESS_DATA_NAME = "workflow-progress" as const

/**
 * Transient (non-persisted) progress the `workflow` tool streams while running.
 * The part `id` is the workflow tool call id, so the tool card can match it.
 */
export interface ChatWorkflowProgressData {
  agentCount: number
  agentsDone: number
  agentsStarted: number
  phase?: string
}

export const CHAT_SUBAGENT_START_DATA_NAME = "subagent-start" as const

/**
 * Transient marker a delegated child run emits as it starts, so the renderer can
 * open a nested live row. The part `id` is the child run id; `parentToolCallId`
 * is the delegate/workflow tool call the child hangs under.
 */
export interface ChatSubagentStartData {
  childRunId: string
  parentToolCallId?: string
  profileId: string
  task: string
}

export const CHAT_SUBAGENT_CHUNK_DATA_NAME = "subagent-chunk" as const

/**
 * One forwarded chunk of a child's `toUIMessageStream()`. Carried untyped
 * (`unknown`) so the shared layer never depends on the ai `UIMessageChunk`
 * generic; the renderer's reducer narrows it. Written WITHOUT an `id` so the SDK
 * cannot reconcile (and thus drop) successive chunks into a single data part.
 */
export interface ChatSubagentChunkData {
  childRunId: string
  chunk: unknown
}

export const CHAT_SUBAGENT_APPROVAL_DATA_NAME = "subagent-approval" as const

/**
 * A writable child's edit/write/bash call awaiting the user's decision. Written
 * WITH `id === approvalId` so the follow-up part carrying `resolved` reconciles
 * over the pending one — the renderer's store adds the buttons on the first write
 * and drops them on the resolved write. `commandOrPath` is a truncated preview;
 * `dangerous` gates the destructive-command styling and `canRemember` the
 * "approve and remember" affordance (bash, non-destructive only).
 */
export interface ChatSubagentApprovalData {
  approvalId: string
  canRemember: boolean
  childRunId: string
  commandOrPath: string
  dangerous: boolean
  resolved?: "approved" | "denied"
  toolName: string
}

export const CHAT_SUBAGENT_END_DATA_NAME = "subagent-end" as const

export type ChatSubagentEndState = "aborted" | "failed" | "succeeded"

/**
 * Transient marker a delegated child run emits when it settles (including
 * failure/abort). The part `id` is `${childRunId}:end`.
 */
export interface ChatSubagentEndData {
  childRunId: string
  durationMs: number
  errorMessage?: string
  state: ChatSubagentEndState
}

export type ChatStreamDataTypes = Record<
  typeof CHAT_REQUEST_PHASE_DATA_NAME,
  ChatRequestPhaseData
> &
  Record<typeof CHAT_RUN_LIMIT_DATA_NAME, ChatRunLimitData> &
  Record<typeof CHAT_WORKFLOW_PROGRESS_DATA_NAME, ChatWorkflowProgressData> &
  Record<typeof CHAT_SUBAGENT_START_DATA_NAME, ChatSubagentStartData> &
  Record<typeof CHAT_SUBAGENT_CHUNK_DATA_NAME, ChatSubagentChunkData> &
  Record<typeof CHAT_SUBAGENT_APPROVAL_DATA_NAME, ChatSubagentApprovalData> &
  Record<typeof CHAT_SUBAGENT_END_DATA_NAME, ChatSubagentEndData>

export const CHAT_REQUEST_PHASE_DATA_TYPE =
  `data-${CHAT_REQUEST_PHASE_DATA_NAME}` as const

export const CHAT_RUN_LIMIT_DATA_TYPE =
  `data-${CHAT_RUN_LIMIT_DATA_NAME}` as const

export const CHAT_WORKFLOW_PROGRESS_DATA_TYPE =
  `data-${CHAT_WORKFLOW_PROGRESS_DATA_NAME}` as const

export const CHAT_SUBAGENT_START_DATA_TYPE =
  `data-${CHAT_SUBAGENT_START_DATA_NAME}` as const

export const CHAT_SUBAGENT_CHUNK_DATA_TYPE =
  `data-${CHAT_SUBAGENT_CHUNK_DATA_NAME}` as const

export const CHAT_SUBAGENT_APPROVAL_DATA_TYPE =
  `data-${CHAT_SUBAGENT_APPROVAL_DATA_NAME}` as const

export const CHAT_SUBAGENT_END_DATA_TYPE =
  `data-${CHAT_SUBAGENT_END_DATA_NAME}` as const

export const isChatRequestPhaseDataPart = (part: {
  data: unknown
  type: string
}): part is {
  data: ChatRequestPhaseData
  type: typeof CHAT_REQUEST_PHASE_DATA_TYPE
} => part.type === CHAT_REQUEST_PHASE_DATA_TYPE

export const isChatRunLimitDataPart = (part: {
  type: string
}): part is {
  data: ChatRunLimitData
  type: typeof CHAT_RUN_LIMIT_DATA_TYPE
} => part.type === CHAT_RUN_LIMIT_DATA_TYPE

export const isChatWorkflowProgressDataPart = (part: {
  data: unknown
  id?: string
  type: string
}): part is {
  data: ChatWorkflowProgressData
  id: string
  type: typeof CHAT_WORKFLOW_PROGRESS_DATA_TYPE
} =>
  part.type === CHAT_WORKFLOW_PROGRESS_DATA_TYPE && typeof part.id === "string"

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const isChatSubagentStartDataPart = (part: {
  data: unknown
  type: string
}): part is {
  data: ChatSubagentStartData
  type: typeof CHAT_SUBAGENT_START_DATA_TYPE
} =>
  part.type === CHAT_SUBAGENT_START_DATA_TYPE &&
  isRecordValue(part.data) &&
  typeof part.data.childRunId === "string"

export const isChatSubagentChunkDataPart = (part: {
  data: unknown
  type: string
}): part is {
  data: ChatSubagentChunkData
  type: typeof CHAT_SUBAGENT_CHUNK_DATA_TYPE
} =>
  part.type === CHAT_SUBAGENT_CHUNK_DATA_TYPE &&
  isRecordValue(part.data) &&
  typeof part.data.childRunId === "string"

export const isChatSubagentApprovalDataPart = (part: {
  data: unknown
  type: string
}): part is {
  data: ChatSubagentApprovalData
  type: typeof CHAT_SUBAGENT_APPROVAL_DATA_TYPE
} =>
  part.type === CHAT_SUBAGENT_APPROVAL_DATA_TYPE &&
  isRecordValue(part.data) &&
  typeof part.data.approvalId === "string" &&
  typeof part.data.childRunId === "string"

export const isChatSubagentEndDataPart = (part: {
  data: unknown
  type: string
}): part is {
  data: ChatSubagentEndData
  type: typeof CHAT_SUBAGENT_END_DATA_TYPE
} =>
  part.type === CHAT_SUBAGENT_END_DATA_TYPE &&
  isRecordValue(part.data) &&
  typeof part.data.childRunId === "string"
