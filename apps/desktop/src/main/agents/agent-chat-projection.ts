import type { ModelMessage, UIMessage } from "ai"

import type { AgentEvent } from "@/main/agents/agent-event-store"
import { convertAgentMessagesToLlm } from "@/main/agents/agent-messages"
import { buildAgentSessionModelContextFromLatestSavePoint } from "@/main/agents/agent-session-events"
import { attachAgentProjectionToAssistantMessages } from "@/shared/chat/message-metadata"

type ChatTextPart = Extract<UIMessage["parts"][number], { type: "text" }>

interface ProjectedDynamicToolPart {
  approval?: {
    id: string
  }
  errorText?: string
  input?: unknown
  output?: unknown
  state:
    | "approval-requested"
    | "approval-responded"
    | "input-available"
    | "output-available"
    | "output-error"
  toolCallId: string
  toolName: string
  type: "dynamic-tool"
}

interface ProjectedToolLocation {
  messageIndex: number
  partIndex: number
}

export interface BuildAgentChatProjectionMessagesOptions {
  events: readonly AgentEvent[]
  runId: string
}

export interface MergeAgentEventProjectionIntoChatMessagesOptions {
  allowEmptyProjectionFallback?: boolean
  events: readonly AgentEvent[]
  includeProjectedUserMessages?: boolean
  messages: UIMessage[]
  originalMessageCount: number
  runId: string
}

export interface AgentChatProjectionBranch {
  branchKind: "edit" | "regenerate"
  messageId?: string
  retainedMessageIds: readonly string[]
  trigger: "regenerate-message" | "submit-message"
}

export interface SelectAgentChatProjectionPrefixMessagesOptions {
  events: readonly AgentEvent[]
  fallbackMessageCount: number
  messages: readonly UIMessage[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isAgentChatProjectionBranchKind = (
  value: unknown
): value is AgentChatProjectionBranch["branchKind"] =>
  value === "edit" || value === "regenerate"

const isAgentChatProjectionBranchTrigger = (
  value: unknown
): value is AgentChatProjectionBranch["trigger"] =>
  value === "regenerate-message" || value === "submit-message"

const getAgentChatProjectionBranchFromEvent = (
  event: AgentEvent
): AgentChatProjectionBranch | null => {
  if (event.type !== "agent_session_entry_appended") {
    return null
  }

  const { payload } = event

  if (!isRecord(payload) || payload.action !== "appendCustomMessage") {
    return null
  }

  const { message } = payload

  if (!isRecord(message) || message.type !== "chat-branch") {
    return null
  }

  const { data } = message

  if (
    !isRecord(data) ||
    !isAgentChatProjectionBranchKind(data.branchKind) ||
    !Array.isArray(data.retainedMessageIds) ||
    !data.retainedMessageIds.every((id) => typeof id === "string") ||
    !isAgentChatProjectionBranchTrigger(data.trigger)
  ) {
    return null
  }

  return {
    branchKind: data.branchKind,
    ...(typeof data.messageId === "string"
      ? { messageId: data.messageId }
      : {}),
    retainedMessageIds: data.retainedMessageIds,
    trigger: data.trigger
  }
}

const getContentParts = (message: ModelMessage): readonly unknown[] =>
  Array.isArray(message.content) ? message.content : []

const getOutputValue = (output: unknown): unknown => {
  if (!isRecord(output) || !("value" in output)) {
    return output
  }

  return output.value
}

const getOutputErrorText = (output: unknown): string => {
  const value = getOutputValue(output)

  return typeof value === "string" ? value : JSON.stringify(value)
}

const isErrorOutput = (output: unknown): boolean =>
  isRecord(output) &&
  typeof output.type === "string" &&
  output.type.startsWith("error-")

const createTextPart = (text: string): ChatTextPart | null =>
  text.length > 0
    ? ({
        text,
        type: "text"
      } as ChatTextPart)
    : null

const getTextPartsFromModelMessage = (
  message: ModelMessage
): ChatTextPart[] => {
  if (typeof message.content === "string") {
    const part = createTextPart(message.content)

    return part ? [part] : []
  }

  return getContentParts(message).flatMap((part) => {
    if (
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string"
    ) {
      return []
    }

    const textPart = createTextPart(part.text)

    return textPart ? [textPart] : []
  })
}

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is ChatTextPart =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
    .trim()

const hasSameProjectionBoundary = (
  leftMessage: UIMessage,
  rightMessage: UIMessage
): boolean => {
  const leftText = getMessageText(leftMessage)

  return (
    leftMessage.role === rightMessage.role &&
    leftText.length > 0 &&
    leftText === getMessageText(rightMessage)
  )
}

const getProjectedPrefixBoundary = ({
  prefixMessages,
  projectedMessages
}: {
  prefixMessages: readonly UIMessage[]
  projectedMessages: readonly UIMessage[]
}): number | null => {
  const maxLength = Math.min(prefixMessages.length, projectedMessages.length)
  let boundary = 0

  for (let index = 0; index < maxLength; index += 1) {
    const prefixMessage = prefixMessages[index]
    const projectedMessage = projectedMessages[index]

    if (
      !prefixMessage ||
      !projectedMessage ||
      !hasSameProjectionBoundary(prefixMessage, projectedMessage)
    ) {
      break
    }

    boundary = index + 1
  }

  return boundary > 0 ? boundary : null
}

const STREAM_SNAPSHOT_TOOL_STATES = new Set([
  "approval-requested",
  "approval-responded",
  "input-available",
  "output-available",
  "output-error"
])

const hasTerminalRunEvent = (events: readonly AgentEvent[]): boolean =>
  events.some(
    (event) =>
      event.type === "agent_run_finished" || event.type === "agent_run_failed"
  )

const toStreamSnapshotTextPart = (
  part: Record<string, unknown>
): UIMessage["parts"][number] | null =>
  part.type === "text" && typeof part.text === "string"
    ? ({
        text: part.text,
        type: "text"
      } as UIMessage["parts"][number])
    : null

const toStreamSnapshotToolPart = (
  part: Record<string, unknown>
): UIMessage["parts"][number] | null => {
  if (
    part.type !== "dynamic-tool" ||
    typeof part.state !== "string" ||
    !STREAM_SNAPSHOT_TOOL_STATES.has(part.state) ||
    typeof part.toolCallId !== "string" ||
    typeof part.toolName !== "string"
  ) {
    return null
  }

  return {
    ...(isRecord(part.approval) && typeof part.approval.id === "string"
      ? {
          approval: {
            id: part.approval.id
          }
        }
      : {}),
    ...(typeof part.errorText === "string"
      ? {
          errorText: part.errorText
        }
      : {}),
    ...("input" in part ? { input: part.input } : {}),
    ...("output" in part ? { output: part.output } : {}),
    state: part.state,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    type: "dynamic-tool"
  } as UIMessage["parts"][number]
}

const toStreamSnapshotPart = (
  part: unknown
): UIMessage["parts"][number] | null => {
  if (!isRecord(part)) {
    return null
  }

  return toStreamSnapshotTextPart(part) ?? toStreamSnapshotToolPart(part)
}

const getLatestAgentUiStreamSnapshotParts = (
  events: readonly AgentEvent[]
): UIMessage["parts"] => {
  const snapshotEvent = events
    .toReversed()
    .find((event) => event.type === "agent_ui_stream_snapshot_created")

  if (!snapshotEvent || !isRecord(snapshotEvent.payload)) {
    return []
  }

  const { parts } = snapshotEvent.payload

  if (!Array.isArray(parts)) {
    return []
  }

  return parts.flatMap((part) => {
    const snapshotPart = toStreamSnapshotPart(part)

    return snapshotPart ? [snapshotPart] : []
  }) as UIMessage["parts"]
}

export const hasAgentUiStreamSnapshot = (
  events: readonly AgentEvent[]
): boolean => getLatestAgentUiStreamSnapshotParts(events).length > 0

export const getLatestAgentChatProjectionBranch = (
  events: readonly AgentEvent[]
): AgentChatProjectionBranch | null => {
  for (const event of events.toReversed()) {
    const branch = getAgentChatProjectionBranchFromEvent(event)

    if (branch) {
      return branch
    }
  }

  return null
}

export const selectAgentChatProjectionPrefixMessages = ({
  events,
  fallbackMessageCount,
  messages
}: SelectAgentChatProjectionPrefixMessagesOptions): UIMessage[] => {
  const branch = getLatestAgentChatProjectionBranch(events)

  if (!branch) {
    return messages.slice(0, fallbackMessageCount)
  }

  const messageById = new Map(messages.map((message) => [message.id, message]))
  const retainedMessages = branch.retainedMessageIds.flatMap((messageId) => {
    const message = messageById.get(messageId)

    return message ? [message] : []
  })

  return retainedMessages.length === branch.retainedMessageIds.length
    ? retainedMessages
    : messages.slice(0, fallbackMessageCount)
}

export const getLatestUserMessageBoundary = (
  messages: readonly UIMessage[]
): number => messages.findLastIndex((message) => message.role === "user") + 1

const getLatestUserMessageIndex = (messages: readonly UIMessage[]): number =>
  messages.findLastIndex((message) => message.role === "user")

const createProjectionMessage = ({
  index,
  parts,
  role,
  runId
}: {
  index: number
  parts: UIMessage["parts"]
  role: "assistant" | "user"
  runId: string
}): UIMessage => ({
  id: `agent-${runId}-${index}-${role}`,
  parts,
  role
})

const getLatestAssistantProjectionMessage = (
  messages: UIMessage[]
): UIMessage | null =>
  messages.findLast((message) => message.role === "assistant") ?? null

const mergeActiveStreamSnapshotParts = ({
  messages,
  modelMessageCount,
  runId,
  snapshotParts
}: {
  messages: UIMessage[]
  modelMessageCount: number
  runId: string
  snapshotParts: UIMessage["parts"]
}): void => {
  const latestMessage = messages.at(-1)

  if (latestMessage?.role === "assistant") {
    latestMessage.parts = snapshotParts
    return
  }

  messages.push(
    createProjectionMessage({
      index: modelMessageCount,
      parts: snapshotParts,
      role: "assistant",
      runId
    })
  )
}

const appendAssistantTextPartsToProjectionMessage = ({
  message,
  textParts
}: {
  message: UIMessage
  textParts: readonly ChatTextPart[]
}): void => {
  for (const part of textParts) {
    message.parts.push(part)
  }
}

const findToolPart = ({
  messages,
  toolCallId,
  toolLocations
}: {
  messages: UIMessage[]
  toolCallId: string
  toolLocations: Map<string, ProjectedToolLocation>
}): ProjectedDynamicToolPart | null => {
  const location = toolLocations.get(toolCallId)

  if (!location) {
    return null
  }

  const message = messages[location.messageIndex]
  const part = message?.parts[location.partIndex]

  return isRecord(part) && part.type === "dynamic-tool"
    ? (part as unknown as ProjectedDynamicToolPart)
    : null
}

const setProjectedToolApproval = ({
  approvalId,
  approvalToolCallIdsById,
  toolCallId,
  toolPart
}: {
  approvalId: string
  approvalToolCallIdsById: Map<string, string>
  toolCallId: string
  toolPart: ProjectedDynamicToolPart
}): void => {
  approvalToolCallIdsById.set(approvalId, toolCallId)
  toolPart.approval = {
    id: approvalId
  }
  toolPart.state = "approval-requested"
}

const upsertToolPart = ({
  input,
  messages,
  state,
  toolCallId,
  toolLocations,
  toolName
}: {
  input?: unknown
  messages: UIMessage[]
  state: ProjectedDynamicToolPart["state"]
  toolCallId: string
  toolLocations: Map<string, ProjectedToolLocation>
  toolName: string
}): ProjectedDynamicToolPart | null => {
  const existingPart = findToolPart({
    messages,
    toolCallId,
    toolLocations
  })

  if (existingPart) {
    existingPart.input = input ?? existingPart.input
    existingPart.state = state
    existingPart.toolName = toolName

    return existingPart
  }

  const latestAssistantMessageIndex = messages.findLastIndex(
    (message) => message.role === "assistant"
  )
  const message = messages[latestAssistantMessageIndex]

  if (!message) {
    return null
  }

  const inputFields = input === undefined ? {} : { input }
  const part = {
    ...inputFields,
    state,
    toolCallId,
    toolName,
    type: "dynamic-tool"
  } satisfies ProjectedDynamicToolPart
  const partIndex = message.parts.length

  message.parts.push(part as unknown as UIMessage["parts"][number])
  toolLocations.set(toolCallId, {
    messageIndex: latestAssistantMessageIndex,
    partIndex
  })

  return part
}

const applyAssistantPartToProjection = ({
  approvalToolCallIdsById,
  messages,
  part,
  toolLocations
}: {
  approvalToolCallIdsById: Map<string, string>
  messages: UIMessage[]
  part: unknown
  toolLocations: Map<string, ProjectedToolLocation>
}): void => {
  if (!isRecord(part)) {
    return
  }

  if (
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    upsertToolPart({
      input: part.input,
      messages,
      state: "input-available",
      toolCallId: part.toolCallId,
      toolLocations,
      toolName: part.toolName
    })
    return
  }

  if (
    part.type === "tool-approval-request" &&
    typeof part.approvalId === "string" &&
    typeof part.toolCallId === "string"
  ) {
    const existingToolPart = findToolPart({
      messages,
      toolCallId: part.toolCallId,
      toolLocations
    })
    const toolPart =
      existingToolPart ??
      (typeof part.toolName === "string"
        ? upsertToolPart({
            input: part.input,
            messages,
            state: "approval-requested",
            toolCallId: part.toolCallId,
            toolLocations,
            toolName: part.toolName
          })
        : null)

    if (toolPart) {
      setProjectedToolApproval({
        approvalId: part.approvalId,
        approvalToolCallIdsById,
        toolCallId: part.toolCallId,
        toolPart
      })
    }
  }
}

const applyToolResultPartToProjection = ({
  messages,
  part,
  toolLocations
}: {
  messages: UIMessage[]
  part: unknown
  toolLocations: Map<string, ProjectedToolLocation>
}): boolean => {
  if (
    !isRecord(part) ||
    part.type !== "tool-result" ||
    typeof part.toolCallId !== "string"
  ) {
    return false
  }

  const toolPart = findToolPart({
    messages,
    toolCallId: part.toolCallId,
    toolLocations
  })

  if (!toolPart) {
    return false
  }

  if (typeof part.toolName === "string") {
    toolPart.toolName = part.toolName
  }

  if (isErrorOutput(part.output)) {
    toolPart.errorText = getOutputErrorText(part.output)
    toolPart.state = "output-error"
    return true
  }

  toolPart.output = getOutputValue(part.output)
  toolPart.state = "output-available"

  return true
}

const applyToolApprovalResponsePartToProjection = ({
  approvalToolCallIdsById,
  messages,
  part,
  toolLocations
}: {
  approvalToolCallIdsById: Map<string, string>
  messages: UIMessage[]
  part: unknown
  toolLocations: Map<string, ProjectedToolLocation>
}): boolean => {
  if (!isRecord(part) || part.type !== "tool-approval-response") {
    return false
  }

  let toolCallId: string | undefined

  const { approvalId, toolCallId: partToolCallId } = part

  if (typeof partToolCallId === "string") {
    toolCallId = partToolCallId
  } else if (typeof approvalId === "string") {
    toolCallId = approvalToolCallIdsById.get(approvalId)
  }

  if (!toolCallId) {
    return false
  }

  const toolPart = findToolPart({
    messages,
    toolCallId,
    toolLocations
  })

  if (toolPart) {
    toolPart.state = "approval-responded"
  }

  return true
}

const applyToolMessageToProjection = ({
  approvalToolCallIdsById,
  message,
  messages,
  toolLocations
}: {
  approvalToolCallIdsById: Map<string, string>
  message: ModelMessage
  messages: UIMessage[]
  toolLocations: Map<string, ProjectedToolLocation>
}): boolean => {
  let shouldMergeNextAssistantMessage = false

  for (const part of getContentParts(message)) {
    shouldMergeNextAssistantMessage =
      applyToolApprovalResponsePartToProjection({
        approvalToolCallIdsById,
        messages,
        part,
        toolLocations
      }) || shouldMergeNextAssistantMessage
    shouldMergeNextAssistantMessage =
      applyToolResultPartToProjection({
        messages,
        part,
        toolLocations
      }) || shouldMergeNextAssistantMessage
  }

  return shouldMergeNextAssistantMessage
}

const onlyRequestsExistingToolApprovals = ({
  message,
  textParts,
  toolLocations
}: {
  message: ModelMessage
  textParts: readonly ChatTextPart[]
  toolLocations: Map<string, ProjectedToolLocation>
}): boolean => {
  if (textParts.length > 0) {
    return false
  }

  const parts = getContentParts(message)

  return (
    parts.length > 0 &&
    parts.every(
      (part) =>
        isRecord(part) &&
        part.type === "tool-approval-request" &&
        typeof part.toolCallId === "string" &&
        toolLocations.has(part.toolCallId)
    )
  )
}

const mergeAssistantMetadata = ({
  messages,
  projectedMessages
}: {
  messages: readonly UIMessage[]
  projectedMessages: UIMessage[]
}): UIMessage[] => {
  const fallbackAssistantMessages = messages.filter(
    (message) => message.role === "assistant"
  )
  const projectedAssistantMessageCount = projectedMessages.filter(
    (message) => message.role === "assistant"
  ).length
  const fallbackAssistantStartIndex = Math.max(
    0,
    fallbackAssistantMessages.length - projectedAssistantMessageCount
  )
  let fallbackAssistantIndex = 0

  return projectedMessages.map((message) => {
    if (message.role !== "assistant") {
      return message
    }

    const fallbackMetadata =
      fallbackAssistantMessages[
        fallbackAssistantStartIndex + fallbackAssistantIndex
      ]?.metadata
    fallbackAssistantIndex += 1

    if (!isRecord(fallbackMetadata)) {
      return message
    }

    return {
      ...message,
      metadata: {
        ...fallbackMetadata,
        ...(isRecord(message.metadata) ? message.metadata : {})
      }
    }
  })
}

export const buildAgentChatProjectionMessages = ({
  events,
  runId
}: BuildAgentChatProjectionMessagesOptions): UIMessage[] => {
  const modelMessages = convertAgentMessagesToLlm(
    buildAgentSessionModelContextFromLatestSavePoint(events)
  )
  const approvalToolCallIdsById = new Map<string, string>()
  const messages: UIMessage[] = []
  let shouldMergeNextAssistantMessage = false
  const toolLocations = new Map<string, ProjectedToolLocation>()

  for (const [index, message] of modelMessages.entries()) {
    if (message.role === "system") {
      continue
    }

    if (message.role === "tool") {
      shouldMergeNextAssistantMessage =
        applyToolMessageToProjection({
          approvalToolCallIdsById,
          message,
          messages,
          toolLocations
        }) || shouldMergeNextAssistantMessage
      continue
    }

    if (message.role !== "assistant" && message.role !== "user") {
      continue
    }

    const textParts = getTextPartsFromModelMessage(message)
    const continuationMessage =
      message.role === "assistant" &&
      (shouldMergeNextAssistantMessage ||
        onlyRequestsExistingToolApprovals({
          message,
          textParts,
          toolLocations
        }))
        ? getLatestAssistantProjectionMessage(messages)
        : null
    const projectedMessage =
      continuationMessage ??
      createProjectionMessage({
        index,
        parts: textParts,
        role: message.role,
        runId
      })

    if (continuationMessage) {
      appendAssistantTextPartsToProjectionMessage({
        message: continuationMessage,
        textParts
      })
    } else {
      messages.push(projectedMessage)
    }

    if (message.role === "assistant") {
      for (const part of getContentParts(message)) {
        applyAssistantPartToProjection({
          approvalToolCallIdsById,
          messages,
          part,
          toolLocations
        })
      }

      shouldMergeNextAssistantMessage = false
      continue
    }

    shouldMergeNextAssistantMessage = false
  }

  const snapshotParts = hasTerminalRunEvent(events)
    ? []
    : getLatestAgentUiStreamSnapshotParts(events)

  if (snapshotParts.length > 0) {
    mergeActiveStreamSnapshotParts({
      messages,
      modelMessageCount: modelMessages.length,
      runId,
      snapshotParts
    })
  }

  return attachAgentProjectionToAssistantMessages(messages, {
    runId
  })
}

const trimTrailingAssistantMessages = (messages: UIMessage[]): UIMessage[] => {
  let endIndex = messages.length

  while (endIndex > 0 && messages[endIndex - 1].role === "assistant") {
    endIndex -= 1
  }

  return endIndex === messages.length ? messages : messages.slice(0, endIndex)
}

const getProjectionSuffixStartIndex = ({
  includeProjectedUserMessages,
  latestOriginalUserText,
  prefixMessages,
  projectedMessages
}: {
  includeProjectedUserMessages: boolean
  latestOriginalUserText: string
  prefixMessages: readonly UIMessage[]
  projectedMessages: readonly UIMessage[]
}): number => {
  const projectedPrefixBoundary = includeProjectedUserMessages
    ? getProjectedPrefixBoundary({
        prefixMessages,
        projectedMessages
      })
    : null
  const latestProjectedUserMessageIndex = includeProjectedUserMessages
    ? getLatestUserMessageIndex(projectedMessages)
    : -1
  const latestProjectedUserMessage =
    latestProjectedUserMessageIndex >= 0
      ? projectedMessages[latestProjectedUserMessageIndex]
      : null
  const latestProjectedUserText = latestProjectedUserMessage
    ? getMessageText(latestProjectedUserMessage)
    : ""
  const shouldAppendProjectedUserSuffix =
    includeProjectedUserMessages &&
    latestProjectedUserMessageIndex >= 0 &&
    latestOriginalUserText.length > 0 &&
    latestProjectedUserText.length > 0 &&
    latestProjectedUserText !== latestOriginalUserText

  if (shouldAppendProjectedUserSuffix) {
    return latestProjectedUserMessageIndex
  }

  if (projectedPrefixBoundary !== null) {
    return projectedPrefixBoundary
  }

  if (latestOriginalUserText.length === 0) {
    return prefixMessages.length
  }

  return (
    projectedMessages.findLastIndex(
      (message) =>
        message.role === "user" &&
        getMessageText(message) === latestOriginalUserText
    ) + 1
  )
}

export const mergeAgentEventProjectionIntoChatMessages = ({
  allowEmptyProjectionFallback = true,
  events,
  includeProjectedUserMessages = false,
  messages,
  originalMessageCount,
  runId
}: MergeAgentEventProjectionIntoChatMessagesOptions): UIMessage[] => {
  const prefixMessages = messages.slice(0, originalMessageCount)
  const fallbackSuffixMessages = messages.slice(originalMessageCount)
  const latestOriginalUserMessage = prefixMessages.findLast(
    (message) => message.role === "user"
  )
  const latestOriginalUserText = latestOriginalUserMessage
    ? getMessageText(latestOriginalUserMessage)
    : ""
  const projectedMessages = buildAgentChatProjectionMessages({
    events,
    runId
  })

  if (
    includeProjectedUserMessages &&
    originalMessageCount === 0 &&
    projectedMessages.length > 0
  ) {
    return mergeAssistantMetadata({
      messages: fallbackSuffixMessages,
      projectedMessages
    })
  }

  const suffixStartIndex = getProjectionSuffixStartIndex({
    includeProjectedUserMessages,
    latestOriginalUserText,
    prefixMessages,
    projectedMessages
  })
  const projectedSuffixMessages = projectedMessages
    .slice(Math.max(0, suffixStartIndex))
    .filter(
      (message) =>
        message.role === "assistant" ||
        (includeProjectedUserMessages && message.role === "user")
    )

  if (projectedSuffixMessages.length === 0) {
    if (!allowEmptyProjectionFallback) {
      return messages
    }

    return attachAgentProjectionToAssistantMessages(messages, {
      runId,
      startIndex: originalMessageCount
    })
  }

  const shouldTrimTrailingAssistantMessages =
    projectedSuffixMessages[0]?.role === "assistant"
  const trimmedPrefixMessages = shouldTrimTrailingAssistantMessages
    ? trimTrailingAssistantMessages(prefixMessages)
    : prefixMessages
  const mergedSuffixMessages = mergeAssistantMetadata({
    messages: fallbackSuffixMessages,
    projectedMessages: projectedSuffixMessages
  })

  return [...trimmedPrefixMessages, ...mergedSuffixMessages]
}
