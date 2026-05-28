import type { AgentRunTraceRun } from "@etyon/rpc"

const getRunTime = (run: AgentRunTraceRun): number => {
  const timestamp = run.finishedAt ?? run.startedAt
  const time = Date.parse(timestamp)

  return Number.isNaN(time) ? 0 : time
}

export const getLatestRecoverableAgentRun = (
  runs: readonly AgentRunTraceRun[]
): AgentRunTraceRun | null => {
  const recoverableRuns = runs.filter(
    (run) => run.status === "failed" && run.parentRunId === null
  )

  return (
    recoverableRuns.toSorted((a, b) => getRunTime(b) - getRunTime(a))[0] ?? null
  )
}
