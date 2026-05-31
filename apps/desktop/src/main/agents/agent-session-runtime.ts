import type { Agent } from "@/main/agents/agent"
import { toAgentRuntimeError } from "@/main/agents/agent-errors"
import { appendAgentEvent } from "@/main/agents/agent-event-store"
import type { AppDatabase } from "@/main/db"

export type AgentSessionRuntimeMode = "fork" | "import" | "new" | "resume"

export interface AgentSessionRuntimeSession {
  agent: Agent
  generation: number
  mode: AgentSessionRuntimeMode
  projectPath: string
  runId: string
  sessionId: string
}

export type AgentSessionRuntimeEvent =
  | {
      generation: number
      mode: AgentSessionRuntimeMode
      projectPath: string
      runId: string
      sessionId: string
      type: "agent_session_runtime_disposed"
    }
  | {
      generation: number
      mode: AgentSessionRuntimeMode
      projectPath: string
      runId: string
      sessionId: string
      type: "agent_session_runtime_started"
    }

export type AgentSessionRuntimeListener = (
  event: AgentSessionRuntimeEvent
) => Promise<void> | void

export interface AgentSessionRuntimeStartOptions {
  createAgent: () => Agent | Promise<Agent>
  mode: AgentSessionRuntimeMode
  projectPath: string
  runId: string
  sessionId: string
}

export interface AgentSessionRuntime {
  dispose: () => Promise<void>
  getCurrent: () => AgentSessionRuntimeSession | null
  start: (
    options: AgentSessionRuntimeStartOptions
  ) => Promise<AgentSessionRuntimeSession>
  subscribe: (listener: AgentSessionRuntimeListener) => () => void
}

const createDisposedEvent = ({
  generation,
  mode,
  projectPath,
  runId,
  sessionId
}: AgentSessionRuntimeSession): AgentSessionRuntimeEvent => ({
  generation,
  mode,
  projectPath,
  runId,
  sessionId,
  type: "agent_session_runtime_disposed"
})

const createStartedEvent = ({
  generation,
  mode,
  projectPath,
  runId,
  sessionId
}: AgentSessionRuntimeSession): AgentSessionRuntimeEvent => ({
  generation,
  mode,
  projectPath,
  runId,
  sessionId,
  type: "agent_session_runtime_started"
})

export const createAgentSessionRuntime = (): AgentSessionRuntime => {
  const listeners = new Set<AgentSessionRuntimeListener>()
  let currentSession: AgentSessionRuntimeSession | null = null
  let generation = 0
  let operationQueue: Promise<unknown> = Promise.resolve()

  const emit = async (event: AgentSessionRuntimeEvent): Promise<void> => {
    const failures: unknown[] = []

    for (const listener of listeners) {
      try {
        await listener(event)
      } catch (error) {
        failures.push(error)
      }
    }

    if (failures.length > 0) {
      throw toAgentRuntimeError({
        cause: failures[0],
        code: "hook",
        message: "Agent session runtime listener failed."
      })
    }
  }

  const disposeCurrentSession = async (): Promise<void> => {
    const session = currentSession

    if (!session) {
      return
    }

    currentSession = null
    session.agent.abort()

    try {
      await session.agent.waitForIdle()
    } catch (error) {
      throw toAgentRuntimeError({
        cause: error,
        code: "session",
        message: `Failed to dispose agent session runtime for ${session.sessionId}.`
      })
    } finally {
      await emit(createDisposedEvent(session))
    }
  }

  const enqueue = async <TValue>(
    operation: () => Promise<TValue>
  ): Promise<TValue> => {
    const previousOperation = operationQueue
    const { promise, resolve } = Promise.withResolvers<undefined>()

    operationQueue = promise

    try {
      await previousOperation
    } catch {
      // Earlier operation failures are returned to their caller; the queue still advances.
    }

    try {
      return await operation()
    } finally {
      resolve()
    }
  }

  return {
    dispose: () => enqueue(disposeCurrentSession),
    getCurrent: () => currentSession,
    start: (options) =>
      enqueue(async () => {
        await disposeCurrentSession()

        let agent: Agent

        try {
          agent = await options.createAgent()
        } catch (error) {
          throw toAgentRuntimeError({
            cause: error,
            code: "session",
            message: `Failed to create agent session runtime for ${options.sessionId}.`
          })
        }

        const session: AgentSessionRuntimeSession = {
          agent,
          generation: (generation += 1),
          mode: options.mode,
          projectPath: options.projectPath,
          runId: options.runId,
          sessionId: options.sessionId
        }

        currentSession = session
        await emit(createStartedEvent(session))

        return session
      }),
    subscribe: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    }
  }
}

export interface GetAgentSessionRuntimeOptions {
  db: AppDatabase
  projectPath: string
  sessionId: string
}

const agentSessionRuntimeCache = new Map<string, AgentSessionRuntime>()

const getAgentSessionRuntimeCacheKey = ({
  projectPath,
  sessionId
}: Pick<GetAgentSessionRuntimeOptions, "projectPath" | "sessionId">): string =>
  `${projectPath}\0${sessionId}`

const getAgentSessionRuntimeEventPayload = ({
  generation,
  mode,
  projectPath,
  sessionId
}: AgentSessionRuntimeEvent): Record<string, unknown> => ({
  generation,
  mode,
  projectPath,
  sessionId
})

export const getAgentSessionRuntime = ({
  db,
  projectPath,
  sessionId
}: GetAgentSessionRuntimeOptions): AgentSessionRuntime => {
  const cacheKey = getAgentSessionRuntimeCacheKey({
    projectPath,
    sessionId
  })
  const existingRuntime = agentSessionRuntimeCache.get(cacheKey)

  if (existingRuntime) {
    return existingRuntime
  }

  const runtime = createAgentSessionRuntime()

  runtime.subscribe(async (event) => {
    await appendAgentEvent({
      db,
      payload: getAgentSessionRuntimeEventPayload(event),
      runId: event.runId,
      type: event.type
    })
  })
  agentSessionRuntimeCache.set(cacheKey, runtime)

  return runtime
}

export const cleanupAgentSessionRuntimes = async (): Promise<void> => {
  const runtimes = [...agentSessionRuntimeCache.values()]
  const results = await Promise.allSettled(
    runtimes.map((runtime) => runtime.dispose())
  )
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )

  agentSessionRuntimeCache.clear()

  if (failure) {
    throw toAgentRuntimeError({
      cause: failure.reason,
      code: "session",
      message: "Failed to cleanup agent session runtimes."
    })
  }
}
