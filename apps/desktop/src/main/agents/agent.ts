import { runAgentLoop } from "@/main/agents/agent-loop"
import type {
  AgentLoopEvent,
  AgentLoopMessage,
  AgentLoopModel,
  AgentLoopResources,
  AgentLoopTool,
  AgentLoopUserMessage,
  RunAgentLoopResult
} from "@/main/agents/agent-loop"
import { createAgentRuntimeState } from "@/main/agents/agent-state"
import type {
  AgentRuntimePhaseHandle,
  AgentRuntimePhase,
  AgentRuntimeState
} from "@/main/agents/agent-state"
import { formatPromptTemplateInvocation } from "@/main/agents/prompt-templates"
import type { PromptTemplate } from "@/main/agents/prompt-templates"

export { AgentRuntimeError } from "@/main/agents/agent-errors"

export interface AgentSnapshot {
  activeToolNames?: readonly string[]
  messages: readonly AgentLoopMessage[]
  phase: AgentRuntimePhase
  resources?: AgentLoopResources
  systemPrompt: string
  thinkingLevel?: string
  tools: Readonly<Record<string, AgentLoopTool>>
}

export type AgentListener = (snapshot: AgentSnapshot) => Promise<void> | void

export type AgentQueueDrainMode = "all" | "one-at-a-time"
export type AgentQueueName = "follow-up" | "steer"

export interface AgentQueuedMessage {
  content: string
  queue: AgentQueueName
}

export type AgentQueuedMessageListener = (
  queuedMessage: AgentQueuedMessage
) => Promise<void> | void

export interface CreateAgentOptions {
  activeToolNames?: readonly string[]
  followUpDrainMode?: AgentQueueDrainMode
  initialQueuedMessages?: readonly AgentQueuedMessage[]
  maxTurns: number
  messages?: readonly AgentLoopMessage[]
  model: AgentLoopModel
  onEvent?: (event: AgentLoopEvent) => Promise<void> | void
  onQueuedMessage?: AgentQueuedMessageListener
  resources?: AgentLoopResources
  steeringDrainMode?: AgentQueueDrainMode
  systemPrompt?: string
  thinkingLevel?: string
  tools: Readonly<Record<string, AgentLoopTool>>
}

export interface Agent {
  abort: () => void
  continue: () => Promise<RunAgentLoopResult>
  followUp: (content: string) => void
  getSnapshot: () => AgentSnapshot
  prompt: (content: string) => Promise<RunAgentLoopResult>
  promptFromTemplate: (
    template: PromptTemplate,
    args: readonly string[]
  ) => Promise<RunAgentLoopResult>
  setActiveToolNames: (activeToolNames?: readonly string[]) => void
  setModel: (model: AgentLoopModel) => void
  setResources: (resources?: AgentLoopResources) => void
  setSystemPrompt: (systemPrompt: string) => void
  setThinkingLevel: (thinkingLevel?: string) => void
  setTools: (tools: Readonly<Record<string, AgentLoopTool>>) => void
  steer: (content: string) => void
  subscribe: (listener: AgentListener) => () => void
  waitForIdle: () => Promise<void>
}

interface AgentMutableState {
  activeToolNames?: readonly string[]
  messages: AgentLoopMessage[]
  model: AgentLoopModel
  resources?: AgentLoopResources
  systemPrompt: string
  thinkingLevel?: string
  tools: Readonly<Record<string, AgentLoopTool>>
}

const cloneAgentMessages = (
  messages: readonly AgentLoopMessage[]
): AgentLoopMessage[] => [...messages]

const cloneActiveToolNames = (
  activeToolNames: readonly string[] | undefined
): string[] | undefined => (activeToolNames ? [...activeToolNames] : undefined)

const cloneAgentResources = (
  resources: AgentLoopResources | undefined
): AgentLoopResources | undefined => (resources ? { ...resources } : undefined)

const drainAgentLoopUserMessageQueue = (
  queue: AgentLoopUserMessage[],
  mode: AgentQueueDrainMode
): AgentLoopUserMessage[] =>
  mode === "one-at-a-time" ? queue.splice(0, 1) : queue.splice(0)

const createQueuedLoopUserMessages = ({
  initialQueuedMessages,
  queue
}: {
  initialQueuedMessages: readonly AgentQueuedMessage[]
  queue: AgentQueueName
}): AgentLoopUserMessage[] =>
  initialQueuedMessages
    .filter((queuedMessage) => queuedMessage.queue === queue)
    .map(({ content }) => ({
      content,
      role: "user"
    }))

const createAgentSnapshot = ({
  runtimeState,
  state
}: {
  runtimeState: AgentRuntimeState
  state: AgentMutableState
}): AgentSnapshot => ({
  activeToolNames: cloneActiveToolNames(state.activeToolNames),
  messages: cloneAgentMessages(state.messages),
  phase: runtimeState.getSnapshot().phase,
  resources: cloneAgentResources(state.resources),
  systemPrompt: state.systemPrompt,
  thinkingLevel: state.thinkingLevel,
  tools: {
    ...state.tools
  }
})

const prependSystemPrompt = ({
  messages,
  systemPrompt
}: {
  messages: readonly AgentLoopMessage[]
  systemPrompt: string
}): AgentLoopMessage[] => {
  if (!systemPrompt.trim()) {
    return cloneAgentMessages(messages)
  }

  return [
    {
      content: systemPrompt,
      role: "system"
    },
    ...messages
  ]
}

const stripSystemPrompt = ({
  messages,
  systemPrompt
}: {
  messages: readonly AgentLoopMessage[]
  systemPrompt: string
}): AgentLoopMessage[] => {
  const [firstMessage] = messages

  if (
    systemPrompt.trim() &&
    firstMessage?.role === "system" &&
    firstMessage.content === systemPrompt
  ) {
    return cloneAgentMessages(messages.slice(1))
  }

  return cloneAgentMessages(messages)
}

export const createAgent = ({
  activeToolNames,
  followUpDrainMode = "all",
  initialQueuedMessages = [],
  maxTurns,
  messages = [],
  model,
  onEvent,
  onQueuedMessage,
  resources,
  steeringDrainMode = "all",
  systemPrompt = "",
  thinkingLevel,
  tools
}: CreateAgentOptions): Agent => {
  const followUpQueue = createQueuedLoopUserMessages({
    initialQueuedMessages,
    queue: "follow-up"
  })
  const runtimeState = createAgentRuntimeState()
  const listeners = new Set<AgentListener>()
  const pendingNotifications = new Set<Promise<void>>()
  const steeringQueue = createQueuedLoopUserMessages({
    initialQueuedMessages,
    queue: "steer"
  })
  let activeAbortController: AbortController | null = null
  let activeTurnPromise: null | Promise<RunAgentLoopResult> = null
  const state: AgentMutableState = {
    activeToolNames: cloneActiveToolNames(activeToolNames),
    messages: cloneAgentMessages(messages),
    model,
    resources: cloneAgentResources(resources),
    systemPrompt,
    thinkingLevel,
    tools
  }

  const getSnapshot = (): AgentSnapshot =>
    createAgentSnapshot({
      runtimeState,
      state
    })

  const notifyListeners = async (): Promise<void> => {
    const snapshot = getSnapshot()

    for (const listener of listeners) {
      try {
        await listener(snapshot)
      } catch {
        // Listener failures should not affect agent turn execution.
      }
    }
  }

  const settleNotification = async (
    notification: Promise<void>
  ): Promise<void> => {
    try {
      await notification
    } finally {
      pendingNotifications.delete(notification)
    }
  }

  const trackNotification = (notification: Promise<void>): void => {
    pendingNotifications.add(notification)
    void settleNotification(notification)
  }

  const waitForPendingNotifications = async (): Promise<void> => {
    while (pendingNotifications.size > 0) {
      await Promise.allSettled(pendingNotifications)
    }
  }

  const clearActiveTurnAfterSettlement = async (
    turnPromise: Promise<RunAgentLoopResult>
  ): Promise<void> => {
    try {
      await turnPromise
    } catch {
      // The caller receives the turn failure; this task only clears bookkeeping.
    }

    if (activeTurnPromise === turnPromise) {
      activeTurnPromise = null
    }
  }

  const notifyListenersWithoutAwait = (): void => {
    trackNotification(notifyListeners())
  }

  const notifyQueuedMessage = async (
    queuedMessage: AgentQueuedMessage
  ): Promise<void> => {
    try {
      await onQueuedMessage?.(queuedMessage)
    } catch {
      // Queue write failures should not break interactive queueing.
    }
  }

  const trackQueuedMessageWrite = (queuedMessage: AgentQueuedMessage): void => {
    if (onQueuedMessage) {
      trackNotification(notifyQueuedMessage(queuedMessage))
    }
  }

  const drainFollowUpQueue = (): AgentLoopUserMessage[] =>
    drainAgentLoopUserMessageQueue(followUpQueue, followUpDrainMode)

  const drainSteeringQueue = (): AgentLoopUserMessage[] =>
    drainAgentLoopUserMessageQueue(steeringQueue, steeringDrainMode)

  const executeTurn = async ({
    abortController,
    nextUserMessage,
    phase
  }: {
    abortController: AbortController
    nextUserMessage?: AgentLoopMessage
    phase: AgentRuntimePhaseHandle
  }): Promise<RunAgentLoopResult> => {
    const turnModel = state.model
    const turnResources = cloneAgentResources(state.resources)
    const turnSystemPrompt = state.systemPrompt
    const turnThinkingLevel = state.thinkingLevel
    const turnActiveToolNames = cloneActiveToolNames(state.activeToolNames)
    const turnTools = {
      ...state.tools
    }
    let activeSystemPrompt = turnSystemPrompt

    activeAbortController = abortController

    try {
      if (nextUserMessage) {
        state.messages.push(nextUserMessage)
      }

      await notifyListeners()

      const result = await runAgentLoop({
        abortSignal: abortController.signal,
        activeToolNames: turnActiveToolNames,
        getFollowUpMessages: drainFollowUpQueue,
        getSteeringMessages: drainSteeringQueue,
        maxTurns,
        messages: prependSystemPrompt({
          messages: state.messages,
          systemPrompt: turnSystemPrompt
        }),
        model: turnModel,
        onEvent,
        prepareNextTurn: ({ messages: loopMessages }) => {
          const nextMessagesWithoutSystem = stripSystemPrompt({
            messages: loopMessages,
            systemPrompt: activeSystemPrompt
          })

          activeSystemPrompt = state.systemPrompt

          return {
            activeToolNames: cloneActiveToolNames(state.activeToolNames),
            messages: prependSystemPrompt({
              messages: nextMessagesWithoutSystem,
              systemPrompt: activeSystemPrompt
            }),
            model: state.model,
            resources: cloneAgentResources(state.resources),
            thinkingLevel: state.thinkingLevel,
            tools: {
              ...state.tools
            }
          }
        },
        resources: turnResources,
        thinkingLevel: turnThinkingLevel,
        tools: turnTools
      })
      const nextMessages = stripSystemPrompt({
        messages: result.messages,
        systemPrompt: activeSystemPrompt
      })

      state.messages = nextMessages

      return {
        ...result,
        messages: nextMessages
      }
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null
      }

      phase.end()
      await notifyListeners()
    }
  }

  const runTurn = (
    nextUserMessage?: AgentLoopMessage
  ): Promise<RunAgentLoopResult> => {
    let phase: AgentRuntimePhaseHandle

    try {
      phase = runtimeState.beginPhase("turn")
    } catch (error) {
      return Promise.reject(error)
    }

    const abortController = new AbortController()
    const turnPromise = executeTurn({
      abortController,
      nextUserMessage,
      phase
    })

    activeTurnPromise = turnPromise
    void clearActiveTurnAfterSettlement(turnPromise)

    return turnPromise
  }

  const waitForIdle = async (): Promise<void> => {
    while (true) {
      const turnPromise = activeTurnPromise

      if (turnPromise) {
        try {
          await turnPromise
        } catch {
          // waitForIdle observes settlement only; callers handle turn failures.
        }

        continue
      }

      await runtimeState.waitForIdle()
      await waitForPendingNotifications()

      if (
        activeTurnPromise === null &&
        pendingNotifications.size === 0 &&
        runtimeState.getSnapshot().phase === "idle"
      ) {
        return
      }
    }
  }

  return {
    abort: () => {
      activeAbortController?.abort()
    },
    continue: () => runTurn(),
    followUp: (content) => {
      followUpQueue.push({
        content,
        role: "user"
      })
      trackQueuedMessageWrite({
        content,
        queue: "follow-up"
      })
    },
    getSnapshot,
    prompt: (content) => {
      const userMessage: AgentLoopMessage = {
        content,
        role: "user"
      }

      return runTurn(userMessage)
    },
    promptFromTemplate: (template, args) =>
      runTurn({
        content: formatPromptTemplateInvocation(template, args),
        role: "user"
      }),
    setActiveToolNames: (nextActiveToolNames) => {
      state.activeToolNames = cloneActiveToolNames(nextActiveToolNames)
      notifyListenersWithoutAwait()
    },
    setModel: (nextModel) => {
      state.model = nextModel
      notifyListenersWithoutAwait()
    },
    setResources: (nextResources) => {
      state.resources = cloneAgentResources(nextResources)
      notifyListenersWithoutAwait()
    },
    setSystemPrompt: (nextSystemPrompt) => {
      state.systemPrompt = nextSystemPrompt
      notifyListenersWithoutAwait()
    },
    setThinkingLevel: (nextThinkingLevel) => {
      state.thinkingLevel = nextThinkingLevel
      notifyListenersWithoutAwait()
    },
    setTools: (nextTools) => {
      state.tools = nextTools
      notifyListenersWithoutAwait()
    },
    steer: (content) => {
      steeringQueue.push({
        content,
        role: "user"
      })
      trackQueuedMessageWrite({
        content,
        queue: "steer"
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    waitForIdle
  }
}
