const CHAT_ROUTE_PATTERN = /^\/chat\/([^/]+)\/?$/u
const RECENT_SESSION_MS = 60_000

export const selectScreenAwarenessSession = ({
  assignedSessionId,
  now,
  pathname,
  sessions
}: {
  assignedSessionId?: string
  now: number
  pathname: string
  sessions: { id: string; lastOpenedAt: string; projectPath: string }[]
}): { discard?: boolean; projectPath?: string; sessionId?: string } => {
  if (assignedSessionId) {
    return sessions.some((session) => session.id === assignedSessionId)
      ? { sessionId: assignedSessionId }
      : { discard: true }
  }
  const current = CHAT_ROUTE_PATTERN.exec(pathname)?.[1]
  if (current && sessions.some((session) => session.id === current)) {
    return { sessionId: current }
  }
  const [latest] = sessions.toSorted((a, b) =>
    b.lastOpenedAt.localeCompare(a.lastOpenedAt)
  )
  if (latest && now - Date.parse(latest.lastOpenedAt) < RECENT_SESSION_MS) {
    return { sessionId: latest.id }
  }
  return { projectPath: latest?.projectPath }
}
