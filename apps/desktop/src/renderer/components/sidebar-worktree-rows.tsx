import { useI18n } from "@etyon/i18n/react"
import type { WorktreeSidebarSession } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { GitForkIcon, Layers01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { requestPanelSurface } from "@/renderer/lib/chat/panel-open-request"
import type { PanelSurfaceRequestKind } from "@/renderer/lib/chat/panel-open-request"
import {
  formatRunProgress,
  getVisibleSidebarRun
} from "@/renderer/lib/sidebar/worktree-summary"
import type { SidebarWorktreeDisplay } from "@/renderer/lib/sidebar/worktree-summary"

const CHILD_ROW_CLASS_NAME =
  "flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-sidebar-foreground/86 outline-none transition-colors hover:bg-white/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"

const RunningSpinner = () => (
  <span
    aria-hidden
    className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent border-r-transparent motion-reduce:animate-none"
  />
)

const StatusDot = ({
  isInterrupted,
  label
}: {
  isInterrupted: boolean
  label: string
}) => (
  <span className="flex shrink-0 items-center">
    <span
      aria-hidden
      className={cn(
        "size-1.5 rounded-full",
        isInterrupted ? "bg-warning" : "bg-muted-foreground"
      )}
    />
    <span className="sr-only">{label}</span>
  </span>
)

/** What every chat row needs to draw its Best-of-N run and kept workspaces. */
export interface SidebarWorktreeView {
  collapseResolvedRuns: boolean
  display: SidebarWorktreeDisplay
  summaries: ReadonlyMap<string, WorktreeSidebarSession>
}

/**
 * Projects mode: the session's live Best-of-N candidates and kept isolated
 * workspaces as child rows under the chat. Clicking one opens the chat and its
 * matching side-panel surface.
 */
export const SessionWorktreeRows = ({
  onOpen,
  sessionId,
  view
}: {
  onOpen: (sessionId: string) => void
  sessionId: string
  view: SidebarWorktreeView | undefined
}) => {
  const { t } = useI18n()
  const summary = view?.summaries.get(sessionId)
  const run = getVisibleSidebarRun(summary, view?.collapseResolvedRuns ?? true)
  const keptCount = summary?.keptWorktreeCount ?? 0
  if (view?.display !== "nested" || (!run && keptCount === 0)) {
    return null
  }
  const openSurface = (kind: PanelSurfaceRequestKind) => {
    requestPanelSurface({ kind, sessionId })
    onOpen(sessionId)
  }
  return (
    <ul className="mt-0.5 mb-1 ml-6 space-y-px border-l border-sidebar-border pl-2">
      {run?.candidates.map((candidate) => (
        <li key={candidate.id}>
          <button
            className={CHILD_ROW_CLASS_NAME}
            onClick={() => openSurface("bestOfN")}
            type="button"
          >
            {candidate.state === "running" || candidate.state === "pending" ? (
              <RunningSpinner />
            ) : (
              <HugeiconsIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                icon={GitForkIcon}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{candidate.modelId}</span>
            {candidate.recommended ? (
              <span className="shrink-0 rounded-md bg-accent-soft px-1.5 text-[11px] font-medium text-accent-soft-foreground">
                {t("home.sidebar.worktrees.pick")}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">
                {candidate.changedFileCount === null
                  ? t(`chat.bestOfN.${candidate.state}`)
                  : t("home.sidebar.worktrees.files", {
                      count: candidate.changedFileCount
                    })}
              </span>
            )}
          </button>
        </li>
      ))}
      {keptCount > 0 ? (
        <li>
          <button
            className={CHILD_ROW_CLASS_NAME}
            onClick={() => openSurface("worktrees")}
            type="button"
          >
            <HugeiconsIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              icon={Layers01Icon}
            />
            <span className="min-w-0 flex-1 truncate">
              {t("chat.worktrees.title")}
            </span>
            {summary?.hasInterruptedWorktree ? (
              <StatusDot isInterrupted label={t("chat.worktrees.orphaned")} />
            ) : null}
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {keptCount}
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  )
}

/** Simple mode: a compact count for live runs and a dot for kept workspaces. */
export const SessionWorktreeBadge = ({
  sessionId,
  view
}: {
  sessionId: string
  view: SidebarWorktreeView | undefined
}) => {
  const { t } = useI18n()
  const summary = view?.summaries.get(sessionId)
  const run = getVisibleSidebarRun(summary, view?.collapseResolvedRuns ?? true)
  const keptCount = summary?.keptWorktreeCount ?? 0
  if (view?.display !== "badge" || (!run && keptCount === 0)) {
    return null
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {run ? (
        <span className="flex items-center gap-1 rounded-md bg-accent-soft px-1.5 text-[11px] font-medium text-accent-soft-foreground">
          <HugeiconsIcon aria-hidden className="size-3" icon={GitForkIcon} />
          <span aria-hidden>{formatRunProgress(run.candidates)}</span>
          <span className="sr-only">
            {t("home.sidebar.worktrees.runBadge", {
              progress: formatRunProgress(run.candidates)
            })}
          </span>
        </span>
      ) : null}
      {keptCount > 0 ? (
        <StatusDot
          isInterrupted={summary?.hasInterruptedWorktree ?? false}
          label={t(
            summary?.hasInterruptedWorktree
              ? "chat.worktrees.orphaned"
              : "chat.worktrees.title"
          )}
        />
      ) : null}
    </span>
  )
}
