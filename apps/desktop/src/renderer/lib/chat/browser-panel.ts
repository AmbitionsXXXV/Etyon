import type { BrowserState } from "@etyon/rpc"

/**
 * Embedded browser panel — sizing constants and the pure helpers the native
 * view host in `components/chat/browser-panel.tsx` needs.
 *
 * The page itself is a `WebContentsView` owned by the main process and keyed per
 * chat session (see `main/browser/manager.ts`). It is composited *over* the
 * renderer, so the panel only contributes an empty measured rectangle plus the
 * chrome around it. This module is kept import-light — a type-only `@etyon/rpc`
 * import, no `window`/rpc access — so it is safe to unit-test under node.
 */

/**
 * Minimum host size (px) before the native view is given bounds and revealed.
 * Mirrors the terminal's gate: below this the host is either hidden (0×0, the
 * collapsed panel keeps this component mounted) or mid-animation, and a native
 * view shown at such a rect flashes as a sliver in the corner.
 */
export const BROWSER_MIN_MOUNT_WIDTH_PX = 100
export const BROWSER_MIN_MOUNT_HEIGHT_PX = 48

/**
 * Throttle for bounds pushes. The resize handle drags at frame rate and every
 * tick would otherwise cross the RPC boundary; ~32ms keeps the native view
 * within roughly two frames of the DOM host without flooding the channel.
 */
export const BROWSER_BOUNDS_THROTTLE_MS = 32

/**
 * Fallback poll for the host geometry. ResizeObserver rides the frame
 * lifecycle, which pauses entirely in an occluded window (Electron background
 * throttling), and it never fires at all when the host *moves* without
 * resizing. Layout still computes in both cases, so a plain timer keeps
 * probing; the dedupe in the caller makes a settled panel a no-op.
 */
export const BROWSER_MOUNT_POLL_MS = 500

export interface BrowserSurfaceSize {
  height: number
  width: number
}

/**
 * Whether the host is laid out large enough to hand the native view a real
 * rectangle. Also the visibility gate: a view over a degenerate rect is worse
 * than no view at all, since it cannot be scrolled or dismissed.
 */
export const isBrowserSurfaceMeasurable = (size: BrowserSurfaceSize): boolean =>
  size.width >= BROWSER_MIN_MOUNT_WIDTH_PX &&
  size.height >= BROWSER_MIN_MOUNT_HEIGHT_PX

export interface BrowserSurfaceBounds {
  height: number
  width: number
  x: number
  y: number
}

/**
 * Snaps a `DOMRect` to the whole pixels the bounds schema requires (all four
 * fields are `z.number().int()`). The window is frameless with a hidden title
 * bar, so the web contents fill the window's content area from its origin and
 * the viewport-relative rect *is* the window-relative rect.
 */
export const roundBrowserSurfaceBounds = (
  rect: BrowserSurfaceBounds
): BrowserSurfaceBounds => ({
  height: Math.round(rect.height),
  width: Math.round(rect.width),
  x: Math.round(rect.x),
  y: Math.round(rect.y)
})

/** Whether the host moved or resized enough to warrant a `setBounds` push. */
export const haveBrowserSurfaceBoundsChanged = (
  previous: BrowserSurfaceBounds | null,
  next: BrowserSurfaceBounds
): boolean =>
  previous === null ||
  previous.height !== next.height ||
  previous.width !== next.width ||
  previous.x !== next.x ||
  previous.y !== next.y

const TRAILING_ROOT_SLASH_PATTERN = /\/$/u

/**
 * The address shown while the field is not being edited. Only the bare trailing
 * slash of a root URL is dropped — it carries no information and every browser
 * hides it. Everything else (scheme, query, hash, deeper paths) is preserved
 * verbatim, and callers seed the editing draft from the raw url so what is
 * edited is always the real address.
 */
export const formatBrowserAddressForDisplay = (url: string): string => {
  if (url === "") {
    return ""
  }

  try {
    const parsed = new URL(url)

    if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      return url
    }

    return url.replace(TRAILING_ROOT_SLASH_PATTERN, "")
  } catch {
    // Not a parseable URL (a half-typed address pushed back by a failed load);
    // show it as-is rather than guessing.
    return url
  }
}

/**
 * Panel states. `connecting` covers the `browser.ensure` round trip, `empty` a
 * session whose view has never navigated, `ready` a live page (the only state
 * where the native view may be revealed), and `error` a failed ensure/navigate.
 */
export type BrowserPanelStatus = "connecting" | "empty" | "error" | "ready"

export interface BrowserPanelState {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  status: BrowserPanelStatus
  title: string
  url: string
}

export type BrowserPanelAction =
  | { state: BrowserState; type: "state-received" }
  | { type: "connect-failed" }
  | { type: "connect-started" }
  | { type: "navigate-failed" }
  | { type: "navigate-started" }

export const INITIAL_BROWSER_PANEL_STATE: BrowserPanelState = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  status: "connecting",
  title: "",
  url: ""
}

/**
 * A blank url means "nothing loaded yet" only before the panel has gone live.
 * Once it is `ready`, an in-flight navigation reports a blank url for the short
 * window between `loadURL` being fired and the first `did-navigate` push —
 * bouncing back to the empty state there would tear the view host out from
 * under a load the user just started.
 */
const deriveBrowserPanelStatus = (
  previous: BrowserPanelStatus,
  url: string
): BrowserPanelStatus => {
  if (url !== "") {
    return "ready"
  }

  return previous === "ready" ? "ready" : "empty"
}

/**
 * Folds `browser.ensure` results, `browser:state` pushes, and the local
 * request lifecycle into the panel's view state. Pure and node-testable.
 */
export const browserPanelReducer = (
  state: BrowserPanelState,
  action: BrowserPanelAction
): BrowserPanelState => {
  switch (action.type) {
    case "connect-failed": {
      return { ...state, isLoading: false, status: "error" }
    }
    case "connect-started": {
      return { ...state, status: "connecting" }
    }
    case "navigate-failed": {
      return { ...state, isLoading: false, status: "error" }
    }
    case "navigate-started": {
      // Optimistic: the host must mount now so the first bounds push lands
      // before the page paints, otherwise the view flashes in at (0,0).
      return { ...state, isLoading: true, status: "ready" }
    }
    default: {
      return {
        canGoBack: action.state.canGoBack,
        canGoForward: action.state.canGoForward,
        isLoading: action.state.isLoading,
        status: deriveBrowserPanelStatus(state.status, action.state.url),
        title: action.state.title,
        url: action.state.url
      }
    }
  }
}
