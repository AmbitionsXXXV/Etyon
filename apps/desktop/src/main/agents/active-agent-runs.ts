interface ActiveAgentRunRecord {
  abortController: AbortController
  runId: string
}

const activeAgentRunsBySessionId = new Map<string, ActiveAgentRunRecord>()

export const registerActiveAgentRun = ({
  abortController,
  runId,
  sessionId
}: {
  abortController: AbortController
  runId: string
  sessionId: string
}): (() => void) => {
  activeAgentRunsBySessionId.set(sessionId, {
    abortController,
    runId
  })

  return () => {
    const activeRun = activeAgentRunsBySessionId.get(sessionId)

    if (activeRun?.runId === runId) {
      activeAgentRunsBySessionId.delete(sessionId)
    }
  }
}

export const stopActiveAgentRun = (sessionId: string): boolean => {
  const activeRun = activeAgentRunsBySessionId.get(sessionId)

  if (!activeRun) {
    return false
  }

  activeRun.abortController.abort()
  activeAgentRunsBySessionId.delete(sessionId)

  return true
}
