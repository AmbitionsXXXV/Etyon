import { SidebarUiStateSchema } from "@etyon/rpc"
import type { SidebarUiState } from "@etyon/rpc"
import { app } from "electron"
import ElectronStore from "electron-store"

import { getAppConfigDir } from "@/main/db/libsql-paths"

const SIDEBAR_UI_STATE_DIR = getAppConfigDir(app.getPath("home"))
const SIDEBAR_WIDTH_PX_MAX = 420
const SIDEBAR_WIDTH_PX_MIN = 240

const normalizeCollapsedProjectPaths = (projectPaths: string[]): string[] =>
  [...new Set(projectPaths)].toSorted()

const normalizeSidebarWidthPx = (sidebarWidthPx: number): number =>
  Math.min(SIDEBAR_WIDTH_PX_MAX, Math.max(SIDEBAR_WIDTH_PX_MIN, sidebarWidthPx))

const parseStoredSidebarUiState = (value: unknown): SidebarUiState => {
  const parsedState = SidebarUiStateSchema.parse(value ?? {})

  return {
    collapsedProjectPaths: normalizeCollapsedProjectPaths(
      parsedState.collapsedProjectPaths
    ),
    sidebarWidthPx: normalizeSidebarWidthPx(parsedState.sidebarWidthPx)
  }
}

const DEFAULTS: SidebarUiState = parseStoredSidebarUiState({})

const store = new ElectronStore({
  cwd: SIDEBAR_UI_STATE_DIR,
  defaults: { sidebarUiState: DEFAULTS },
  name: "sidebar-ui-state"
})

export const getSidebarUiState = (): SidebarUiState =>
  parseStoredSidebarUiState(store.get("sidebarUiState"))

export const setCollapsedProjectPaths = (
  collapsedProjectPaths: string[]
): SidebarUiState => {
  const nextState = parseStoredSidebarUiState({
    ...getSidebarUiState(),
    collapsedProjectPaths
  })

  store.set("sidebarUiState", nextState)

  return nextState
}

export const setSidebarWidthPx = (sidebarWidthPx: number): SidebarUiState => {
  const nextState = parseStoredSidebarUiState({
    ...getSidebarUiState(),
    sidebarWidthPx: normalizeSidebarWidthPx(sidebarWidthPx)
  })

  store.set("sidebarUiState", nextState)

  return nextState
}
