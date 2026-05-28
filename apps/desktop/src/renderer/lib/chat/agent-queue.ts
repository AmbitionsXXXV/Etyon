import type { AgentSessionQueuedMessageQueue } from "@etyon/rpc"

export interface AgentComposerQueueAction {
  labelKey: "chat.composer.queueFollowUp" | "chat.composer.queueSteer"
  queue: AgentSessionQueuedMessageQueue
}

const AGENT_COMPOSER_QUEUE_ACTIONS: readonly AgentComposerQueueAction[] = [
  {
    labelKey: "chat.composer.queueSteer",
    queue: "steer"
  },
  {
    labelKey: "chat.composer.queueFollowUp",
    queue: "follow-up"
  }
]

export const resolveAgentComposerQueueState = ({
  agentsEnabled,
  isModelUpdating,
  isRequestPending
}: {
  agentsEnabled: boolean
  isModelUpdating: boolean
  isRequestPending: boolean
}): {
  canQueueMessage: boolean
  isComposerDisabled: boolean
} => {
  const canQueueMessage = agentsEnabled && isRequestPending

  return {
    canQueueMessage,
    isComposerDisabled:
      isModelUpdating || (isRequestPending && !canQueueMessage)
  }
}

export const listAgentComposerQueueActions = ({
  canQueueMessage
}: {
  canQueueMessage: boolean
}): AgentComposerQueueAction[] =>
  canQueueMessage ? [...AGENT_COMPOSER_QUEUE_ACTIONS] : []
