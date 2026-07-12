import { useSyncExternalStore } from "react"

/**
 * A tiny external store that lets any surface in the chat flow (tool trace rows,
 * at-mention chips, diff/viewer cross-jump affordances) ask the right-side
 * project panel to reveal a file — either in the read-only Files viewer at a
 * given line, or focused on that file's diff in the Changes tab.
 *
 * Entry points call {@link requestProjectPanelReveal}; the panel wiring reads
 * the latest request via {@link useProjectPanelRevealRequest} and applies it.
 * The request carries a monotonically increasing `requestId` so the same file
 * can be requested twice in a row and still re-trigger the effect. The module
 * imports nothing from `window`/rpc at load time (repo convention for
 * node-testable lib files).
 */

export type ProjectPanelRevealView = "diff" | "file"

export interface ProjectPanelRevealRequest {
  line?: number
  path: string
  requestId: number
  view: ProjectPanelRevealView
}

let currentRequest: ProjectPanelRevealRequest | null = null
let nextRequestId = 0
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Ask the project panel to reveal `path`. Paths may be absolute or
 * project-relative — normalization against the session's project root happens
 * in the panel consumer (see {@link resolveProjectRelativePath}).
 */
export const requestProjectPanelReveal = (input: {
  line?: number
  path: string
  view: ProjectPanelRevealView
}): void => {
  nextRequestId += 1
  currentRequest = {
    path: input.path,
    requestId: nextRequestId,
    view: input.view,
    ...(input.line === undefined ? {} : { line: input.line })
  }
  emit()
}

/** Drops the pending request once the panel has applied it. */
export const clearProjectPanelReveal = (): void => {
  if (currentRequest === null) {
    return
  }

  currentRequest = null
  emit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): ProjectPanelRevealRequest | null => currentRequest

/** Latest reveal request, exposed for direct (non-React) assertions in tests. */
export const getProjectPanelRevealSnapshot = getSnapshot

/** Subscribes a component to the latest reveal request. */
export const useProjectPanelRevealRequest =
  (): ProjectPanelRevealRequest | null =>
    // The client and (test/SSR) server snapshots are identical: the module
    // store is empty on the server, so both read the same value. Passing a real
    // getter for getServerSnapshot avoids React's missing-server-snapshot error.
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[/\\]/u

const toForwardSlashes = (value: string): string => value.replaceAll("\\", "/")

const isAbsolutePath = (value: string): boolean =>
  value.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)

const stripLeadingDotSlash = (value: string): string => {
  let result = value

  while (result.startsWith("./")) {
    result = result.slice(2)
  }

  return result
}

/**
 * Normalizes a file path (absolute or relative) to a project-relative path that
 * matches the tree / diff entries, or `null` when the path lies outside the
 * project and therefore cannot be revealed.
 *
 * Comparison is case-sensitive (macOS/Linux); Windows drive paths are handled
 * on a best-effort basis by unifying separators.
 */
export const resolveProjectRelativePath = ({
  path,
  projectPath
}: {
  path: string
  projectPath: string
}): string | null => {
  const trimmedPath = path.trim()

  if (trimmedPath.length === 0) {
    return null
  }

  const normalizedPath = toForwardSlashes(trimmedPath)

  if (!isAbsolutePath(normalizedPath)) {
    const relativePath = stripLeadingDotSlash(normalizedPath)

    return relativePath.length > 0 ? relativePath : null
  }

  const normalizedProjectRoot = toForwardSlashes(projectPath.trim())

  if (normalizedProjectRoot.length === 0) {
    return null
  }

  const rootWithSlash = normalizedProjectRoot.endsWith("/")
    ? normalizedProjectRoot
    : `${normalizedProjectRoot}/`

  if (!normalizedPath.startsWith(rootWithSlash)) {
    return null
  }

  const relativePath = normalizedPath.slice(rootWithSlash.length)

  return relativePath.length > 0 ? relativePath : null
}
