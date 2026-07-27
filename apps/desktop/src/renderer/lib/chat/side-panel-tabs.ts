import type { TranslationKey } from "@etyon/i18n"
import {
  File01Icon,
  FolderGitIcon,
  GitCommitIcon,
  GitCompareIcon,
  GlobeIcon,
  TerminalIcon
} from "@hugeicons/core-free-icons"
import type { Key } from "react"

/**
 * Tab sessions for the right-side panel, modelled on a browser's tab strip: a
 * surface is not a fixed slot but a session the user opens on demand, focuses,
 * and closes. The panel starts with zero tabs (the launcher empty state) and
 * only shows what has been opened.
 *
 * Pure module: no rpc/window imports, so it stays node-testable.
 */

export type PanelSurfaceKind =
  | "artifact"
  | "browser"
  | "changes"
  | "commit"
  | "files"
  | "terminal"

export type PanelTabId = string

export interface ChatPanelTab {
  id: PanelTabId
  instance: number
  kind: PanelSurfaceKind
}

export interface SidePanelTabsState {
  activeTabId: PanelTabId | null
  nextTabOrdinal: number
  openTabs: readonly ChatPanelTab[]
}

/** A fresh session starts with no tabs, so the panel opens on the launcher. */
export const EMPTY_SIDE_PANEL_TABS_STATE: SidePanelTabsState = {
  activeTabId: null,
  nextTabOrdinal: 1,
  openTabs: []
}

/** The only count badge a surface can carry today: the changed-file count. */
export type PanelSurfaceBadge = "changedFileCount"

export interface PanelSurfaceMetadata {
  badge: PanelSurfaceBadge | null
  icon: typeof GlobeIcon
  labelKey: TranslationKey
  /**
   * The letter of the surface's `Mod+<letter>` shortcut, or `null` when it has
   * none. Only Terminal (Mod+J) has one; no new shortcuts are invented here.
   */
  shortcutKey: string | null
}

/**
 * Single source of truth for how a surface presents itself. Shared by the
 * launcher, the `+` menu, the tab strip, and the collapsed floating toolbar so
 * a surface looks the same wherever it is offered.
 */
export const PANEL_SURFACE_METADATA = {
  artifact: {
    badge: null,
    icon: File01Icon,
    labelKey: "chat.projectPanel.artifactView",
    shortcutKey: null
  },
  browser: {
    badge: null,
    icon: GlobeIcon,
    labelKey: "chat.projectPanel.browserView",
    shortcutKey: null
  },
  changes: {
    badge: "changedFileCount",
    icon: GitCompareIcon,
    labelKey: "chat.projectPanel.changesView",
    shortcutKey: null
  },
  commit: {
    badge: "changedFileCount",
    icon: GitCommitIcon,
    labelKey: "chat.projectPanel.commitView",
    shortcutKey: null
  },
  files: {
    badge: null,
    icon: FolderGitIcon,
    labelKey: "chat.projectPanel.filesView",
    shortcutKey: null
  },
  terminal: {
    badge: null,
    icon: TerminalIcon,
    labelKey: "chat.projectPanel.terminalView",
    shortcutKey: "J"
  }
} as const satisfies Record<PanelSurfaceKind, PanelSurfaceMetadata>

/**
 * Surfaces the user can start from scratch, in display order. Artifacts are
 * absent on purpose: an artifact tab is opened by its card in the transcript,
 * never from an empty panel.
 */
export const PANEL_LAUNCHER_SURFACE_KINDS = [
  "files",
  "changes",
  "commit",
  "terminal",
  "browser"
] as const satisfies readonly PanelSurfaceKind[]

export const isPanelSurfaceKind = (value: Key): value is PanelSurfaceKind =>
  value === "artifact" ||
  value === "browser" ||
  value === "changes" ||
  value === "commit" ||
  value === "files" ||
  value === "terminal"

const findTabIndex = (
  openTabs: readonly ChatPanelTab[],
  id: PanelTabId
): number => openTabs.findIndex((tab) => tab.id === id)

const getNextSurfaceInstance = (
  openTabs: readonly ChatPanelTab[],
  kind: PanelSurfaceKind
): number => {
  const usedInstances = new Set(
    openTabs.filter((tab) => tab.kind === kind).map((tab) => tab.instance)
  )
  let instance = 1

  while (usedInstances.has(instance)) {
    instance += 1
  }

  return instance
}

/** Creates a new session of a launchable surface and focuses it. */
export const createPanelTab = (
  state: SidePanelTabsState,
  kind: PanelSurfaceKind
): SidePanelTabsState => {
  const id = `${kind}:${state.nextTabOrdinal}`

  return {
    activeTabId: id,
    nextTabOrdinal: state.nextTabOrdinal + 1,
    openTabs: [
      ...state.openTabs,
      {
        id,
        instance: getNextSurfaceInstance(state.openTabs, kind),
        kind
      }
    ]
  }
}

/** Focuses the primary instance of a surface, creating it when absent. */
export const openPanelTab = (
  state: SidePanelTabsState,
  kind: PanelSurfaceKind
): SidePanelTabsState => {
  const primaryTab = state.openTabs.find(
    (tab) => tab.kind === kind && tab.instance === 1
  )

  return primaryTab
    ? focusPanelTab(state, primaryTab.id)
    : createPanelTab(state, kind)
}

/** Focuses an already-open tab; unknown ids and no-op focuses keep the state. */
export const focusPanelTab = (
  state: SidePanelTabsState,
  id: PanelTabId
): SidePanelTabsState => {
  if (state.activeTabId === id || findTabIndex(state.openTabs, id) === -1) {
    return state
  }

  return {
    activeTabId: id,
    nextTabOrdinal: state.nextTabOrdinal,
    openTabs: state.openTabs
  }
}

/**
 * Removes a tab. Closing the active one hands focus to its right neighbour,
 * falling back to the left one and finally to the launcher empty state. The
 * next active id is computed together with the removal so the strip never
 * renders a `selectedKey` pointing at a tab that is already gone.
 */
export const closePanelTab = (
  state: SidePanelTabsState,
  id: PanelTabId
): SidePanelTabsState => {
  const closedIndex = findTabIndex(state.openTabs, id)

  if (closedIndex === -1) {
    return state
  }

  const openTabs = state.openTabs.toSpliced(closedIndex, 1)

  if (state.activeTabId !== id) {
    return {
      activeTabId: state.activeTabId,
      nextTabOrdinal: state.nextTabOrdinal,
      openTabs
    }
  }

  // After the removal `closedIndex` points at the right neighbour; when the
  // closed tab was last there is none, and the left neighbour is the new tail.
  const nextActiveTab = openTabs.at(closedIndex) ?? openTabs.at(-1) ?? null

  return {
    activeTabId: nextActiveTab?.id ?? null,
    nextTabOrdinal: state.nextTabOrdinal,
    openTabs
  }
}

/** Resolves the active tab without leaking lookup logic into view components. */
export const getActivePanelTab = (
  state: SidePanelTabsState
): ChatPanelTab | null =>
  state.openTabs.find((tab) => tab.id === state.activeTabId) ?? null

/**
 * The first terminal/browser keeps the historical chat-session id used by the
 * agent. Extra instances receive their own main-process resource key.
 */
export const getPanelTabRuntimeSessionId = (
  chatSessionId: string,
  tab: ChatPanelTab
): string =>
  tab.instance === 1 ? chatSessionId : `${chatSessionId}:panel:${tab.id}`
