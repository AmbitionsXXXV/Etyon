import { SidebarUiStateSchema } from "@etyon/rpc"
import type { SidebarUiState } from "@etyon/rpc"
import { app } from "electron"
import ElectronStore from "electron-store"

import { getAppConfigDir } from "@/main/db/libsql-paths"

const SIDEBAR_UI_STATE_DIR = getAppConfigDir(app.getPath("home"))
const SIDEBAR_WIDTH_PX_MAX = 420
const SIDEBAR_WIDTH_PX_MIN = 240

const createSortedRecord = (
  entries: [string, string][]
): Record<string, string> =>
  Object.fromEntries(
    entries.toSorted(([left], [right]) => left.localeCompare(right))
  )

const omitRecordKey = (
  record: Record<string, string>,
  omittedKey: string
): Record<string, string> =>
  createSortedRecord(
    Object.entries(record).filter(([entryKey]) => entryKey !== omittedKey)
  )

const normalizeCollapsedProjectPaths = (projectPaths: string[]): string[] =>
  [
    ...new Set(
      projectPaths.map((projectPath) => projectPath.trim()).filter(Boolean)
    )
  ].toSorted()

const normalizeProjectDisplayNames = (
  projectDisplayNames: Record<string, string>
): Record<string, string> =>
  createSortedRecord(
    Object.entries(projectDisplayNames)
      .map(
        ([projectPath, displayName]) =>
          [projectPath.trim(), displayName.trim()] as [string, string]
      )
      .filter(([projectPath, displayName]) => projectPath && displayName)
  )

const normalizeProjectOrder = (projectOrder: string[]): string[] => [
  ...new Set(
    projectOrder.map((projectPath) => projectPath.trim()).filter(Boolean)
  )
]

const normalizeProjectPins = (
  projectPins: Record<string, string>
): Record<string, string> =>
  createSortedRecord(
    Object.entries(projectPins)
      .map(
        ([projectPath, pinnedAt]) =>
          [projectPath.trim(), pinnedAt.trim()] as [string, string]
      )
      .filter(([projectPath, pinnedAt]) => projectPath && pinnedAt)
  )

const normalizeSidebarWidthPx = (sidebarWidthPx: number): number =>
  Math.min(SIDEBAR_WIDTH_PX_MAX, Math.max(SIDEBAR_WIDTH_PX_MIN, sidebarWidthPx))

const parseStoredSidebarUiState = (value: unknown): SidebarUiState => {
  const parsedState = SidebarUiStateSchema.parse(value ?? {})

  return {
    collapsedProjectPaths: normalizeCollapsedProjectPaths(
      parsedState.collapsedProjectPaths
    ),
    projectDisplayNames: normalizeProjectDisplayNames(
      parsedState.projectDisplayNames
    ),
    projectOrder: normalizeProjectOrder(parsedState.projectOrder),
    projectPins: normalizeProjectPins(parsedState.projectPins),
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

export const setProjectDisplayName = ({
  displayName,
  projectPath
}: {
  displayName: string
  projectPath: string
}): SidebarUiState => {
  const normalizedProjectPath = projectPath.trim()
  const normalizedDisplayName = displayName.trim()
  const projectDisplayNames = {
    ...getSidebarUiState().projectDisplayNames
  }

  if (normalizedDisplayName) {
    projectDisplayNames[normalizedProjectPath] = normalizedDisplayName

    const nextState = parseStoredSidebarUiState({
      ...getSidebarUiState(),
      projectDisplayNames
    })

    store.set("sidebarUiState", nextState)

    return nextState
  }

  const nextState = parseStoredSidebarUiState({
    ...getSidebarUiState(),
    projectDisplayNames: omitRecordKey(
      projectDisplayNames,
      normalizedProjectPath
    )
  })

  store.set("sidebarUiState", nextState)

  return nextState
}

export const setProjectPinned = ({
  pinned,
  projectPath
}: {
  pinned: boolean
  projectPath: string
}): SidebarUiState => {
  const normalizedProjectPath = projectPath.trim()
  const projectPins = { ...getSidebarUiState().projectPins }

  if (pinned) {
    projectPins[normalizedProjectPath] = new Date().toISOString()

    const nextState = parseStoredSidebarUiState({
      ...getSidebarUiState(),
      projectPins
    })

    store.set("sidebarUiState", nextState)

    return nextState
  }

  const nextState = parseStoredSidebarUiState({
    ...getSidebarUiState(),
    projectPins: omitRecordKey(projectPins, normalizedProjectPath)
  })

  store.set("sidebarUiState", nextState)

  return nextState
}

export const setProjectOrder = (projectOrder: string[]): SidebarUiState => {
  const nextState = parseStoredSidebarUiState({
    ...getSidebarUiState(),
    projectOrder
  })

  store.set("sidebarUiState", nextState)

  return nextState
}

export const removeProjectUiState = (projectPath: string): SidebarUiState => {
  const normalizedProjectPath = projectPath.trim()
  const currentState = getSidebarUiState()

  const nextState = parseStoredSidebarUiState({
    ...currentState,
    collapsedProjectPaths: currentState.collapsedProjectPaths.filter(
      (collapsedProjectPath) => collapsedProjectPath !== normalizedProjectPath
    ),
    projectDisplayNames: omitRecordKey(
      currentState.projectDisplayNames,
      normalizedProjectPath
    ),
    projectOrder: currentState.projectOrder.filter(
      (orderedProjectPath) => orderedProjectPath !== normalizedProjectPath
    ),
    projectPins: omitRecordKey(currentState.projectPins, normalizedProjectPath)
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
