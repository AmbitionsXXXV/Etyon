import type {
  GitFileStatus,
  GitProjectDiffInput,
  GitProjectDiffFileSnapshot,
  GitProjectStatus,
  GitStatusFile,
  ProjectSnapshotItem
} from "@etyon/rpc"
import { parseDiffFromFile, parsePatchFiles } from "@pierre/diffs"
import type { FileDiffMetadata } from "@pierre/diffs"
import type { GitStatusEntry } from "@pierre/trees"
import type { Key } from "react"

export const PROJECT_CONTEXT_FILES_TAB_ID = "files"
export const PROJECT_CONTEXT_CHANGES_TAB_ID = "changes"
export const PROJECT_CONTEXT_COMMIT_TAB_ID = "commit"
export const PROJECT_CONTEXT_TERMINAL_TAB_ID = "terminal"
export const PROJECT_CHANGES_SCOPE_AGENT = "agent"
export const PROJECT_CHANGES_SCOPE_ALL = "all"
export type ProjectContextPanelView =
  | typeof PROJECT_CONTEXT_FILES_TAB_ID
  | typeof PROJECT_CONTEXT_CHANGES_TAB_ID
  | typeof PROJECT_CONTEXT_COMMIT_TAB_ID
  | typeof PROJECT_CONTEXT_TERMINAL_TAB_ID
export type ProjectChangesScope =
  | typeof PROJECT_CHANGES_SCOPE_AGENT
  | typeof PROJECT_CHANGES_SCOPE_ALL
export const COMMIT_MESSAGE_MAX_LENGTH = 500
export const PROJECT_FILE_TREE_DEFAULT_SIZE = 30
export const PROJECT_FILE_TREE_MAX_SIZE = 55
export const PROJECT_FILE_TREE_MIN_SIZE = 18

export const isProjectContextPanelView = (
  view: Key
): view is ProjectContextPanelView =>
  view === PROJECT_CONTEXT_FILES_TAB_ID ||
  view === PROJECT_CONTEXT_CHANGES_TAB_ID ||
  view === PROJECT_CONTEXT_COMMIT_TAB_ID ||
  view === PROJECT_CONTEXT_TERMINAL_TAB_ID

export const isProjectChangesScope = (
  scope: Key
): scope is ProjectChangesScope =>
  scope === PROJECT_CHANGES_SCOPE_AGENT || scope === PROJECT_CHANGES_SCOPE_ALL

export const getProjectGitDiffInput = ({
  agentEditedPaths,
  scope,
  sessionId
}: {
  agentEditedPaths: string[]
  scope: ProjectChangesScope
  sessionId: string
}): GitProjectDiffInput =>
  scope === PROJECT_CHANGES_SCOPE_AGENT
    ? { paths: agentEditedPaths, sessionId }
    : { sessionId }

export const shouldFetchProjectGitDiff = ({
  agentEditedPaths,
  scope
}: {
  agentEditedPaths: string[]
  scope: ProjectChangesScope
}): boolean =>
  scope === PROJECT_CHANGES_SCOPE_ALL || agentEditedPaths.length > 0

export interface ProjectDiffFileStats {
  additions: number
  deletions: number
}

export interface ProjectDiffSummary extends ProjectDiffFileStats {
  changedFileCount: number
}

export interface ProjectGitStatusSummaryItem {
  count: number
  prefix: string
  status: Exclude<GitFileStatus, "ignored">
}

interface ParseProjectDiffFilesInput {
  fileSnapshots?: readonly GitProjectDiffFileSnapshot[]
  patch: string
}

const DIFF_COUNT_FORMATTER = new Intl.NumberFormat()

const comparePath = (left: string, right: string): number =>
  left.localeCompare(right)

const getProjectPathDepth = (path: string): number =>
  path.split("/").filter(Boolean).length

export const formatProjectDiffCount = (count: number): string =>
  DIFF_COUNT_FORMATTER.format(count)

export const buildProjectGitStatusSummary = (
  gitStatus: GitProjectStatus | undefined
): ProjectGitStatusSummaryItem[] => {
  if (!gitStatus) {
    return []
  }

  const summaryItems = [
    {
      count: gitStatus.added,
      prefix: "+",
      status: "added"
    },
    {
      count: gitStatus.modified,
      prefix: "~",
      status: "modified"
    },
    {
      count: gitStatus.deleted,
      prefix: "-",
      status: "deleted"
    },
    {
      count: gitStatus.renamed,
      prefix: "R",
      status: "renamed"
    },
    {
      count: gitStatus.untracked,
      prefix: "?",
      status: "untracked"
    }
  ] satisfies ProjectGitStatusSummaryItem[]

  return summaryItems.filter((item) => item.count > 0)
}

export const getProjectDiffFileStats = (
  fileDiff: FileDiffMetadata
): ProjectDiffFileStats => {
  let additions = 0
  let deletions = 0

  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }

  return {
    additions,
    deletions
  }
}

export const getProjectDiffSummary = ({
  diffFiles,
  fallbackChangedFileCount = 0
}: {
  diffFiles: readonly FileDiffMetadata[]
  fallbackChangedFileCount?: number
}): ProjectDiffSummary => {
  let additions = 0
  let deletions = 0

  for (const fileDiff of diffFiles) {
    const stats = getProjectDiffFileStats(fileDiff)

    additions += stats.additions
    deletions += stats.deletions
  }

  return {
    additions,
    changedFileCount:
      diffFiles.length > 0 ? diffFiles.length : fallbackChangedFileCount,
    deletions
  }
}

export const buildVisibleGitStatusFiles = (
  files: readonly GitStatusFile[]
): (Omit<GitStatusFile, "status"> & {
  status: Exclude<GitFileStatus, "ignored">
})[] =>
  files
    .filter(
      (
        file
      ): file is GitStatusFile & {
        status: Exclude<GitFileStatus, "ignored">
      } => file.status !== "ignored"
    )
    .toSorted((left, right) => comparePath(left.path, right.path))

export const buildProjectTreeGitStatusEntries = (
  files: readonly GitStatusFile[]
): GitStatusEntry[] =>
  files
    .filter((file) => file.status !== "ignored")
    .map((file) => ({
      path: file.path,
      status: file.status
    }))
    .toSorted((left, right) => comparePath(left.path, right.path))

export const buildProjectTreePaths = (
  items: readonly ProjectSnapshotItem[]
): string[] =>
  items
    .filter((item) => item.kind === "file")
    .map((item) => item.relativePath)
    .toSorted(comparePath)

export const buildProjectTreeDirectoryPaths = (
  paths: readonly string[]
): string[] => {
  const directoryPaths = new Set<string>()

  for (const filePath of paths) {
    const pathSegments = filePath.split("/").filter(Boolean)

    for (let index = 1; index < pathSegments.length; index += 1) {
      directoryPaths.add(`${pathSegments.slice(0, index).join("/")}/`)
    }
  }

  return [...directoryPaths].toSorted((left, right) => {
    const depthDifference =
      getProjectPathDepth(right) - getProjectPathDepth(left)

    return depthDifference === 0 ? comparePath(left, right) : depthDifference
  })
}

const parsePatchDiffFiles = (patch: string): FileDiffMetadata[] => {
  if (!patch.trim()) {
    return []
  }

  try {
    return parsePatchFiles(patch, "project-git-diff").flatMap(
      (parsedPatch) => parsedPatch.files
    )
  } catch {
    return []
  }
}

const parseProjectDiffSnapshot = (
  snapshot: GitProjectDiffFileSnapshot
): FileDiffMetadata | null => {
  try {
    return parseDiffFromFile(
      {
        contents: snapshot.oldContent,
        name: snapshot.oldPath ?? snapshot.path
      },
      {
        contents: snapshot.newContent,
        name: snapshot.path
      }
    )
  } catch {
    return null
  }
}

const shiftSnapshotForPatchFile = ({
  patchFile,
  snapshotsByPath
}: {
  patchFile: FileDiffMetadata
  snapshotsByPath: Map<string, GitProjectDiffFileSnapshot[]>
}): GitProjectDiffFileSnapshot | undefined => {
  const snapshots = snapshotsByPath.get(patchFile.name)
  const snapshot = snapshots?.shift()

  if (snapshots?.length === 0) {
    snapshotsByPath.delete(patchFile.name)
  }

  return snapshot
}

export const parseProjectDiffFiles = (
  input: ParseProjectDiffFilesInput | string
): FileDiffMetadata[] => {
  const { fileSnapshots = [], patch } =
    typeof input === "string" ? { patch: input } : input
  const patchFiles = parsePatchDiffFiles(patch)

  if (fileSnapshots.length === 0) {
    return patchFiles
  }

  const snapshotsByPath = new Map<string, GitProjectDiffFileSnapshot[]>()

  for (const snapshot of fileSnapshots) {
    const pathSnapshots = snapshotsByPath.get(snapshot.path)

    if (pathSnapshots) {
      pathSnapshots.push(snapshot)
      continue
    }

    snapshotsByPath.set(snapshot.path, [snapshot])
  }

  if (patchFiles.length === 0) {
    return fileSnapshots
      .map(parseProjectDiffSnapshot)
      .filter((fileDiff): fileDiff is FileDiffMetadata => fileDiff !== null)
  }

  return patchFiles.map((patchFile) => {
    const snapshot = shiftSnapshotForPatchFile({
      patchFile,
      snapshotsByPath
    })
    const snapshotDiff = snapshot ? parseProjectDiffSnapshot(snapshot) : null

    return snapshotDiff ?? patchFile
  })
}
