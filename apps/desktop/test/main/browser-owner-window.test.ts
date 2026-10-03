import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  disposeAllBrowserViews,
  disposeBrowserView,
  ensureBrowserView,
  withPaintableBrowserView
} from "@/main/browser/manager"

const createOwner = () => ({
  contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  isDestroyed: vi.fn(() => false),
  isFocused: vi.fn(() => true)
})
const state = vi.hoisted(() => ({
  owner: null as ReturnType<typeof createOwner> | null
}))
vi.mock("@/main/window", () => ({ getMainWindow: () => state.owner }))
vi.mock("@/main/logger", () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))
vi.mock("@/main/server/server-url", () => ({ getServerUrl: () => "" }))
vi.mock("electron", () => ({
  session: {
    fromPartition: () => ({
      on: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() }
    })
  },
  WebContentsView: class {
    bounds = { height: 0, width: 0, x: 0, y: 0 }
    visible = false
    webContents = {
      close: vi.fn(),
      getTitle: () => "",
      getURL: () => "",
      isDestroyed: () => false,
      isLoading: () => false,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      on: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
    getBounds() {
      return this.bounds
    }
    setBounds(bounds: typeof this.bounds) {
      this.bounds = bounds
    }
    setVisible(visible: boolean) {
      this.visible = visible
    }
  }
}))

afterEach(() => {
  disposeAllBrowserViews()
  state.owner = null
})

describe("embedded browser ownership", () => {
  it("provides the creation window to paintable operations even when the global main window changes", async () => {
    const first = createOwner()
    const other = createOwner()
    state.owner = first
    ensureBrowserView({ sessionId: "owner-a" })
    state.owner = other
    const callback = vi.fn((_view, owner) => Promise.resolve(owner))
    expect(await withPaintableBrowserView("owner-a", callback)).toBe(first)
    expect(first.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(other.contentView.addChildView).not.toHaveBeenCalled()
    disposeBrowserView("owner-a")
    expect(first.contentView.removeChildView).toHaveBeenCalledTimes(1)
    expect(other.contentView.removeChildView).not.toHaveBeenCalled()
  })

  it("does not use a newly focused window as the owner of an orphaned child view", async () => {
    state.owner = null
    ensureBrowserView({ sessionId: "unowned" })
    state.owner = createOwner()
    expect(
      await withPaintableBrowserView("unowned", (_view, owner) =>
        Promise.resolve(owner)
      )
    ).toBeNull()
  })
})
