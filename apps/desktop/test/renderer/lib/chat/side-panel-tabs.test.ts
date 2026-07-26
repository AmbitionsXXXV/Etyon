import { describe, expect, it } from "vite-plus/test"

import {
  closePanelTab,
  EMPTY_SIDE_PANEL_TABS_STATE,
  focusPanelTab,
  getUnopenedPanelSurfaces,
  isPanelSurfaceKind,
  openPanelTab,
  PANEL_LAUNCHER_SURFACE_KINDS,
  PANEL_SURFACE_METADATA
} from "@/renderer/lib/chat/side-panel-tabs"
import type {
  PanelSurfaceKind,
  SidePanelTabsState
} from "@/renderer/lib/chat/side-panel-tabs"

const buildState = (
  openKinds: readonly PanelSurfaceKind[],
  activeTabId: PanelSurfaceKind | null
): SidePanelTabsState => ({
  activeTabId,
  openTabs: openKinds.map((kind) => ({ id: kind, kind }))
})

const getOpenKinds = (state: SidePanelTabsState): PanelSurfaceKind[] =>
  state.openTabs.map((tab) => tab.id)

describe("openPanelTab", () => {
  it("appends the first tab and focuses it", () => {
    const state = openPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "terminal")

    expect(state).toEqual({
      activeTabId: "terminal",
      openTabs: [{ id: "terminal", kind: "terminal" }]
    })
  })

  it("appends further tabs at the end of the strip", () => {
    const state = openPanelTab(
      openPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "files"),
      "browser"
    )

    expect(getOpenKinds(state)).toEqual(["files", "browser"])
    expect(state.activeTabId).toBe("browser")
  })

  it("only focuses a surface that is already open", () => {
    const state = openPanelTab(
      buildState(["files", "browser"], "browser"),
      "files"
    )

    expect(getOpenKinds(state)).toEqual(["files", "browser"])
    expect(state.activeTabId).toBe("files")
  })

  it("returns the same state when the open surface is already active", () => {
    const state = buildState(["files"], "files")

    expect(openPanelTab(state, "files")).toBe(state)
  })

  it("leaves the previous state untouched", () => {
    const state = buildState(["files"], "files")

    openPanelTab(state, "commit")

    expect(getOpenKinds(state)).toEqual(["files"])
  })
})

describe("focusPanelTab", () => {
  it("moves focus to another open tab", () => {
    const state = focusPanelTab(
      buildState(["files", "commit"], "files"),
      "commit"
    )

    expect(state.activeTabId).toBe("commit")
    expect(getOpenKinds(state)).toEqual(["files", "commit"])
  })

  it("returns the same state when the tab is already active", () => {
    const state = buildState(["files"], "files")

    expect(focusPanelTab(state, "files")).toBe(state)
  })

  it("ignores a surface that is not open", () => {
    const state = buildState(["files"], "files")

    expect(focusPanelTab(state, "browser")).toBe(state)
  })
})

describe("closePanelTab", () => {
  it("focuses the right neighbour when the active tab closes", () => {
    const state = closePanelTab(
      buildState(["files", "changes", "commit"], "changes"),
      "changes"
    )

    expect(getOpenKinds(state)).toEqual(["files", "commit"])
    expect(state.activeTabId).toBe("commit")
  })

  it("falls back to the left neighbour when the last tab closes", () => {
    const state = closePanelTab(
      buildState(["files", "changes", "commit"], "commit"),
      "commit"
    )

    expect(getOpenKinds(state)).toEqual(["files", "changes"])
    expect(state.activeTabId).toBe("changes")
  })

  it("returns the launcher empty state when the only tab closes", () => {
    const state = closePanelTab(buildState(["browser"], "browser"), "browser")

    expect(state).toEqual({ activeTabId: null, openTabs: [] })
  })

  it("keeps the active tab when another tab closes", () => {
    const state = closePanelTab(
      buildState(["files", "changes", "commit"], "commit"),
      "files"
    )

    expect(getOpenKinds(state)).toEqual(["changes", "commit"])
    expect(state.activeTabId).toBe("commit")
  })

  it("ignores a surface that is not open", () => {
    const state = buildState(["files"], "files")

    expect(closePanelTab(state, "terminal")).toBe(state)
  })

  it("leaves the previous state untouched", () => {
    const state = buildState(["files", "commit"], "commit")

    closePanelTab(state, "commit")

    expect(getOpenKinds(state)).toEqual(["files", "commit"])
  })
})

describe("getUnopenedPanelSurfaces", () => {
  it("lists every launcher surface when nothing is open", () => {
    expect(getUnopenedPanelSurfaces([])).toEqual([
      ...PANEL_LAUNCHER_SURFACE_KINDS
    ])
  })

  it("drops the surfaces that already have a tab", () => {
    expect(
      getUnopenedPanelSurfaces(
        buildState(["files", "browser"], "files").openTabs
      )
    ).toEqual(["changes", "commit", "terminal"])
  })

  it("returns nothing once every launcher surface is open", () => {
    expect(
      getUnopenedPanelSurfaces(
        buildState([...PANEL_LAUNCHER_SURFACE_KINDS], "files").openTabs
      )
    ).toEqual([])
  })

  it("ignores the artifact tab, which the launcher never offers", () => {
    expect(
      getUnopenedPanelSurfaces(buildState(["artifact"], "artifact").openTabs)
    ).toEqual([...PANEL_LAUNCHER_SURFACE_KINDS])
  })
})

describe("isPanelSurfaceKind", () => {
  it("accepts every metadata key", () => {
    for (const kind of Object.keys(PANEL_SURFACE_METADATA)) {
      expect(isPanelSurfaceKind(kind)).toBe(true)
    }
  })

  it("rejects unknown keys", () => {
    expect(isPanelSurfaceKind("preview")).toBe(false)
    expect(isPanelSurfaceKind(1)).toBe(false)
  })
})

describe("PANEL_SURFACE_METADATA", () => {
  it("gives Terminal the only keyboard shortcut", () => {
    const kindsWithShortcut = Object.entries(PANEL_SURFACE_METADATA)
      .filter(([, metadata]) => metadata.shortcutKey !== null)
      .map(([kind]) => kind)

    expect(kindsWithShortcut).toEqual(["terminal"])
  })

  it("badges only the surfaces that count changed files", () => {
    const kindsWithBadge = Object.entries(PANEL_SURFACE_METADATA)
      .filter(([, metadata]) => metadata.badge !== null)
      .map(([kind]) => kind)

    expect(kindsWithBadge).toEqual(["changes", "commit"])
  })
})
