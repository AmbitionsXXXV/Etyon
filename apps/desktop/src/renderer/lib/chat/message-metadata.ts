import type { ChatMention } from "@etyon/rpc"

import { isRecord } from "@/renderer/lib/utils"

export { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"

export interface ChatMessageAgentProjectionMetadata {
  runId: string
  source: "agent_events"
}

export interface ChatMessageMetadata {
  agentProjection?: ChatMessageAgentProjectionMetadata
  mentions?: ChatMention[]
  workTimeMs?: number
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
    mentions: Array.isArray(metadata.mentions)
      ? (metadata.mentions as ChatMessageMetadata["mentions"])
      : undefined,
    workTimeMs
  }
}

export const formatWorkTime = (workTimeMs: number): string => {
  if (workTimeMs < 1000) {
    return `${workTimeMs} ms`
  }

  return `${(workTimeMs / 1000).toFixed(1)} s`
}
