import type { ModelMessage } from "ai"

import type { AgentEvent, AgentRun } from "@/main/agents/agent-event-store"
import type {
  AgentCustomMessage,
  AgentModelMessage
} from "@/main/agents/agent-messages"
import type { AgentStructuredPlan } from "@/main/agents/agent-plan-progress"
import { createAgentSessionTree } from "@/main/agents/agent-session-tree"
import type { AgentSessionTree } from "@/main/agents/agent-session-tree"

export const AGENT_SESSION_ENTRY_EVENT_TYPE = "agent_session_entry_appended"

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

export interface AppendAgentSessionModelMessageEventsOptions {
  existingMessages?: readonly ModelMessage[]
  messages: readonly ModelMessage[]
  run: AgentRun
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
  message: string
  run: AgentRun
}

export type AgentSessionQueuedMessageQueue = "follow-up" | "steer"

export interface AgentSessionQueuedMessage {
  message: string
  queue: AgentSessionQueuedMessageQueue
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
) => Promise<void>

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

const getQueuedMessageFromCustomMessage = (
  message: AgentCustomMessage
): AgentSessionQueuedMessage | null => {
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
    message: queuedMessage,
    queue
  }
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
        message: {
          content: message.content,
          role: message.role,
          type: "model"
        }
      },
      type: AGENT_SESSION_ENTRY_EVENT_TYPE
    })
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
  message,
  run
}: AppendAgentSessionQueuedMessageEventOptions): Promise<void> => {
  await appendAgentSessionCustomMessageEvent({
    message: {
      data: {
        message,
        queue: "follow-up"
      },
      type: "follow-up"
    },
    run
  })
}

export const appendAgentSessionQueuedSteeringEvent = async ({
  message,
  run
}: AppendAgentSessionQueuedMessageEventOptions): Promise<void> => {
  await appendAgentSessionCustomMessageEvent({
    message: {
      data: {
        message,
        queue: "steer"
      },
      type: "steering"
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
  async ({ content, queue }) => {
    switch (queue) {
      case "follow-up": {
        await appendAgentSessionQueuedFollowUpEvent({
          message: content,
          run
        })
        break
      }
      case "steer": {
        await appendAgentSessionQueuedSteeringEvent({
          message: content,
          run
        })
        break
      }
      default: {
        const exhaustiveQueue: never = queue

        throw new Error(`Unknown queued message queue: ${exhaustiveQueue}`)
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
      const queuedMessage = getQueuedMessageFromCustomMessage(payload.message)

      if (queuedMessage) {
        queuedMessages.push(queuedMessage)
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

        throw new Error(`Unknown agent session action: ${exhaustiveAction}`)
      }
    }
  }

  return session
}
