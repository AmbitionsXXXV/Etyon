/**
 * Open-buffer bookkeeping for the project panel's Files tab, modelled on vim
 * buffers / editor tabs: an ordered list of open file paths plus the currently
 * active one. The panel turns every entry point (tree click, chat reveal) into
 * an {@link openProjectFileBuffer} call and renders `openPaths` as a tab strip.
 *
 * The reducers are pure and return the same state reference when nothing
 * changes, so React effects keyed on the state can cheaply bail. Like the other
 * `lib/chat` helpers this module imports nothing from `window`/rpc at load time
 * (repo convention for node-testable lib files).
 */

export interface ProjectBufferTabLabel {
  basename: string
  disambiguator: string | null
}

export interface ProjectFileBuffersState {
  activePath: string | null
  openPaths: string[]
}

interface ProjectFilePathParts {
  basename: string
  dirname: string
  parentDirName: string
}

const splitProjectFilePath = (path: string): ProjectFilePathParts => {
  const lastSlash = path.lastIndexOf("/")

  if (lastSlash === -1) {
    return { basename: path, dirname: "", parentDirName: "" }
  }

  const dirname = path.slice(0, lastSlash)
  const parentSlash = dirname.lastIndexOf("/")

  return {
    basename: path.slice(lastSlash + 1),
    dirname,
    parentDirName: parentSlash === -1 ? dirname : dirname.slice(parentSlash + 1)
  }
}

/**
 * Opens `path` as a buffer: appends it (activating it) when new, or just
 * activates it when already open. Returns the same reference when `path` is
 * already the active buffer.
 */
export const openProjectFileBuffer = (
  state: ProjectFileBuffersState,
  path: string
): ProjectFileBuffersState => {
  if (state.activePath === path) {
    return state
  }

  if (state.openPaths.includes(path)) {
    return { activePath: path, openPaths: state.openPaths }
  }

  return { activePath: path, openPaths: [...state.openPaths, path] }
}

/**
 * Closes `path`. Returns the same reference when `path` is not open. When the
 * closed buffer was active, the buffer that now sits at the closed index (its
 * former right neighbor) becomes active, else the new last buffer, else none.
 */
export const closeProjectFileBuffer = (
  state: ProjectFileBuffersState,
  path: string
): ProjectFileBuffersState => {
  const closedIndex = state.openPaths.indexOf(path)

  if (closedIndex === -1) {
    return state
  }

  const openPaths = state.openPaths.filter((openPath) => openPath !== path)

  if (state.activePath !== path) {
    return { activePath: state.activePath, openPaths }
  }

  return {
    activePath: openPaths[closedIndex] ?? openPaths.at(-1) ?? null,
    openPaths
  }
}

/**
 * Drops open buffers whose path is no longer present in `availablePaths` (e.g.
 * after a project snapshot refresh). When the active buffer survives it is
 * kept; when it was dropped, the surviving buffer nearest the old active index
 * is re-activated (first survivor at/after it, else the last survivor). Returns
 * the same reference when nothing is dropped.
 */
export const retainProjectFileBuffers = (
  state: ProjectFileBuffersState,
  availablePaths: readonly string[]
): ProjectFileBuffersState => {
  const availableSet = new Set(availablePaths)
  const openPaths = state.openPaths.filter((path) => availableSet.has(path))

  if (openPaths.length === state.openPaths.length) {
    return state
  }

  const { activePath } = state

  if (activePath === null || availableSet.has(activePath)) {
    return { activePath, openPaths }
  }

  const oldActiveIndex = state.openPaths.indexOf(activePath)
  let nextActivePath: string | null = null

  for (let index = oldActiveIndex; index < state.openPaths.length; index += 1) {
    const candidate = state.openPaths[index]

    if (candidate !== undefined && availableSet.has(candidate)) {
      nextActivePath = candidate
      break
    }
  }

  return {
    activePath: nextActivePath ?? openPaths.at(-1) ?? null,
    openPaths
  }
}

/**
 * Builds display labels for the buffer tab strip. `disambiguator` is null when
 * the basename is unique among `openPaths`. On a basename collision it is the
 * immediate parent directory name; when that still collides (same basename and
 * same parent name, different ancestors) it becomes the full parent path.
 * Root-level files use "." so the collision still reads sensibly.
 */
export const buildProjectBufferTabLabels = (
  openPaths: readonly string[]
): Map<string, ProjectBufferTabLabel> => {
  const entries = openPaths.map((path) => {
    const parts = splitProjectFilePath(path)

    return {
      basename: parts.basename,
      dirname: parts.dirname,
      parentDirName: parts.parentDirName,
      path
    }
  })
  const basenameCounts = new Map<string, number>()
  // basename -> (parent directory name -> count), used to decide whether the
  // immediate parent name alone disambiguates a basename collision. A nested
  // map avoids ambiguous joined string keys when paths contain spaces.
  const parentNameCounts = new Map<string, Map<string, number>>()

  for (const entry of entries) {
    basenameCounts.set(
      entry.basename,
      (basenameCounts.get(entry.basename) ?? 0) + 1
    )
    const parentCounts =
      parentNameCounts.get(entry.basename) ?? new Map<string, number>()

    parentCounts.set(
      entry.parentDirName,
      (parentCounts.get(entry.parentDirName) ?? 0) + 1
    )
    parentNameCounts.set(entry.basename, parentCounts)
  }

  const labels = new Map<string, ProjectBufferTabLabel>()

  for (const entry of entries) {
    if ((basenameCounts.get(entry.basename) ?? 0) <= 1) {
      labels.set(entry.path, { basename: entry.basename, disambiguator: null })
      continue
    }

    const needsFullPath =
      (parentNameCounts.get(entry.basename)?.get(entry.parentDirName) ?? 0) > 1
    const rawDisambiguator = needsFullPath ? entry.dirname : entry.parentDirName

    labels.set(entry.path, {
      basename: entry.basename,
      disambiguator: rawDisambiguator === "" ? "." : rawDisambiguator
    })
  }

  return labels
}
