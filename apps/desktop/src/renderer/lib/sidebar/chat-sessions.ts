import type { ChatSessionSummary, SidebarMode } from "@etyon/rpc"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const HOUR_IN_MS = 60 * 60 * 1000
const MINUTE_IN_MS = 60 * 1000
const PATH_SEPARATOR_PATTERN = /[\\/]+/u
export const PROJECT_GROUP_PAGE_SIZE = 10

export interface ChatSessionMetaItem {
  kind: "git-diff" | "time"
  label: string
}

export interface ChatSessionGroup {
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
  sessions: ChatSessionSummary[]
): ChatSessionGroup[] => {
  const groupedSessions = new Map<string, ChatSessionSummary[]>()

  for (const session of sortChatSessionsByLastOpenedAt(sessions)) {
    if (isChatSessionPinned(session)) {
      continue
    }

    const existingSessions = groupedSessions.get(session.projectPath) ?? []
    groupedSessions.set(session.projectPath, [...existingSessions, session])
  }

  return [...groupedSessions.entries()].map(([projectPath, groupedItems]) => ({
    projectName: getProjectNameFromPath(projectPath),
    projectPath,
    sessions: groupedItems
  }))
}

export const getChatSessionMetaItems = ({
  now,
  session
}: {
  now?: Date
  session: ChatSessionSummary
}): ChatSessionMetaItem[] => [
  {
    kind: "time",
    label: formatChatSessionRelativeTime(session.lastOpenedAt, now)
  }
]

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
  currentSessionId,
  group
}: {
  collapsedProjectPaths: string[]
  currentSessionId?: string
  group: ChatSessionGroup
}): boolean => {
  if (
    currentSessionId &&
    group.sessions.some((session) => session.id === currentSessionId)
  ) {
    return true
  }

  return !collapsedProjectPaths.includes(group.projectPath)
}

export const isProjectsSidebarMode = (mode: SidebarMode): boolean =>
  mode === "projects"
