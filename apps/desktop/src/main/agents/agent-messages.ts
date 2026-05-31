import type { ModelMessage } from "ai"

export type AgentCustomMessageType =
  | "agent-run-finished"
  | "agent-run-started"
  | "agent-tool-event"
  | "branch-summary"
  | "chat-branch"
  | "compaction-summary"
  | "follow-up"
  | "next-turn"
  | "plan-mode"
  | "queued-message-removed"
  | "queued-message-updated"
  | "queued-messages-reordered"
  | "steering"

export interface CustomAgentMessages {
  __etyonAgentMessageExtensionMarker__?: never
}

export interface AgentModelMessage {
  content: unknown
  role: ModelMessage["role"]
  type: "model"
}

export interface AgentCustomMessageBase {
  data: Record<string, unknown>
  type: string
}

export interface AgentBuiltInCustomMessage extends AgentCustomMessageBase {
  data: Record<string, unknown>
  type: AgentCustomMessageType
}

type AgentDeclaredCustomMessageMap = Omit<
  CustomAgentMessages,
  "__etyonAgentMessageExtensionMarker__"
>

export type AgentDeclaredCustomMessage =
  AgentDeclaredCustomMessageMap[keyof AgentDeclaredCustomMessageMap] &
    AgentCustomMessageBase

export type AgentCustomMessage =
  | AgentBuiltInCustomMessage
  | AgentDeclaredCustomMessage

export type AgentMessage = AgentCustomMessage | AgentModelMessage

const isAgentModelMessage = (
  message: AgentMessage
): message is AgentModelMessage => message.type === "model"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getModelMessageContentParts = (message: ModelMessage): unknown[] =>
  Array.isArray(message.content) ? message.content : []

interface ToolCallRecord {
  toolCallId: string
  toolName: string
}

const getPartToolCallId = (part: unknown): string | null => {
  if (!isRecord(part)) {
    return null
  }

  return typeof part.toolCallId === "string" ? part.toolCallId : null
}

const getToolCallRecord = (part: unknown): ToolCallRecord | null => {
  if (!isRecord(part) || part.type !== "tool-call") {
    return null
  }

  const toolCallId = getPartToolCallId(part)

  if (!toolCallId || part.providerExecuted === true) {
    return null
  }

  return {
    toolCallId,
    toolName: typeof part.toolName === "string" ? part.toolName : "unknown"
  }
}

const getApprovalRequestRecord = (
  part: unknown
): { approvalId: string; toolCallId: string } | null => {
  if (
    !isRecord(part) ||
    part.type !== "tool-approval-request" ||
    typeof part.approvalId !== "string"
  ) {
    return null
  }

  const directToolCallId = getPartToolCallId(part)

  if (directToolCallId) {
    return {
      approvalId: part.approvalId,
      toolCallId: directToolCallId
    }
  }

  if (!isRecord(part.toolCall)) {
    return null
  }

  return typeof part.toolCall.toolCallId === "string"
    ? {
        approvalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId
      }
    : null
}

const collectToolContinuityState = (
  messages: readonly ModelMessage[]
): {
  approvalToolCallIdsById: Map<string, string>
  knownToolCallIds: Set<string>
  resolvedToolCallIds: Set<string>
} => {
  const approvalToolCallIdsById = new Map<string, string>()
  const knownToolCallIds = new Set<string>()
  const resolvedToolCallIds = new Set<string>()

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    for (const part of getModelMessageContentParts(message)) {
      const toolCallId = getPartToolCallId(part)

      if (
        isRecord(part) &&
        part.type === "tool-call" &&
        !part.providerExecuted &&
        toolCallId
      ) {
        knownToolCallIds.add(toolCallId)
      }

      const approvalRequest = getApprovalRequestRecord(part)

      if (approvalRequest) {
        knownToolCallIds.add(approvalRequest.toolCallId)
        approvalToolCallIdsById.set(
          approvalRequest.approvalId,
          approvalRequest.toolCallId
        )
      }
    }
  }

  for (const message of messages) {
    if (message.role !== "tool") {
      continue
    }

    for (const part of getModelMessageContentParts(message)) {
      if (!isRecord(part)) {
        continue
      }

      const toolCallId = getPartToolCallId(part)

      if (
        (part.type === "tool-result" || part.type === "tool-error") &&
        toolCallId
      ) {
        resolvedToolCallIds.add(toolCallId)
        continue
      }

      if (
        part.type === "tool-approval-response" &&
        typeof part.approvalId === "string"
      ) {
        const approvedToolCallId = approvalToolCallIdsById.get(part.approvalId)

        if (approvedToolCallId) {
          resolvedToolCallIds.add(approvedToolCallId)
        }
      }
    }
  }

  return {
    approvalToolCallIdsById,
    knownToolCallIds,
    resolvedToolCallIds
  }
}

const getToolResolutionIds = ({
  approvalToolCallIdsById,
  message
}: {
  approvalToolCallIdsById: Map<string, string>
  message: ModelMessage
}): Set<string> => {
  const resolvedToolCallIds = new Set<string>()

  if (message.role !== "tool") {
    return resolvedToolCallIds
  }

  for (const part of getModelMessageContentParts(message)) {
    if (!isRecord(part)) {
      continue
    }

    const toolCallId = getPartToolCallId(part)

    if (
      (part.type === "tool-result" || part.type === "tool-error") &&
      toolCallId
    ) {
      resolvedToolCallIds.add(toolCallId)
      continue
    }

    if (
      part.type === "tool-approval-response" &&
      typeof part.approvalId === "string"
    ) {
      const approvedToolCallId = approvalToolCallIdsById.get(part.approvalId)

      if (approvedToolCallId) {
        resolvedToolCallIds.add(approvedToolCallId)
      }
    }
  }

  return resolvedToolCallIds
}

const getAssistantToolCallRecords = (
  message: ModelMessage
): ToolCallRecord[] => {
  if (message.role !== "assistant") {
    return []
  }

  return getModelMessageContentParts(message).flatMap((part) => {
    const record = getToolCallRecord(part)

    return record ? [record] : []
  })
}

const buildInterruptedToolResultMessage = (
  toolCalls: readonly ToolCallRecord[]
): ModelMessage => ({
  content: toolCalls.map(({ toolCallId, toolName }) => ({
    output: {
      type: "error-text",
      value: "Tool execution did not complete before the next user message."
    },
    toolCallId,
    toolName,
    type: "tool-result"
  })),
  role: "tool"
})

const onlyRequestsPendingApprovals = ({
  message,
  pendingToolCalls
}: {
  message: ModelMessage
  pendingToolCalls: readonly ToolCallRecord[]
}): boolean => {
  if (message.role !== "assistant" || pendingToolCalls.length === 0) {
    return false
  }

  const content = getModelMessageContentParts(message)

  if (content.length === 0) {
    return false
  }

  const pendingToolCallIds = new Set(
    pendingToolCalls.map(({ toolCallId }) => toolCallId)
  )

  return content.every((part) => {
    const approvalRequest = getApprovalRequestRecord(part)

    return (
      approvalRequest !== null &&
      pendingToolCallIds.has(approvalRequest.toolCallId)
    )
  })
}

const stripPendingApprovalRequests = ({
  message,
  pendingToolCallIds
}: {
  message: ModelMessage
  pendingToolCallIds: Set<string>
}): ModelMessage => {
  if (message.role !== "assistant") {
    return message
  }

  const content = getModelMessageContentParts(message)

  if (content.length === 0) {
    return message
  }

  const nextContent = content.filter((part) => {
    const approvalRequest = getApprovalRequestRecord(part)

    return (
      !approvalRequest || !pendingToolCallIds.has(approvalRequest.toolCallId)
    )
  })

  return nextContent.length === content.length
    ? message
    : ({
        ...message,
        content: nextContent
      } as ModelMessage)
}

export const convertAgentMessagesToLlm = (
  messages: readonly AgentMessage[]
): ModelMessage[] =>
  messages.filter(isAgentModelMessage).map(
    ({ content, role }) =>
      ({
        content,
        role
      }) as ModelMessage
  )

export const completeUnresolvedToolCallsInModelMessages = (
  messages: readonly ModelMessage[]
): ModelMessage[] => {
  const { approvalToolCallIdsById } = collectToolContinuityState(messages)
  const completedMessages: ModelMessage[] = []
  let pendingToolCalls: ToolCallRecord[] = []

  const flushPendingToolCalls = () => {
    if (pendingToolCalls.length === 0) {
      return
    }

    const pendingToolCallIds = new Set(
      pendingToolCalls.map(({ toolCallId }) => toolCallId)
    )
    const previousMessage = completedMessages.at(-1)

    if (previousMessage) {
      completedMessages[completedMessages.length - 1] =
        stripPendingApprovalRequests({
          message: previousMessage,
          pendingToolCallIds
        })
    }
    completedMessages.push(buildInterruptedToolResultMessage(pendingToolCalls))
    pendingToolCalls = []
  }

  for (const message of messages) {
    const defersPendingToolFlush = onlyRequestsPendingApprovals({
      message,
      pendingToolCalls
    })

    if (message.role !== "tool" && !defersPendingToolFlush) {
      flushPendingToolCalls()
    }

    completedMessages.push(message)

    if (message.role === "assistant") {
      const nextPendingToolCalls = getAssistantToolCallRecords(message)

      if (nextPendingToolCalls.length > 0) {
        pendingToolCalls = nextPendingToolCalls
      } else if (!defersPendingToolFlush) {
        pendingToolCalls = []
      }
      continue
    }

    if (message.role === "tool" && pendingToolCalls.length > 0) {
      const resolvedToolCallIds = getToolResolutionIds({
        approvalToolCallIdsById,
        message
      })
      pendingToolCalls = pendingToolCalls.filter(
        ({ toolCallId }) => !resolvedToolCallIds.has(toolCallId)
      )
    }
  }

  flushPendingToolCalls()

  return completedMessages
}

export const formatAgentMessageForDebug = (message: AgentMessage): string => {
  if (isAgentModelMessage(message)) {
    return `${message.role} ${JSON.stringify(message.content)}`
  }

  return `${message.type} ${JSON.stringify(message.data)}`
}
