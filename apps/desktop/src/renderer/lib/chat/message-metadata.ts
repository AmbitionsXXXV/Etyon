import type { ChatMention } from "@etyon/rpc"

import { isRecord } from "@/renderer/lib/utils"

export { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"

export interface ChatMessageAgentProjectionMetadata {
  runId: string
  source: "agent_events"
}

/** Mirrors the agent loop's `AgentLoopExitReason`, stamped at run finish. */
export type ChatMessageExitReason =
  | "aborted"
  | "completed"
  | "max-steps"
  | "model-error"
  | "suspended"

export interface ChatMessageMetadata {
  agentProjection?: ChatMessageAgentProjectionMetadata
  exitReason?: ChatMessageExitReason
  mentions?: ChatMention[]
  thoughtDurationsMs?: number[]
  workTimeMs?: number
}

const EXIT_REASONS: readonly ChatMessageExitReason[] = [
  "aborted",
  "completed",
  "max-steps",
  "model-error",
  "suspended"
]

const parseExitReason = (value: unknown): ChatMessageExitReason | undefined =>
  EXIT_REASONS.find((reason) => reason === value)

const parseThoughtDurationsMs = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value.filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isFinite(entry) && entry >= 0
  )
}

export const parseChatMessageMetadata = (
  metadata: unknown
): ChatMessageMetadata | undefined => {
  if (!isRecord(metadata)) {
    return undefined
  }

  const workTimeMs =
    typeof metadata.workTimeMs === "number" &&
    Number.isFinite(metadata.workTimeMs) &&
    metadata.workTimeMs >= 0
      ? metadata.workTimeMs
      : undefined
  const agentProjection =
    isRecord(metadata.agentProjection) &&
    metadata.agentProjection.source === "agent_events" &&
    typeof metadata.agentProjection.runId === "string"
      ? {
          runId: metadata.agentProjection.runId,
          source: "agent_events" as const
        }
      : undefined

  return {
    agentProjection,
    exitReason: parseExitReason(metadata.exitReason),
    mentions: Array.isArray(metadata.mentions)
      ? (metadata.mentions as ChatMessageMetadata["mentions"])
      : undefined,
    thoughtDurationsMs: parseThoughtDurationsMs(metadata.thoughtDurationsMs),
    workTimeMs
  }
}

export const formatWorkTime = (workTimeMs: number): string => {
  if (workTimeMs < 1000) {
    return `${workTimeMs} ms`
  }

  return `${(workTimeMs / 1000).toFixed(1)} s`
}
