import type {
  BestOfNRun,
  ManagedWorktree,
  WorktreeSidebarSession
} from "@etyon/rpc/schemas/worktrees"

const RESOLVED_RUN_STATES = new Set<BestOfNRun["state"]>([
  "applied",
  "cancelled"
])

/**
 * Folds every Best-of-N run and managed worktree into one row per chat session
 * that has something to show: its latest run (resolved or not — the sidebar
 * decides whether to fold resolved runs away) and the isolated workspaces that
 * are kept outside any run. Applied workspaces are history, not kept work.
 */
export const buildWorktreeSidebarSummary = (
  runs: readonly BestOfNRun[],
  worktrees: readonly ManagedWorktree[]
): WorktreeSidebarSession[] => {
  const latestRunBySession = new Map<string, BestOfNRun>()
  const candidateWorktreeIds = new Set<string>()

  for (const run of runs) {
    for (const candidate of run.candidates) {
      if (candidate.worktreeId) {
        candidateWorktreeIds.add(candidate.worktreeId)
      }
    }
    const current = latestRunBySession.get(run.sessionId)
    if (!current || run.createdAt.localeCompare(current.createdAt) > 0) {
      latestRunBySession.set(run.sessionId, run)
    }
  }

  const keptBySession = new Map<
    string,
    { count: number; interrupted: boolean }
  >()
  for (const tree of worktrees) {
    if (candidateWorktreeIds.has(tree.id) || tree.state === "applied") {
      continue
    }
    const kept = keptBySession.get(tree.sessionId) ?? {
      count: 0,
      interrupted: false
    }
    kept.count += 1
    kept.interrupted ||= tree.state === "orphaned"
    keptBySession.set(tree.sessionId, kept)
  }

  const sessionIds = new Set([
    ...latestRunBySession.keys(),
    ...keptBySession.keys()
  ])

  return [...sessionIds].toSorted().map((sessionId) => {
    const run = latestRunBySession.get(sessionId)
    const kept = keptBySession.get(sessionId)
    return {
      hasInterruptedWorktree: kept?.interrupted ?? false,
      keptWorktreeCount: kept?.count ?? 0,
      run: run
        ? {
            candidates: run.candidates.map((candidate) => ({
              changedFileCount: candidate.stats?.changedFileCount ?? null,
              id: candidate.id,
              modelId: candidate.modelId,
              recommended: run.review?.recommendedCandidateId === candidate.id,
              state: candidate.state
            })),
            id: run.id,
            isResolved: RESOLVED_RUN_STATES.has(run.state)
          }
        : null,
      sessionId
    }
  })
}
