import { describe, expect, it } from "vite-plus/test"

import {
  closePanelTab,
  createPanelTab,
  EMPTY_SIDE_PANEL_TABS_STATE,
  focusPanelTab,
  getActivePanelTab,
  getPanelTabRuntimeSessionId,
  isPanelSurfaceKind,
  openPanelTab,
  PANEL_SURFACE_METADATA
} from "@/renderer/lib/chat/side-panel-tabs"
import type {
  ChatPanelTab,
  PanelTabId,
  PanelSurfaceKind,
  SidePanelTabsState
} from "@/renderer/lib/chat/side-panel-tabs"

const buildState = (
  openKinds: readonly PanelSurfaceKind[],
  activeTabIndex: number | null
): SidePanelTabsState => ({
  activeTabId:
    activeTabIndex === null
      ? null
      : `${openKinds[activeTabIndex]}:${activeTabIndex + 1}`,
  nextTabOrdinal: openKinds.length + 1,
  openTabs: openKinds.map((kind, index) => ({
    id: `${kind}:${index + 1}`,
    instance:
      openKinds.slice(0, index).filter((openKind) => openKind === kind).length +
      1,
    kind
  }))
})

const getOpenKinds = (state: SidePanelTabsState): PanelSurfaceKind[] =>
  state.openTabs.map((tab) => tab.kind)

const getTabId = (state: SidePanelTabsState, index: number): PanelTabId => {
  const tab = state.openTabs[index]

  if (!tab) {
    throw new Error(`Missing tab at index ${index}`)
  }

  return tab.id
}

describe("createPanelTab", () => {
  it("creates repeatable instances of the same surface", () => {
    const firstState = createPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "browser")
    const state = createPanelTab(firstState, "browser")

    expect(state).toEqual({
      activeTabId: "browser:2",
      nextTabOrdinal: 3,
      openTabs: [
        { id: "browser:1", instance: 1, kind: "browser" },
        { id: "browser:2", instance: 2, kind: "browser" }
      ]
    })
  })

  it("reuses a free display instance without reusing a tab id", () => {
    const withTwoTabs = createPanelTab(
      createPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "terminal"),
      "terminal"
    )
    const state = createPanelTab(
      closePanelTab(withTwoTabs, "terminal:1"),
      "terminal"
    )

    expect(state.openTabs.at(-1)).toEqual({
      id: "terminal:3",
      instance: 1,
      kind: "terminal"
    })
  })
})

describe("openPanelTab", () => {
  it("appends the first tab and focuses it", () => {
    const state = openPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "terminal")

    expect(state).toEqual({
      activeTabId: "terminal:1",
      nextTabOrdinal: 2,
      openTabs: [{ id: "terminal:1", instance: 1, kind: "terminal" }]
    })
  })

  it("appends further tabs at the end of the strip", () => {
    const state = openPanelTab(
      openPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "files"),
      "browser"
    )

    expect(getOpenKinds(state)).toEqual(["files", "browser"])
    expect(state.activeTabId).toBe("browser:2")
  })

  it("focuses the primary surface without creating another tab", () => {
    const state = openPanelTab(buildState(["files", "browser"], 1), "files")

    expect(getOpenKinds(state)).toEqual(["files", "browser"])
    expect(state.activeTabId).toBe("files:1")
  })

  it("returns the same state when the open surface is already active", () => {
    const state = buildState(["files"], 0)

    expect(openPanelTab(state, "files")).toBe(state)
  })

  it("leaves the previous state untouched", () => {
    const state = buildState(["files"], 0)

    openPanelTab(state, "commit")

    expect(getOpenKinds(state)).toEqual(["files"])
  })
})

describe("focusPanelTab", () => {
  it("moves focus to another open tab", () => {
    const initialState = buildState(["files", "commit"], 0)
    const state = focusPanelTab(initialState, getTabId(initialState, 1))

    expect(state.activeTabId).toBe("commit:2")
    expect(getOpenKinds(state)).toEqual(["files", "commit"])
  })

  it("returns the same state when the tab is already active", () => {
    const state = buildState(["files"], 0)

    expect(focusPanelTab(state, "files:1")).toBe(state)
  })

  it("ignores a surface that is not open", () => {
    const state = buildState(["files"], 0)

    expect(focusPanelTab(state, "browser")).toBe(state)
  })
})

describe("closePanelTab", () => {
  it("focuses the right neighbour when the active tab closes", () => {
    const state = closePanelTab(
      buildState(["files", "changes", "commit"], 1),
      "changes:2"
    )

    expect(getOpenKinds(state)).toEqual(["files", "commit"])
    expect(state.activeTabId).toBe("commit:3")
  })

  it("falls back to the left neighbour when the last tab closes", () => {
    const state = closePanelTab(
      buildState(["files", "changes", "commit"], 2),
      "commit:3"
    )

    expect(getOpenKinds(state)).toEqual(["files", "changes"])
    expect(state.activeTabId).toBe("changes:2")
  })

  it("returns the launcher empty state when the only tab closes", () => {
    const state = closePanelTab(buildState(["browser"], 0), "browser:1")

    expect(state).toEqual({
      activeTabId: null,
      nextTabOrdinal: 2,
      openTabs: []
    })
  })

  it("keeps the active tab when another tab closes", () => {
    const state = closePanelTab(
      buildState(["files", "changes", "commit"], 2),
      "files:1"
    )

    expect(getOpenKinds(state)).toEqual(["changes", "commit"])
    expect(state.activeTabId).toBe("commit:3")
  })

  it("ignores a surface that is not open", () => {
    const state = buildState(["files"], 0)

    expect(closePanelTab(state, "terminal")).toBe(state)
  })

  it("leaves the previous state untouched", () => {
    const state = buildState(["files", "commit"], 1)

    closePanelTab(state, "commit:2")

    expect(getOpenKinds(state)).toEqual(["files", "commit"])
  })
})

describe("getActivePanelTab", () => {
  it("returns the exact active instance", () => {
    const state = createPanelTab(
      createPanelTab(EMPTY_SIDE_PANEL_TABS_STATE, "browser"),
      "browser"
    )

    expect(getActivePanelTab(state)).toEqual(state.openTabs[1])
  })

  it("returns null for the launcher state", () => {
    expect(getActivePanelTab(EMPTY_SIDE_PANEL_TABS_STATE)).toBeNull()
  })
})

describe("getPanelTabRuntimeSessionId", () => {
  const primaryTab: ChatPanelTab = {
    id: "browser:1",
    instance: 1,
    kind: "browser"
  }
  const secondaryTab: ChatPanelTab = {
    id: "browser:2",
    instance: 2,
    kind: "browser"
  }

  it("keeps the primary instance on the chat session", () => {
    expect(getPanelTabRuntimeSessionId("chat-1", primaryTab)).toBe("chat-1")
  })

  it("isolates additional instances", () => {
    expect(getPanelTabRuntimeSessionId("chat-1", secondaryTab)).toBe(
      "chat-1:panel:browser:2"
    )
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
