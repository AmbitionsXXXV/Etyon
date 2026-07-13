import type { AgentCheckpoint } from "@etyon/rpc"
import { useSyncExternalStore } from "react"

import { findRestorableCheckpoint } from "@/renderer/lib/chat/checkpoint-restore"

/**
 * Two tiny external stores that let tool-trace rows expose a "restore to before
 * this" affordance without importing rpc/window (repo convention for node-safe
 * chat modules — see project-panel-navigation). The rpc host owns the fetch and
 * mutation; rows only read the published index and raise a restore request.
 */

interface CheckpointIndexSnapshot {
  checkpoints: readonly AgentCheckpoint[]
  sessionId: null | string
}

const EMPTY_INDEX: CheckpointIndexSnapshot = {
  checkpoints: [],
  sessionId: null
}

let indexSnapshot: CheckpointIndexSnapshot = EMPTY_INDEX
const indexListeners = new Set<() => void>()

const emitIndex = (): void => {
  for (const listener of indexListeners) {
    listener()
  }
}

/** Publishes the active session's checkpoints for tool rows to resolve against. */
export const setSessionCheckpoints = (
  sessionId: string,
  checkpoints: readonly AgentCheckpoint[]
): void => {
  indexSnapshot = { checkpoints, sessionId }
  emitIndex()
}

/** Clears the index when the owning session unmounts or changes. */
export const clearSessionCheckpoints = (sessionId: string): void => {
  if (indexSnapshot.sessionId !== sessionId) {
    return
  }

  indexSnapshot = EMPTY_INDEX
  emitIndex()
}

const subscribeIndex = (listener: () => void): (() => void) => {
  indexListeners.add(listener)

  return () => {
    indexListeners.delete(listener)
  }
}

const getIndexSnapshot = (): CheckpointIndexSnapshot => indexSnapshot

/** Latest index, exposed for direct (non-React) assertions in tests. */
export const getCheckpointIndexSnapshot = getIndexSnapshot

/**
 * Resolves the restorable checkpoint for a tool row from the published index, or
 * `null` when the row has no capture. The server/test snapshot is the empty
 * index, so node renders (which never populate the store) omit the affordance.
 */
export const useRestorableCheckpoint = (
  toolCallId: string
): AgentCheckpoint | null => {
  const snapshot = useSyncExternalStore(
    subscribeIndex,
    getIndexSnapshot,
    getIndexSnapshot
  )

  return findRestorableCheckpoint(snapshot.checkpoints, toolCallId)
}

let pendingRestore: AgentCheckpoint | null = null
const pendingListeners = new Set<() => void>()

const emitPending = (): void => {
  for (const listener of pendingListeners) {
    listener()
  }
}

/** A tool row asks the host to confirm restoring this checkpoint. */
export const requestCheckpointRestore = (checkpoint: AgentCheckpoint): void => {
  pendingRestore = checkpoint
  emitPending()
}

/** Drops the pending restore once the dialog closes. */
export const clearCheckpointRestore = (): void => {
  if (pendingRestore === null) {
    return
  }

  pendingRestore = null
  emitPending()
}

const subscribePending = (listener: () => void): (() => void) => {
  pendingListeners.add(listener)

  return () => {
    pendingListeners.delete(listener)
  }
}

const getPendingRestore = (): AgentCheckpoint | null => pendingRestore

/** Pending restore request, exposed for direct (non-React) assertions in tests. */
export const getPendingCheckpointRestoreSnapshot = getPendingRestore

export const usePendingCheckpointRestore = (): AgentCheckpoint | null =>
  useSyncExternalStore(subscribePending, getPendingRestore, getPendingRestore)
