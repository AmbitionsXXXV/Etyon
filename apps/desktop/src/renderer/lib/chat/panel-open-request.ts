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
