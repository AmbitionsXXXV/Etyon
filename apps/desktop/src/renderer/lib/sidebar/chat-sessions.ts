import type { ChatSessionSummary, SidebarMode } from "@etyon/rpc"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const HOUR_IN_MS = 60 * 60 * 1000
const MINUTE_IN_MS = 60 * 1000
const PATH_SEPARATOR_PATTERN = /[\\/]+/u
export const CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS = 10_000
export const PROJECT_GROUP_PAGE_SIZE = 10

export interface ChatSessionMetaItem {
  kind: "git-diff" | "time"
  label: string
}

export interface ChatSessionGroup {
  firstCreatedAt: string
  pinnedAt: string | null
  projectName: string
  projectPath: string
  sessions: ChatSessionSummary[]
}

const isChatSessionPinned = (session: ChatSessionSummary): boolean =>
  Boolean(session.pinnedAt)

export const sortChatSessionsByLastOpenedAt = (
  sessions: ChatSessionSummary[]
): ChatSessionSummary[] =>
  [...sessions].toSorted((left, right) =>
    right.lastOpenedAt.localeCompare(left.lastOpenedAt)
  )

export const sortPinnedChatSessions = (
  sessions: ChatSessionSummary[]
): ChatSessionSummary[] =>
  sessions.filter(isChatSessionPinned).toSorted((left, right) => {
    const pinnedAtComparison = (right.pinnedAt ?? "").localeCompare(
      left.pinnedAt ?? ""
    )

    if (pinnedAtComparison !== 0) {
      return pinnedAtComparison
    }

    return right.lastOpenedAt.localeCompare(left.lastOpenedAt)
  })

export const formatChatSessionRelativeTime = (
  timestamp: string,
  now: Date = new Date()
): string => {
  const diffInMs = Math.max(0, now.getTime() - new Date(timestamp).getTime())

  if (diffInMs < HOUR_IN_MS) {
    return `${Math.max(1, Math.floor(diffInMs / MINUTE_IN_MS))}m`
  }

  if (diffInMs < DAY_IN_MS) {
    return `${Math.max(1, Math.floor(diffInMs / HOUR_IN_MS))}h`
  }

  return `${Math.max(1, Math.floor(diffInMs / DAY_IN_MS))}d`
}

export const formatGitStatusCompactLabel = (
  gitStatus: ChatSessionSummary["gitStatus"]
): string | null => {
  if (!gitStatus?.isRepository || gitStatus.changedFileCount === 0) {
    return null
  }

  const parts = [
    gitStatus.added > 0 ? `+${gitStatus.added}` : null,
    gitStatus.modified > 0 ? `~${gitStatus.modified}` : null,
    gitStatus.deleted > 0 ? `-${gitStatus.deleted}` : null,
    gitStatus.renamed > 0 ? `R${gitStatus.renamed}` : null,
    gitStatus.untracked > 0 ? `?${gitStatus.untracked}` : null
  ].filter((part): part is string => part !== null)

  return parts.join(" ")
}

export const getChatSessionTitle = ({
  fallbackTitle,
  session
}: {
  fallbackTitle: string
  session: ChatSessionSummary
}): string => session.title.trim() || fallbackTitle

export const getProjectNameFromPath = (projectPath: string): string => {
  const segments = projectPath.split(PATH_SEPARATOR_PATTERN).filter(Boolean)

  return segments.at(-1) ?? projectPath
}

export const groupChatSessionsByProject = (
  sessions: ChatSessionSummary[],
  {
    projectDisplayNames = {},
    projectOrder = [],
    projectPins = {}
  }: {
    projectDisplayNames?: Record<string, string>
    projectOrder?: string[]
    projectPins?: Record<string, string>
  } = {}
): ChatSessionGroup[] => {
  const groupedSessions = new Map<string, ChatSessionSummary[]>()

  for (const session of sortChatSessionsByLastOpenedAt(sessions)) {
    if (isChatSessionPinned(session)) {
      continue
    }

    const existingSessions = groupedSessions.get(session.projectPath) ?? []
    groupedSessions.set(session.projectPath, [...existingSessions, session])
  }

  const projectOrderIndex = new Map(
    projectOrder.map((projectPath, index) => [projectPath, index])
  )

  return [...groupedSessions.entries()]
    .map(([projectPath, groupedItems]) => {
      const firstCreatedAt = groupedItems
        .map((session) => session.createdAt)
        .toSorted((left, right) => left.localeCompare(right))
        .at(0)

      return {
        firstCreatedAt: firstCreatedAt ?? "",
        pinnedAt: projectPins[projectPath] ?? null,
        projectName:
          projectDisplayNames[projectPath]?.trim() ||
          getProjectNameFromPath(projectPath),
        projectPath,
        sessions: groupedItems
      }
    })
    .toSorted((left, right) => {
      if (left.pinnedAt && !right.pinnedAt) {
        return -1
      }

      if (!left.pinnedAt && right.pinnedAt) {
        return 1
      }

      if (left.pinnedAt && right.pinnedAt) {
        return right.pinnedAt.localeCompare(left.pinnedAt)
      }

      const leftProjectOrder = projectOrderIndex.get(left.projectPath)
      const rightProjectOrder = projectOrderIndex.get(right.projectPath)

      if (leftProjectOrder !== undefined && rightProjectOrder !== undefined) {
        return leftProjectOrder - rightProjectOrder
      }

      if (leftProjectOrder !== undefined) {
        return -1
      }

      if (rightProjectOrder !== undefined) {
        return 1
      }

      const createdAtComparison = right.firstCreatedAt.localeCompare(
        left.firstCreatedAt
      )

      if (createdAtComparison !== 0) {
        return createdAtComparison
      }

      return left.projectPath.localeCompare(right.projectPath)
    })
}

export const getChatSessionMetaItems = ({
  now,
  session
}: {
  now?: Date
  session: ChatSessionSummary
}): ChatSessionMetaItem[] => {
  const gitStatusLabel = formatGitStatusCompactLabel(session.gitStatus)

  return [
    ...(gitStatusLabel
      ? [
          {
            kind: "git-diff" as const,
            label: gitStatusLabel
          }
        ]
      : []),
    {
      kind: "time",
      label: formatChatSessionRelativeTime(session.lastOpenedAt, now)
    }
  ]
}

export const getVisibleProjectGroupSessions = ({
  sessions,
  visibleCount
}: {
  sessions: ChatSessionSummary[]
  visibleCount: number
}): ChatSessionSummary[] => sessions.slice(0, visibleCount)

export const hasHiddenProjectGroupSessions = ({
  sessions,
  visibleCount
}: {
  sessions: ChatSessionSummary[]
  visibleCount: number
}): boolean => sessions.length > visibleCount

export const shouldShowProjectGroupLessAction = ({
  sessions,
  visibleCount
}: {
  sessions: ChatSessionSummary[]
  visibleCount: number
}): boolean =>
  sessions.length > PROJECT_GROUP_PAGE_SIZE && visibleCount >= sessions.length

export const isProjectGroupExpanded = ({
  collapsedProjectPaths,
  group
}: {
  collapsedProjectPaths: string[]
  group: ChatSessionGroup
}): boolean => !collapsedProjectPaths.includes(group.projectPath)

export const reorderProjectPaths = ({
  activeProjectPath,
  overProjectPath,
  projectPaths
}: {
  activeProjectPath: string
  overProjectPath: string
  projectPaths: string[]
}): string[] => {
  const activeIndex = projectPaths.indexOf(activeProjectPath)
  const overIndex = projectPaths.indexOf(overProjectPath)

  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return projectPaths
  }

  const nextProjectPaths = [...projectPaths]
  const [activeProject] = nextProjectPaths.splice(activeIndex, 1)

  if (!activeProject) {
    return projectPaths
  }

  nextProjectPaths.splice(overIndex, 0, activeProject)

  return nextProjectPaths
}

export const isProjectsSidebarMode = (mode: SidebarMode): boolean =>
  mode === "projects"
