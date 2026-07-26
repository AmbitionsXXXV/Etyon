import { describe, expect, it } from "vite-plus/test"

import {
  BROWSER_MIN_MOUNT_HEIGHT_PX,
  BROWSER_MIN_MOUNT_WIDTH_PX,
  browserPanelReducer,
  formatBrowserAddressForDisplay,
  haveBrowserSurfaceBoundsChanged,
  INITIAL_BROWSER_PANEL_STATE,
  isBrowserSurfaceMeasurable,
  roundBrowserSurfaceBounds
} from "@/renderer/lib/chat/browser-panel"
import type { BrowserPanelState } from "@/renderer/lib/chat/browser-panel"

const buildBrowserState = (
  overrides: Partial<{
    canGoBack: boolean
    canGoForward: boolean
    isLoading: boolean
    title: string
    url: string
  }> = {}
) => ({
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  title: "",
  url: "",
  ...overrides
})

describe("isBrowserSurfaceMeasurable", () => {
  // The collapsed project panel keeps BrowserPanel mounted inside a hidden
  // (0×0) container, and the expand animation passes through slivers. A native
  // view revealed at either rect appears as a stray fragment over the app.
  it("rejects a hidden or collapsed host (0×0)", () => {
    expect(isBrowserSurfaceMeasurable({ height: 0, width: 0 })).toBe(false)
  })

  it("rejects mid-expansion slivers in either axis", () => {
    expect(isBrowserSurfaceMeasurable({ height: 849, width: 30 })).toBe(false)
    expect(isBrowserSurfaceMeasurable({ height: 20, width: 420 })).toBe(false)
  })

  it("accepts a settled open panel", () => {
    expect(isBrowserSurfaceMeasurable({ height: 800, width: 620 })).toBe(true)
  })

  it("treats the minimum thresholds as inclusive", () => {
    expect(
      isBrowserSurfaceMeasurable({
        height: BROWSER_MIN_MOUNT_HEIGHT_PX,
        width: BROWSER_MIN_MOUNT_WIDTH_PX
      })
    ).toBe(true)
    expect(
      isBrowserSurfaceMeasurable({
        height: BROWSER_MIN_MOUNT_HEIGHT_PX - 1,
        width: BROWSER_MIN_MOUNT_WIDTH_PX
      })
    ).toBe(false)
    expect(
      isBrowserSurfaceMeasurable({
        height: BROWSER_MIN_MOUNT_HEIGHT_PX,
        width: BROWSER_MIN_MOUNT_WIDTH_PX - 1
      })
    ).toBe(false)
  })
})

describe("roundBrowserSurfaceBounds", () => {
  // The bounds schema is all-integer; a fractional DOMRect would be rejected.
  it("rounds every field to whole pixels", () => {
    expect(
      roundBrowserSurfaceBounds({
        height: 519.5,
        width: 620.4,
        x: 764.25,
        y: 96.75
      })
    ).toEqual({ height: 520, width: 620, x: 764, y: 97 })
  })

  it("passes whole pixels through unchanged", () => {
    expect(
      roundBrowserSurfaceBounds({ height: 520, width: 620, x: 764, y: 96 })
    ).toEqual({ height: 520, width: 620, x: 764, y: 96 })
  })
})

describe("haveBrowserSurfaceBoundsChanged", () => {
  const bounds = { height: 520, width: 620, x: 764, y: 96 }

  it("treats a null previous value as changed (first measurement)", () => {
    expect(haveBrowserSurfaceBoundsChanged(null, bounds)).toBe(true)
  })

  it("is false for an identical rectangle so the poll stays a no-op", () => {
    expect(haveBrowserSurfaceBoundsChanged({ ...bounds }, bounds)).toBe(false)
  })

  it("is true when the host moves without resizing", () => {
    expect(haveBrowserSurfaceBoundsChanged({ ...bounds, x: 700 }, bounds)).toBe(
      true
    )
    expect(haveBrowserSurfaceBoundsChanged({ ...bounds, y: 60 }, bounds)).toBe(
      true
    )
  })

  it("is true when either dimension differs", () => {
    expect(
      haveBrowserSurfaceBoundsChanged({ ...bounds, width: 621 }, bounds)
    ).toBe(true)
    expect(
      haveBrowserSurfaceBoundsChanged({ ...bounds, height: 521 }, bounds)
    ).toBe(true)
  })
})

describe("formatBrowserAddressForDisplay", () => {
  it("returns an empty string for a session that never navigated", () => {
    expect(formatBrowserAddressForDisplay("")).toBe("")
  })

  it("drops the bare trailing slash of a root url", () => {
    expect(formatBrowserAddressForDisplay("https://example.com/")).toBe(
      "https://example.com"
    )
  })

  it("keeps a trailing slash that terminates a real path", () => {
    expect(formatBrowserAddressForDisplay("https://example.com/docs/")).toBe(
      "https://example.com/docs/"
    )
  })

  it("preserves query strings and fragments on a root url", () => {
    expect(formatBrowserAddressForDisplay("https://example.com/?q=1")).toBe(
      "https://example.com/?q=1"
    )
    expect(formatBrowserAddressForDisplay("https://example.com/#top")).toBe(
      "https://example.com/#top"
    )
  })

  it("passes unparseable addresses through untouched", () => {
    expect(formatBrowserAddressForDisplay("not a url")).toBe("not a url")
  })
})

describe("browserPanelReducer", () => {
  it("starts in the connecting state with no navigation affordances", () => {
    expect(INITIAL_BROWSER_PANEL_STATE).toEqual({
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      status: "connecting",
      title: "",
      url: ""
    })
  })

  it("resolves an ensure with no url into the empty state", () => {
    const next = browserPanelReducer(INITIAL_BROWSER_PANEL_STATE, {
      state: buildBrowserState(),
      type: "state-received"
    })

    expect(next.status).toBe("empty")
  })

  it("resolves an ensure with a url into the ready state", () => {
    const next = browserPanelReducer(INITIAL_BROWSER_PANEL_STATE, {
      state: buildBrowserState({
        canGoBack: true,
        title: "Example",
        url: "https://example.com/"
      }),
      type: "state-received"
    })

    expect(next).toEqual({
      canGoBack: true,
      canGoForward: false,
      isLoading: false,
      status: "ready",
      title: "Example",
      url: "https://example.com/"
    })
  })

  it("mounts the view host optimistically when a navigation starts", () => {
    const empty = browserPanelReducer(INITIAL_BROWSER_PANEL_STATE, {
      state: buildBrowserState(),
      type: "state-received"
    })
    const next = browserPanelReducer(empty, { type: "navigate-started" })

    expect(next.status).toBe("ready")
    expect(next.isLoading).toBe(true)
  })

  // `browser.navigate` returns before `loadURL` settles, so its state can still
  // carry a blank url. Falling back to the empty state there would unmount the
  // host out from under the load the user just started.
  it("stays ready when a live view reports a blank url mid-navigation", () => {
    const navigating = browserPanelReducer(
      { ...INITIAL_BROWSER_PANEL_STATE, status: "empty" },
      { type: "navigate-started" }
    )
    const next = browserPanelReducer(navigating, {
      state: buildBrowserState({ isLoading: true }),
      type: "state-received"
    })

    expect(next.status).toBe("ready")
  })

  it("tracks pushed navigation state while ready", () => {
    const ready: BrowserPanelState = {
      canGoBack: false,
      canGoForward: false,
      isLoading: true,
      status: "ready",
      title: "",
      url: "https://example.com/"
    }
    const next = browserPanelReducer(ready, {
      state: buildBrowserState({
        canGoBack: true,
        canGoForward: true,
        isLoading: false,
        title: "Docs",
        url: "https://example.com/docs"
      }),
      type: "state-received"
    })

    expect(next).toEqual({
      canGoBack: true,
      canGoForward: true,
      isLoading: false,
      status: "ready",
      title: "Docs",
      url: "https://example.com/docs"
    })
  })

  it("moves to the error state when ensure or navigate fails", () => {
    expect(
      browserPanelReducer(INITIAL_BROWSER_PANEL_STATE, {
        type: "connect-failed"
      }).status
    ).toBe("error")

    const navigating = browserPanelReducer(INITIAL_BROWSER_PANEL_STATE, {
      type: "navigate-started"
    })
    const failed = browserPanelReducer(navigating, { type: "navigate-failed" })

    expect(failed.status).toBe("error")
    expect(failed.isLoading).toBe(false)
  })

  it("returns to connecting on retry and recovers on the next push", () => {
    const failed = browserPanelReducer(INITIAL_BROWSER_PANEL_STATE, {
      type: "connect-failed"
    })
    const retrying = browserPanelReducer(failed, { type: "connect-started" })

    expect(retrying.status).toBe("connecting")

    const recovered = browserPanelReducer(retrying, {
      state: buildBrowserState({ url: "https://example.com/" }),
      type: "state-received"
    })

    expect(recovered.status).toBe("ready")
  })
})
