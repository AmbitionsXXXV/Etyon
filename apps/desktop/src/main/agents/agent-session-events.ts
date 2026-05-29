import { randomUUID } from "node:crypto"

import type { ModelMessage } from "ai"

import { AgentRuntimeError } from "@/main/agents/agent-errors"
import type { AgentEvent, AgentRun } from "@/main/agents/agent-event-store"
import type {
  AgentCustomMessage,
  AgentModelMessage
} from "@/main/agents/agent-messages"
import type { AgentStructuredPlan } from "@/main/agents/agent-plan-progress"
import { createAgentSessionTree } from "@/main/agents/agent-session-tree"
import type { AgentSessionTree } from "@/main/agents/agent-session-tree"

export const AGENT_SESSION_ENTRY_EVENT_TYPE = "agent_session_entry_appended"
export const AGENT_SESSION_SAVE_POINT_EVENT_TYPE =
  "agent_session_save_point_created"

type AgentSessionEventAction =
  | "appendCompactionSummary"
  | "appendCustomMessage"
  | "appendMessage"
  | "moveTo"

interface AppendAgentSessionEntryEventPayload {
  action: AgentSessionEventAction
  branchSummary?: string
  entryId?: null | string
  message?: AgentCustomMessage | AgentModelMessage
  summary?: string
}

interface AgentSessionSavePointEventPayload {
  label?: string
  messages: AgentModelMessage[]
}

export interface AppendAgentSessionModelMessageEventsOptions {
  existingMessages?: readonly ModelMessage[]
  messages: readonly ModelMessage[]
  run: AgentRun
}

export interface AppendAgentSessionSavePointEventOptions {
  label?: string
  messages: readonly ModelMessage[]
  run: AgentRun
}

export interface AgentSessionSavePoint {
  createdAt: string
  eventId: string
  label?: string
  messages: readonly AgentModelMessage[]
  runId: string
  sequence: number
}

export interface AppendAgentSessionCompactionSummaryEventOptions {
  run: AgentRun
  summary: string
}

export interface AppendAgentSessionCustomMessageEventOptions {
  message: AgentCustomMessage
  run: AgentRun
}

export interface AppendAgentSessionMoveEventOptions {
  branchSummary?: string
  entryId: null | string
  run: AgentRun
}

export type AgentSessionPlanMode = "execute" | "plan"

export interface AppendAgentSessionPlanModeEventOptions {
  completedStepNumbers?: readonly number[]
  mode: AgentSessionPlanMode
  run: AgentRun
  structuredPlan?: AgentStructuredPlan
}

export interface AppendAgentSessionQueuedMessageEventOptions {
  id?: string
  message: string
  run: AgentRun
}

export type AgentSessionQueuedMessageQueue = "follow-up" | "steer"

export interface AgentSessionQueuedMessage {
  createdAt: string
  id: string
  message: string
  queue: AgentSessionQueuedMessageQueue
  runId: string
  sequence: number
}

export interface AppendAgentSessionQueuedMessageUpdateEventOptions {
  id: string
  message?: string
  queue?: AgentSessionQueuedMessageQueue
  run: AgentRun
}

export interface AppendAgentSessionQueuedMessageRemoveEventOptions {
  id: string
  run: AgentRun
}

export interface AppendAgentSessionQueuedMessageReorderEventOptions {
  ids: readonly string[]
  run: AgentRun
}

export interface CreateAgentSessionQueuedMessageWriterOptions {
  run: AgentRun
}

export interface AgentSessionQueuedMessageWriteInput {
  content: string
  queue: AgentSessionQueuedMessageQueue
}

export type AgentSessionQueuedMessageWriter = (
  message: AgentSessionQueuedMessageWriteInput
) => Promise<AgentSessionQueuedMessage>

const MODEL_MESSAGE_ROLES = new Set(["assistant", "system", "tool", "user"])
const QUEUED_MESSAGE_QUEUES = new Set(["follow-up", "steer"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const normalizeComparableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableJsonValue)
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, normalizeComparableJsonValue(value[key])])
  )
}

const getModelMessageSignature = (message: ModelMessage): string =>
  JSON.stringify(normalizeComparableJsonValue(message))

const createAgentModelMessage = (message: ModelMessage): AgentModelMessage => ({
  content: message.content,
  role: message.role,
  type: "model"
})

const getMissingModelMessages = ({
  existingMessages,
  messages
}: {
  existingMessages: readonly ModelMessage[]
  messages: readonly ModelMessage[]
}): readonly ModelMessage[] => {
  let firstMissingMessageIndex = 0

  while (
    firstMissingMessageIndex < existingMessages.length &&
    firstMissingMessageIndex < messages.length &&
    getModelMessageSignature(existingMessages[firstMissingMessageIndex]) ===
      getModelMessageSignature(messages[firstMissingMessageIndex])
  ) {
    firstMissingMessageIndex += 1
  }

  return messages.slice(firstMissingMessageIndex)
}

const isAgentModelMessage = (value: unknown): value is AgentModelMessage => {
  if (!isRecord(value)) {
    return false
  }

  return (
    "content" in value &&
    typeof value.role === "string" &&
    MODEL_MESSAGE_ROLES.has(value.role) &&
    value.type === "model"
  )
}

const isAgentCustomMessage = (value: unknown): value is AgentCustomMessage => {
  if (!isRecord(value)) {
    return false
  }

  return isRecord(value.data) && typeof value.type === "string"
}

const isAgentSessionQueuedMessageQueue = (
  value: unknown
): value is AgentSessionQueuedMessageQueue =>
  typeof value === "string" && QUEUED_MESSAGE_QUEUES.has(value)

const getQueuedMessageFromCustomMessage = ({
  event,
  message
}: {
  event: AgentEvent
  message: AgentCustomMessage
}): AgentSessionQueuedMessage | null => {
  const queuedMessage = message.data.message
  const { queue } = message.data

  if (
    typeof queuedMessage !== "string" ||
    !isAgentSessionQueuedMessageQueue(queue)
  ) {
    return null
  }

  if (
    (queue === "follow-up" && message.type !== "follow-up") ||
    (queue === "steer" && message.type !== "steering")
  ) {
    return null
  }

  return {
    createdAt: event.createdAt,
    id: typeof message.data.id === "string" ? message.data.id : event.id,
    message: queuedMessage,
    queue,
    runId: event.runId,
    sequence: event.sequence
  }
}

const getQueuedMessageUpdateFromCustomMessage = (
  message: AgentCustomMessage
): {
  id: string
  message?: string
  queue?: AgentSessionQueuedMessageQueue
} | null => {
  if (message.type !== "queued-message-updated") {
    return null
  }

  const { id, queue } = message.data
  const queuedMessage = message.data.message

  if (typeof id !== "string") {
    return null
  }

  return {
    id,
    ...(typeof queuedMessage === "string" ? { message: queuedMessage } : {}),
    ...(isAgentSessionQueuedMessageQueue(queue) ? { queue } : {})
  }
}

const getQueuedMessageRemoveIdFromCustomMessage = (
  message: AgentCustomMessage
): null | string =>
  message.type === "queued-message-removed" &&
  typeof message.data.id === "string"
    ? message.data.id
    : null

const getQueuedMessageReorderIdsFromCustomMessage = (
  message: AgentCustomMessage
): readonly string[] | null =>
  message.type === "queued-messages-reordered" &&
  Array.isArray(message.data.ids) &&
  message.data.ids.every((id) => typeof id === "string")
    ? (message.data.ids as string[])
    : null

const updateQueuedMessage = ({
  queuedMessages,
  update
}: {
  queuedMessages: AgentSessionQueuedMessage[]
  update: {
    id: string
    message?: string
    queue?: AgentSessionQueuedMessageQueue
  }
}): void => {
  const index = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === update.id
  )
  const queuedMessage = queuedMessages[index]

  if (!queuedMessage) {
    return
  }

  queuedMessages[index] = {
    ...queuedMessage,
    ...(update.message ? { message: update.message } : {}),
    ...(update.queue ? { queue: update.queue } : {})
  }
}

const removeQueuedMessageById = ({
  id,
  queuedMessages
}: {
  id: string
  queuedMessages: AgentSessionQueuedMessage[]
}): void => {
  const removedIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === id
  )

  if (removedIndex !== -1) {
    queuedMessages.splice(removedIndex, 1)
  }
}

const reorderQueuedMessages = ({
  ids,
  queuedMessages
}: {
  ids: readonly string[]
  queuedMessages: AgentSessionQueuedMessage[]
}): void => {
  const orderById = new Map(ids.map((id, index) => [id, index]))

  queuedMessages.sort((left, right) => {
    const leftOrder = orderById.get(left.id)
    const rightOrder = orderById.get(right.id)

    if (leftOrder === undefined && rightOrder === undefined) {
      return left.sequence - right.sequence
    }

    if (leftOrder === undefined) {
      return 1
    }

    if (rightOrder === undefined) {
      return -1
    }

    return leftOrder - rightOrder
  })
}

const consumeFirstQueuedMessage = ({
  content,
  queuedMessages
}: {
  content: string
  queuedMessages: AgentSessionQueuedMessage[]
}): void => {
  const consumedIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.message === content
  )

  if (consumedIndex !== -1) {
    queuedMessages.splice(consumedIndex, 1)
  }
}

const getSessionEventPayload = (
  payload: unknown
): AppendAgentSessionEntryEventPayload | null => {
  if (!isRecord(payload) || typeof payload.action !== "string") {
    return null
  }

  switch (payload.action) {
    case "appendCompactionSummary": {
      return typeof payload.summary === "string"
        ? {
            action: payload.action,
            summary: payload.summary
          }
        : null
    }
    case "appendCustomMessage": {
      return isAgentCustomMessage(payload.message)
        ? {
            action: payload.action,
            message: payload.message
          }
        : null
    }
    case "appendMessage": {
      return isAgentModelMessage(payload.message)
        ? {
            action: payload.action,
            message: payload.message
          }
        : null
    }
    case "moveTo": {
      return payload.entryId === null || typeof payload.entryId === "string"
        ? {
            action: payload.action,
            branchSummary:
              typeof payload.branchSummary === "string"
                ? payload.branchSummary
                : undefined,
            entryId: payload.entryId
          }
        : null
    }
    default: {
      return null
    }
  }
}

const getSavePointEventPayload = (
  payload: unknown
): AgentSessionSavePointEventPayload | null => {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    return null
  }

  const { messages } = payload

  if (!messages.every(isAgentModelMessage)) {
    return null
  }

  return {
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    messages
  }
}

const getAgentSessionSavePointFromEvent = (
  event: AgentEvent
): AgentSessionSavePoint | null => {
  if (event.type !== AGENT_SESSION_SAVE_POINT_EVENT_TYPE) {
    return null
  }

  const payload = getSavePointEventPayload(event.payload)

  if (!payload) {
    return null
  }

  return {
    createdAt: event.createdAt,
    eventId: event.id,
    ...(payload.label ? { label: payload.label } : {}),
    messages: payload.messages,
    runId: event.runId,
    sequence: event.sequence
  }
}

export const appendAgentSessionModelMessageEvents = async ({
  existingMessages = [],
  messages,
  run
}: AppendAgentSessionModelMessageEventsOptions): Promise<void> => {
  for (const message of getMissingModelMessages({
    existingMessages,
    messages
  })) {
    await run.appendEvent({
      payload: {
        action: "appendMessage",
        message: createAgentModelMessage(message)
      },
      type: AGENT_SESSION_ENTRY_EVENT_TYPE
    })
  }
}

export const appendAgentSessionSavePointEvent = async ({
  label,
  messages,
  run
}: AppendAgentSessionSavePointEventOptions): Promise<AgentSessionSavePoint> => {
  const event = await run.appendEvent({
    payload: {
      ...(label ? { label } : {}),
      messages: messages.map(createAgentModelMessage)
    },
    type: AGENT_SESSION_SAVE_POINT_EVENT_TYPE
  })

  return {
    createdAt: event.createdAt,
    eventId: event.id,
    ...(label ? { label } : {}),
    messages: messages.map(createAgentModelMessage),
    runId: event.runId,
    sequence: event.sequence
  }
}

export const appendAgentSessionCompactionSummaryEvent = async ({
  run,
  summary
}: AppendAgentSessionCompactionSummaryEventOptions): Promise<void> => {
  await run.appendEvent({
    payload: {
      action: "appendCompactionSummary",
      summary
    },
    type: AGENT_SESSION_ENTRY_EVENT_TYPE
  })
}

export const appendAgentSessionCustomMessageEvent = async ({
  message,
  run
}: AppendAgentSessionCustomMessageEventOptions): Promise<void> => {
  await run.appendEvent({
    payload: {
      action: "appendCustomMessage",
      message
    },
    type: AGENT_SESSION_ENTRY_EVENT_TYPE
  })
}

export const appendAgentSessionQueuedFollowUpEvent = async ({
  id = randomUUID(),
  message,
  run
}: AppendAgentSessionQueuedMessageEventOptions): Promise<AgentSessionQueuedMessage> => {
  const event = await run.appendEvent({
    payload: {
      action: "appendCustomMessage",
      message: {
        data: {
          id,
          message,
          queue: "follow-up"
        },
        type: "follow-up"
      }
    },
    type: AGENT_SESSION_ENTRY_EVENT_TYPE
  })

  return {
    createdAt: event.createdAt,
    id,
    message,
    queue: "follow-up",
    runId: event.runId,
    sequence: event.sequence
  }
}

export const appendAgentSessionQueuedSteeringEvent = async ({
  id = randomUUID(),
  message,
  run
}: AppendAgentSessionQueuedMessageEventOptions): Promise<AgentSessionQueuedMessage> => {
  const event = await run.appendEvent({
    payload: {
      action: "appendCustomMessage",
      message: {
        data: {
          id,
          message,
          queue: "steer"
        },
        type: "steering"
      }
    },
    type: AGENT_SESSION_ENTRY_EVENT_TYPE
  })

  return {
    createdAt: event.createdAt,
    id,
    message,
    queue: "steer",
    runId: event.runId,
    sequence: event.sequence
  }
}

export const appendAgentSessionQueuedMessageUpdateEvent = async ({
  id,
  message,
  queue,
  run
}: AppendAgentSessionQueuedMessageUpdateEventOptions): Promise<void> => {
  await appendAgentSessionCustomMessageEvent({
    message: {
      data: {
        id,
        ...(message ? { message } : {}),
        ...(queue ? { queue } : {})
      },
      type: "queued-message-updated"
    },
    run
  })
}

export const appendAgentSessionQueuedMessageRemoveEvent = async ({
  id,
  run
}: AppendAgentSessionQueuedMessageRemoveEventOptions): Promise<void> => {
  await appendAgentSessionCustomMessageEvent({
    message: {
      data: {
        id
      },
      type: "queued-message-removed"
    },
    run
  })
}

export const appendAgentSessionQueuedMessagesReorderEvent = async ({
  ids,
  run
}: AppendAgentSessionQueuedMessageReorderEventOptions): Promise<void> => {
  await appendAgentSessionCustomMessageEvent({
    message: {
      data: {
        ids: [...ids]
      },
      type: "queued-messages-reordered"
    },
    run
  })
}

export const appendAgentSessionMoveEvent = async ({
  branchSummary,
  entryId,
  run
}: AppendAgentSessionMoveEventOptions): Promise<void> => {
  await run.appendEvent({
    payload: {
      action: "moveTo",
      ...(branchSummary ? { branchSummary } : {}),
      entryId
    },
    type: AGENT_SESSION_ENTRY_EVENT_TYPE
  })
}

export const appendAgentSessionPlanModeEvent = async ({
  completedStepNumbers = [],
  mode,
  run,
  structuredPlan
}: AppendAgentSessionPlanModeEventOptions): Promise<void> => {
  await appendAgentSessionCustomMessageEvent({
    message: {
      data: {
        completedStepNumbers: [...completedStepNumbers],
        mode,
        ...(structuredPlan ? { structuredPlan } : {})
      },
      type: "plan-mode"
    },
    run
  })
}

export const createAgentSessionQueuedMessageWriter =
  ({
    run
  }: CreateAgentSessionQueuedMessageWriterOptions): AgentSessionQueuedMessageWriter =>
  ({ content, queue }) => {
    switch (queue) {
      case "follow-up": {
        return appendAgentSessionQueuedFollowUpEvent({
          message: content,
          run
        })
      }
      case "steer": {
        return appendAgentSessionQueuedSteeringEvent({
          message: content,
          run
        })
      }
      default: {
        const exhaustiveQueue: never = queue

        throw new AgentRuntimeError(
          "session",
          `Unknown queued message queue: ${exhaustiveQueue}`
        )
      }
    }
  }

export const listPendingAgentSessionQueuedMessages = (
  events: readonly AgentEvent[]
): AgentSessionQueuedMessage[] => {
  const queuedMessages: AgentSessionQueuedMessage[] = []
  const sessionEvents = events
    .filter((event) => event.type === AGENT_SESSION_ENTRY_EVENT_TYPE)
    .toSorted((left, right) => left.sequence - right.sequence)

  for (const event of sessionEvents) {
    const payload = getSessionEventPayload(event.payload)

    if (!payload) {
      continue
    }

    if (
      payload.action === "appendCustomMessage" &&
      payload.message &&
      isAgentCustomMessage(payload.message)
    ) {
      const queuedMessage = getQueuedMessageFromCustomMessage({
        event,
        message: payload.message
      })

      if (queuedMessage) {
        queuedMessages.push(queuedMessage)
      }

      const update = getQueuedMessageUpdateFromCustomMessage(payload.message)

      if (update) {
        updateQueuedMessage({
          queuedMessages,
          update
        })
      }

      const removeId = getQueuedMessageRemoveIdFromCustomMessage(
        payload.message
      )

      if (removeId) {
        removeQueuedMessageById({
          id: removeId,
          queuedMessages
        })
      }

      const reorderIds = getQueuedMessageReorderIdsFromCustomMessage(
        payload.message
      )

      if (reorderIds) {
        reorderQueuedMessages({
          ids: reorderIds,
          queuedMessages
        })
      }
    }

    if (
      payload.action === "appendMessage" &&
      payload.message &&
      isAgentModelMessage(payload.message) &&
      payload.message.role === "user" &&
      typeof payload.message.content === "string"
    ) {
      consumeFirstQueuedMessage({
        content: payload.message.content,
        queuedMessages
      })
    }
  }

  return queuedMessages
}

export const getLatestAgentSessionSavePoint = (
  events: readonly AgentEvent[]
): AgentSessionSavePoint | null =>
  events
    .map(getAgentSessionSavePointFromEvent)
    .filter(
      (savePoint): savePoint is AgentSessionSavePoint => savePoint !== null
    )
    .toSorted((left, right) => left.sequence - right.sequence)
    .at(-1) ?? null

export const buildAgentSessionTreeFromEvents = (
  events: readonly AgentEvent[]
): AgentSessionTree => {
  const session = createAgentSessionTree()
  const sessionEvents = events
    .filter((event) => event.type === AGENT_SESSION_ENTRY_EVENT_TYPE)
    .toSorted((left, right) => left.sequence - right.sequence)

  for (const event of sessionEvents) {
    const payload = getSessionEventPayload(event.payload)

    if (!payload) {
      continue
    }

    switch (payload.action) {
      case "appendCompactionSummary": {
        session.appendCompactionSummary(payload.summary ?? "")
        break
      }
      case "appendCustomMessage": {
        if (payload.message && isAgentCustomMessage(payload.message)) {
          session.appendCustomMessage(payload.message)
        }
        break
      }
      case "appendMessage": {
        if (payload.message && isAgentModelMessage(payload.message)) {
          session.appendMessage(payload.message)
        }
        break
      }
      case "moveTo": {
        session.moveTo(payload.entryId ?? null, payload.branchSummary)
        break
      }
      default: {
        const exhaustiveAction: never = payload.action

        throw new AgentRuntimeError(
          "session",
          `Unknown agent session action: ${exhaustiveAction}`
        )
      }
    }
  }

  return session
}

export const buildAgentSessionModelContextFromLatestSavePoint = (
  events: readonly AgentEvent[]
): readonly AgentModelMessage[] => {
  const savePoint = getLatestAgentSessionSavePoint(events)

  return (
    savePoint?.messages ??
    buildAgentSessionTreeFromEvents(events)
      .buildContext()
      .filter(isAgentModelMessage)
  )
}
