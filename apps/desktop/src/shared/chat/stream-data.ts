export const CHAT_REQUEST_PHASE_DATA_NAME = "chat-request-phase" as const

export type ChatRequestPhase = "agent-turn" | "memory-loading" | "model-start"

export interface ChatRequestPhaseData {
  phase: ChatRequestPhase
}

export type ChatStreamDataTypes = {
  [CHAT_REQUEST_PHASE_DATA_NAME]: ChatRequestPhaseData
} & Record<string, unknown>

export const CHAT_REQUEST_PHASE_DATA_TYPE =
  `data-${CHAT_REQUEST_PHASE_DATA_NAME}` as const

export const isChatRequestPhaseDataPart = (part: {
  data: unknown
  type: string
}): part is {
  data: ChatRequestPhaseData
  type: typeof CHAT_REQUEST_PHASE_DATA_TYPE
} => part.type === CHAT_REQUEST_PHASE_DATA_TYPE
