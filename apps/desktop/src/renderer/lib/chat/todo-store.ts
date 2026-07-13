import { useSyncExternalStore } from "react"

import type { ChatTodoItem } from "@/shared/chat/stream-data"

/**
 * External store for the `todo_write` tool's transient live checklist, mirroring
 * `workflow-progress-store`. The tool streams a full-replace snapshot as a
 * transient `data-todo` part through the chat stream's `onData`, keyed by run
 * id, so a work-section todo entry can read its run's latest list via `useTodos`
 * without threading props through the timeline or persisting the ticks into
 * message history. Settled runs fall back to the persisted tool-call input.
 */

const todosByRunId = new Map<string, ChatTodoItem[]>()
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

/** Publishes a run's latest full todo list (full-replace — the latest wins). */
export const setTodos = (runId: string, todos: ChatTodoItem[]): void => {
  todosByRunId.set(runId, todos)
  emit()
}

/** Drops all live todos, e.g. once a turn finishes and its snapshot goes stale. */
export const clearTodos = (): void => {
  if (todosByRunId.size === 0) {
    return
  }

  todosByRunId.clear()
  emit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Non-hook snapshot of a run's live todos (exported for testing). */
export const getTodosSnapshot = (runId?: string): ChatTodoItem[] | undefined =>
  runId === undefined ? undefined : todosByRunId.get(runId)

/** Live todo list for one run, or undefined if none has arrived. */
export const useTodos = (runId?: string): ChatTodoItem[] | undefined => {
  // The client and (test/SSR) server snapshots share one getter: the module
  // store is empty on the server, so both read the same map — this avoids
  // React's missing-server-snapshot warning (a known repo pitfall).
  const getSnapshot = (): ChatTodoItem[] | undefined => getTodosSnapshot(runId)

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
