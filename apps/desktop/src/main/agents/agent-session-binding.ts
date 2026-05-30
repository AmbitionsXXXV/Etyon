import type { ModelMessage } from "ai"

import { createAgent } from "@/main/agents/agent"
import type {
  Agent,
  AgentQueuedMessage,
  CreateAgentOptions
} from "@/main/agents/agent"
import type { AgentEvent, AgentRun } from "@/main/agents/agent-event-store"
import type {
  AgentLoopUserMessage,
  RunAgentLoopResult
} from "@/main/agents/agent-loop"
import { convertAgentLoopMessagesToModelMessages } from "@/main/agents/agent-loop-ai-sdk"
import { convertAgentMessagesToLlm } from "@/main/agents/agent-messages"
import {
  appendAgentSessionModelMessageEvents,
  buildAgentSessionModelContextFromLatestSavePoint,
  createAgentSessionQueuedMessageWriter,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"
import type { AgentSessionQueuedMessageQueue } from "@/main/agents/agent-session-events"

export interface AgentSessionModelMessageCommitter {
  commit: (messages: readonly ModelMessage[]) => Promise<void>
  getCommittedMessages: () => ModelMessage[]
}

export type AgentSessionQueuedMessageDrainer = () => Promise<
  AgentLoopUserMessage[]
>

export interface CreateAgentSessionModelMessageCommitterOptions {
  events?: readonly AgentEvent[]
  initialMessages?: readonly ModelMessage[]
  run: AgentRun
}

export interface CreateAgentSessionQueuedMessageDrainerOptions {
  listEvents: () => Promise<readonly AgentEvent[]>
  queue: AgentSessionQueuedMessageQueue
}

export interface CreateSessionBoundAgentOptions extends Omit<
  CreateAgentOptions,
  "initialQueuedMessages" | "onQueuedMessage"
> {
  events?: readonly AgentEvent[]
  initialQueuedMessages?: readonly AgentQueuedMessage[]
  onQueuedMessage?: CreateAgentOptions["onQueuedMessage"]
  run: AgentRun
}

const toAgentQueuedMessage = ({
  message,
  queue
}: ReturnType<
  typeof listPendingAgentSessionQueuedMessages
>[number]): AgentQueuedMessage => ({
  content: message,
  queue
})

export const buildAgentSessionModelMessages = (
  events: readonly AgentEvent[]
): ModelMessage[] =>
  convertAgentMessagesToLlm(
    buildAgentSessionModelContextFromLatestSavePoint(events)
  )

export const buildAgentSessionQueuedModelMessages = (
  events: readonly AgentEvent[]
): ModelMessage[] =>
  listPendingAgentSessionQueuedMessages(events).map(({ message }) => ({
    content: message,
    role: "user"
  }))

export const createAgentSessionModelMessageCommitter = ({
  events = [],
  initialMessages,
  run
}: CreateAgentSessionModelMessageCommitterOptions): AgentSessionModelMessageCommitter => {
  let committedMessages = initialMessages
    ? [...initialMessages]
    : buildAgentSessionModelMessages(events)

  return {
    commit: async (messages) => {
      await appendAgentSessionModelMessageEvents({
        existingMessages: committedMessages,
        messages,
        run
      })

      committedMessages = [...messages]
    },
    getCommittedMessages: () => [...committedMessages]
  }
}

export const createAgentSessionQueuedMessageDrainer = ({
  listEvents,
  queue
}: CreateAgentSessionQueuedMessageDrainerOptions): AgentSessionQueuedMessageDrainer => {
  const consumedMessageIds = new Set<string>()

  return async () => {
    const events = await listEvents()
    const pendingMessages = listPendingAgentSessionQueuedMessages(events)
      .filter(
        (message) =>
          message.queue === queue && !consumedMessageIds.has(message.id)
      )
      .toSorted((left, right) => left.sequence - right.sequence)

    for (const message of pendingMessages) {
      consumedMessageIds.add(message.id)
    }

    return pendingMessages.map((message) => ({
      content: message.message,
      role: "user"
    }))
  }
}

export const createSessionBoundAgent = ({
  events = [],
  initialQueuedMessages = [],
  onQueuedMessage,
  run,
  ...options
}: CreateSessionBoundAgentOptions): Agent => {
  const writeQueuedMessage = createAgentSessionQueuedMessageWriter({ run })
  const modelMessageCommitter = createAgentSessionModelMessageCommitter({
    events,
    run
  })
  const commitTurnMessages = async (
    result: RunAgentLoopResult
  ): Promise<RunAgentLoopResult> => {
    const messages = convertAgentLoopMessagesToModelMessages(result.messages)

    await modelMessageCommitter.commit(messages)

    return result
  }
  const agent = createAgent({
    ...options,
    initialQueuedMessages: [
      ...listPendingAgentSessionQueuedMessages(events).map(
        toAgentQueuedMessage
      ),
      ...initialQueuedMessages
    ],
    onQueuedMessage: async (queuedMessage) => {
      await writeQueuedMessage(queuedMessage)
      await onQueuedMessage?.(queuedMessage)
    }
  })

  return {
    ...agent,
    continue: async () => commitTurnMessages(await agent.continue()),
    prompt: async (content) => commitTurnMessages(await agent.prompt(content)),
    promptFromTemplate: async (template, args) =>
      commitTurnMessages(await agent.promptFromTemplate(template, args))
  }
}
