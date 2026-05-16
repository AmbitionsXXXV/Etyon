import type {
  GitFileStatus,
  GitProjectStatus,
  GitStatusFile,
  ProjectSnapshotItem
} from "@etyon/rpc"
import { parsePatchFiles } from "@pierre/diffs"
import type { FileDiffMetadata } from "@pierre/diffs"
import type { GitStatusEntry } from "@pierre/trees"

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

const DIFF_COUNT_FORMATTER = new Intl.NumberFormat()

const comparePath = (left: string, right: string): number =>
  left.localeCompare(right)

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

export const parseProjectDiffFiles = (patch: string): FileDiffMetadata[] => {
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
