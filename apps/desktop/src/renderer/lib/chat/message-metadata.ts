import type { ChatMention } from "@etyon/rpc"

export { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"

export interface ChatMessageMetadata {
  mentions?: ChatMention[]
  workTimeMs?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

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

  return {
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
