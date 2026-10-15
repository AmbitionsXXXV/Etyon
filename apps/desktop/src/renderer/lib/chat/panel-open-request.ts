import { useSyncExternalStore } from "react"

/**
 * A one-shot flag that hands "open the side panel" from the home page to the
 * chat route: the home trigger creates a session and navigates away before any
 * panel exists, so the intent is parked here and picked up by the chat route
 * when it mounts for the new session. The module imports nothing from
 * `window`/rpc at load time (repo convention for node-testable lib files).
 */

let isPanelOpenRequested = false

/** Asks the next chat session mount to expand the project panel. */
export const requestPanelOpen = (): void => {
  isPanelOpenRequested = true
}

/** Reads and clears the pending request; `true` means the panel should open. */
export const consumePanelOpenRequest = (): boolean => {
  const wasRequested = isPanelOpenRequested
  isPanelOpenRequested = false

  return wasRequested
}

/**
 * A request to show one session-bound surface (Best-of-N, isolated
 * workspaces) in that session's side panel. Unlike {@link requestPanelOpen}
 * it is observable, so it works both when the chat route mounts for the
 * session and when the session is already on screen.
 */
export type PanelSurfaceRequestKind = "bestOfN" | "worktrees"

export interface PanelSurfaceRequest {
  kind: PanelSurfaceRequestKind
  requestId: number
  sessionId: string
}

let currentSurfaceRequest: PanelSurfaceRequest | null = null
let nextSurfaceRequestId = 0
const surfaceListeners = new Set<() => void>()

const emitSurfaceRequest = (): void => {
  for (const listener of surfaceListeners) {
    listener()
  }
}

export const requestPanelSurface = (input: {
  kind: PanelSurfaceRequestKind
  sessionId: string
}): void => {
  nextSurfaceRequestId += 1
  currentSurfaceRequest = { ...input, requestId: nextSurfaceRequestId }
  emitSurfaceRequest()
}

export const clearPanelSurfaceRequest = (): void => {
  if (currentSurfaceRequest === null) {
    return
  }
  currentSurfaceRequest = null
  emitSurfaceRequest()
}

const subscribeSurfaceRequest = (listener: () => void): (() => void) => {
  surfaceListeners.add(listener)
  return () => {
    surfaceListeners.delete(listener)
  }
}

const getSurfaceRequestSnapshot = (): PanelSurfaceRequest | null =>
  currentSurfaceRequest

export const usePanelSurfaceRequest = (): PanelSurfaceRequest | null =>
  useSyncExternalStore(subscribeSurfaceRequest, getSurfaceRequestSnapshot)
