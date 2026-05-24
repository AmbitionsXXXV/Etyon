import { AgentRuntimeError } from "@/main/agents/agent-errors"
import type { AgentRuntimeErrorCode } from "@/main/agents/agent-errors"

export { AgentRuntimeError }
export type { AgentRuntimeErrorCode }

export type AgentRuntimePhase =
  | "branch_summary"
  | "compaction"
  | "idle"
  | "retry"
  | "turn"

export interface AgentRuntimeSnapshot {
  phase: AgentRuntimePhase
}

export interface AgentRuntimePhaseHandle {
  end: () => void
}

export type AgentRuntimeStateListener = (
  snapshot: AgentRuntimeSnapshot
) => Promise<void> | void

export interface AgentRuntimeState {
  beginPhase: (
    phase: Exclude<AgentRuntimePhase, "idle">
  ) => AgentRuntimePhaseHandle
  getSnapshot: () => AgentRuntimeSnapshot
  subscribe: (listener: AgentRuntimeStateListener) => () => void
  waitForIdle: () => Promise<void>
}

const createSnapshot = (phase: AgentRuntimePhase): AgentRuntimeSnapshot => ({
  phase
})

const notifyAgentRuntimeStateListener = async (
  listener: AgentRuntimeStateListener,
  snapshot: AgentRuntimeSnapshot
): Promise<void> => {
  try {
    await listener(snapshot)
  } catch {
    // Subscriber failures should not block runtime state transitions.
  }
}

const waitForNullPromise = async (promise: Promise<null>): Promise<void> => {
  await promise
}

export const createAgentRuntimeState = (): AgentRuntimeState => {
  let phase: AgentRuntimePhase = "idle"
  const idleWaiters = new Set<() => void>()
  const listeners = new Set<AgentRuntimeStateListener>()
  const pendingNotifications = new Set<Promise<void>>()

  const getSnapshot = (): AgentRuntimeSnapshot => createSnapshot(phase)

  const resolveIdleWaiters = (): void => {
    if (phase !== "idle" || pendingNotifications.size > 0) {
      return
    }

    for (const resolve of idleWaiters) {
      resolve()
    }

    idleWaiters.clear()
  }

  const settleNotification = async (
    notification: Promise<void>
  ): Promise<void> => {
    try {
      await notification
    } finally {
      pendingNotifications.delete(notification)
      resolveIdleWaiters()
    }
  }

  const trackNotification = (notification: Promise<void>): void => {
    pendingNotifications.add(notification)
    void settleNotification(notification)
  }

  const notify = (): void => {
    const snapshot = getSnapshot()

    for (const listener of listeners) {
      trackNotification(notifyAgentRuntimeStateListener(listener, snapshot))
    }

    resolveIdleWaiters()
  }

  const setPhase = (nextPhase: AgentRuntimePhase): void => {
    phase = nextPhase
    notify()
  }

  return {
    beginPhase: (nextPhase) => {
      if (phase !== "idle") {
        throw new AgentRuntimeError("busy", "Agent runtime is busy.")
      }

      let ended = false

      setPhase(nextPhase)

      return {
        end: () => {
          if (ended) {
            return
          }

          ended = true
          setPhase("idle")
        }
      }
    },
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    waitForIdle: () => {
      if (phase === "idle" && pendingNotifications.size === 0) {
        return Promise.resolve()
      }

      const { promise, resolve } = Promise.withResolvers<null>()
      idleWaiters.add(() => {
        resolve(null)
      })

      return waitForNullPromise(promise)
    }
  }
}
