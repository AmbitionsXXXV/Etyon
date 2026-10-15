import type {
  SidebarSettings,
  WorktreeSidebarCandidate,
  WorktreeSidebarSession
} from "@etyon/rpc"

/**
 * How a chat row shows its Best-of-N run and kept isolated workspaces, per
 * Settings → User Interface → Sidebar. Projects mode nests them as child rows;
 * Simple mode keeps the list flat and adds a compact badge instead.
 *
 * Pure module: no rpc/window imports, so it stays node-testable.
 */
export type SidebarWorktreeDisplay = "badge" | "hidden" | "nested"

export const getSidebarWorktreeDisplay = (
  sidebar: Pick<
    SidebarSettings,
    "mode" | "nestWorktrees" | "showWorktreeBadges"
  >
): SidebarWorktreeDisplay => {
  if (sidebar.mode === "projects") {
    return sidebar.nestWorktrees ? "nested" : "hidden"
  }
  return sidebar.showWorktreeBadges ? "badge" : "hidden"
}

const isCandidateSettled = (candidate: WorktreeSidebarCandidate): boolean =>
  candidate.state !== "pending" && candidate.state !== "running"

/** "2/3": candidates that finished out of all candidates. */
export const formatRunProgress = (
  candidates: readonly WorktreeSidebarCandidate[]
): string =>
  `${candidates.filter(isCandidateSettled).length}/${candidates.length}`

/** The run worth showing on the row, or null once it is folded away. */
export const getVisibleSidebarRun = (
  summary: WorktreeSidebarSession | undefined,
  collapseResolvedRuns: boolean
): WorktreeSidebarSession["run"] => {
  const run = summary?.run ?? null
  if (!run || (run.isResolved && collapseResolvedRuns)) {
    return null
  }
  return run
}

export interface SidebarWorktreeRule {
  descriptionKey:
    | "settings.sidebar.worktrees.collapseResolvedRuns.description"
    | "settings.sidebar.worktrees.nestWorktrees.description"
    | "settings.sidebar.worktrees.showWorktreeBadges.description"
  key: "collapseResolvedRuns" | "nestWorktrees" | "showWorktreeBadges"
  labelKey:
    | "settings.sidebar.worktrees.collapseResolvedRuns.label"
    | "settings.sidebar.worktrees.nestWorktrees.label"
    | "settings.sidebar.worktrees.showWorktreeBadges.label"
}

const rule = (key: SidebarWorktreeRule["key"]): SidebarWorktreeRule => ({
  descriptionKey: `settings.sidebar.worktrees.${key}.description`,
  key,
  labelKey: `settings.sidebar.worktrees.${key}.label`
})

/** The switches that apply to the selected sidebar mode, in display order. */
export const getSidebarWorktreeRules = (
  sidebar: Pick<SidebarSettings, "mode" | "nestWorktrees">
): SidebarWorktreeRule[] => {
  if (sidebar.mode === "simple") {
    return [rule("showWorktreeBadges"), rule("collapseResolvedRuns")]
  }
  return sidebar.nestWorktrees
    ? [rule("nestWorktrees"), rule("collapseResolvedRuns")]
    : [rule("nestWorktrees")]
}
