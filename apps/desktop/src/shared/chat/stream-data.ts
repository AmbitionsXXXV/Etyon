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

export type ChatStreamDataTypes = Record<
  typeof CHAT_REQUEST_PHASE_DATA_NAME,
  ChatRequestPhaseData
> &
  Record<typeof CHAT_RUN_LIMIT_DATA_NAME, ChatRunLimitData>

export const CHAT_REQUEST_PHASE_DATA_TYPE =
  `data-${CHAT_REQUEST_PHASE_DATA_NAME}` as const

export const CHAT_RUN_LIMIT_DATA_TYPE =
  `data-${CHAT_RUN_LIMIT_DATA_NAME}` as const

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
