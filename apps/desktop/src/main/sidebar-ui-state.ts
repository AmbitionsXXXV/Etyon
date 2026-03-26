import { SidebarUiStateSchema } from "@etyon/rpc"
import type { SidebarUiState } from "@etyon/rpc"
import { app } from "electron"
import ElectronStore from "electron-store"

import { getAppConfigDir } from "@/main/db/libsql-paths"

const SIDEBAR_UI_STATE_DIR = getAppConfigDir(app.getPath("home"))

const normalizeCollapsedProjectPaths = (projectPaths: string[]): string[] =>
  [...new Set(projectPaths)].toSorted()

const parseStoredSidebarUiState = (value: unknown): SidebarUiState => {
  const parsedState = SidebarUiStateSchema.parse(value ?? {})

  return {
    collapsedProjectPaths: normalizeCollapsedProjectPaths(
      parsedState.collapsedProjectPaths
    )
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
    collapsedProjectPaths
  })

  store.set("sidebarUiState", nextState)

  return nextState
}
