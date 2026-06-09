import type {
  AgentUiStreamSnapshotsOutput,
  ListAgentUiStreamSnapshotsInput
} from "@etyon/rpc"
import type { UIMessage } from "ai"

import { parseChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import { isRecord } from "@/renderer/lib/utils"

export interface AgentUiStreamSnapshotCursor {
  nextSequence: number
  runId?: string
}

export interface MergeAgentUiStreamSnapshotsOptions<MESSAGE extends UIMessage> {
  messages: MESSAGE[]
  result: AgentUiStreamSnapshotsOutput
}

export interface MergeAgentUiStreamSnapshotsResult<MESSAGE extends UIMessage> {
  cursor: AgentUiStreamSnapshotCursor
  messages: MESSAGE[]
  shouldContinue: boolean
}

export interface ResolveAgentUiStreamSnapshotInputOptions<
  MESSAGE extends UIMessage
> {
  cursor: AgentUiStreamSnapshotCursor
  messages: readonly MESSAGE[]
  sessionId: string
}

const getMetadataRecord = (metadata: unknown): Record<string, unknown> =>
  isRecord(metadata) ? metadata : {}

const getLatestProjectedRunId = (messages: readonly UIMessage[]) => {
  for (const message of messages.toReversed()) {
    if (message.role !== "assistant") {
      continue
    }

    const agentProjection = parseChatMessageMetadata(
      message.metadata
    )?.agentProjection

    if (agentProjection) {
      return agentProjection.runId
    }
  }
}

const getProjectionIndex = ({
  messages,
  runId
}: {
  messages: readonly UIMessage[]
  runId: string
}): number => {
  const projectedIndex = messages.findLastIndex((message) => {
    if (message.role !== "assistant") {
      return false
    }

    return (
      parseChatMessageMetadata(message.metadata)?.agentProjection?.runId ===
      runId
    )
  })

  if (projectedIndex !== -1) {
    return projectedIndex
  }

  const latestMessageIndex = messages.length - 1
  const latestMessage = messages[latestMessageIndex]

  return latestMessage?.role === "assistant" ? latestMessageIndex : -1
}

export const resolveAgentUiStreamSnapshotInput = <MESSAGE extends UIMessage>({
  cursor,
  messages,
  sessionId
}: ResolveAgentUiStreamSnapshotInputOptions<MESSAGE>): ListAgentUiStreamSnapshotsInput => {
  const runId = cursor.runId ?? getLatestProjectedRunId(messages)

  return {
    afterSequence: cursor.nextSequence,
    ...(runId ? { runId } : {}),
    sessionId
  }
}

export const mergeAgentUiStreamSnapshots = <MESSAGE extends UIMessage>({
  messages,
  result
}: MergeAgentUiStreamSnapshotsOptions<MESSAGE>): MergeAgentUiStreamSnapshotsResult<MESSAGE> => {
  const latestSnapshot = result.snapshots.at(-1)
  const shouldContinue =
    result.run?.status === "running" || result.run?.status === "suspended"
  const cursor: AgentUiStreamSnapshotCursor = {
    nextSequence: result.nextSequence,
    ...(result.run ? { runId: result.run.id } : {})
  }

  if (!latestSnapshot) {
    return {
      cursor,
      messages,
      shouldContinue
    }
  }

  const projectionIndex = getProjectionIndex({
    messages,
    runId: latestSnapshot.runId
  })
  const previousMessage =
    projectionIndex === -1 ? undefined : messages[projectionIndex]
  const metadata = {
    ...getMetadataRecord(previousMessage?.metadata),
    agentProjection: {
      runId: latestSnapshot.runId,
      source: "agent_events"
    }
  }
  const nextMessage = {
    id: previousMessage?.id ?? `agent-ui-stream-${latestSnapshot.runId}`,
    metadata,
    parts: latestSnapshot.parts as MESSAGE["parts"],
    role: "assistant"
  } as MESSAGE

  if (
    previousMessage &&
    previousMessage.parts === nextMessage.parts &&
    parseChatMessageMetadata(previousMessage.metadata)?.agentProjection
      ?.runId === latestSnapshot.runId
  ) {
    return {
      cursor,
      messages,
      shouldContinue
    }
  }

  if (projectionIndex === -1) {
    return {
      cursor,
      messages: [...messages, nextMessage],
      shouldContinue
    }
  }

  return {
    cursor,
    messages: messages.map((message, index) =>
      index === projectionIndex ? nextMessage : message
    ),
    shouldContinue
  }
}
