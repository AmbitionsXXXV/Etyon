import { useSyncExternalStore } from "react"

import type { ChatWorkflowProgressData } from "@/shared/chat/stream-data"

/**
 * A tiny external store for the `workflow` tool's transient live progress.
 *
 * The progress arrives as transient (non-persisted) data parts through the chat
 * stream's `onData` callback, keyed by the workflow tool call id. Keeping it in
 * a module store — read via `useWorkflowProgress` — lets the deeply-nested tool
 * card subscribe to its own progress without threading props through the message
 * timeline or persisting ephemeral ticks into message history.
 */

const progressByToolCallId = new Map<string, ChatWorkflowProgressData>()
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

export const setWorkflowProgress = (
  toolCallId: string,
  data: ChatWorkflowProgressData
): void => {
  progressByToolCallId.set(toolCallId, data)
  emit()
}

/** Drops all progress, e.g. when a turn finishes and its ticks are stale. */
export const clearWorkflowProgress = (): void => {
  if (progressByToolCallId.size === 0) {
    return
  }

  progressByToolCallId.clear()
  emit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Live progress for one workflow tool call, or undefined if none has arrived. */
export const useWorkflowProgress = (
  toolCallId: string
): ChatWorkflowProgressData | undefined => {
  // The client and (test/SSR) server snapshots are identical: the module store
  // is empty on the server, so both read the same map. Passing a real getter for
  // getServerSnapshot avoids React's missing-server-snapshot warning.
  const getSnapshot = (): ChatWorkflowProgressData | undefined =>
    progressByToolCallId.get(toolCallId)

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
