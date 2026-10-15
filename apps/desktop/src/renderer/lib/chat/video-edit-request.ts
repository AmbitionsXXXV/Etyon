import { useSyncExternalStore } from "react"

import type { VideoEditRequest } from "@/shared/chat/video-tools"

/**
 * Hands an Edit / Extend from a clip card to the chat runtime, which owns
 * `sendMessage`: the card parks the request here and the runtime sends it as
 * the session's next turn (waiting while a turn is still running). Observable,
 * like the panel surface request, so it reaches an already-mounted session.
 * No window/rpc imports, so it stays node-testable.
 */

export interface PendingVideoEdit {
  edit: VideoEditRequest
  /** The user's instruction; sent as the message text. */
  prompt: string
  sessionId: string
}

let pending: PendingVideoEdit | null = null
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

export const requestVideoEdit = (request: PendingVideoEdit): void => {
  pending = request
  emit()
}

/** Reads and clears the request when it belongs to `sessionId`. */
export const takeVideoEditRequest = (
  sessionId: string
): PendingVideoEdit | null => {
  if (pending?.sessionId !== sessionId) {
    return null
  }

  const request = pending

  pending = null
  emit()

  return request
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export const usePendingVideoEdit = (): PendingVideoEdit | null =>
  useSyncExternalStore(subscribe, () => pending)
