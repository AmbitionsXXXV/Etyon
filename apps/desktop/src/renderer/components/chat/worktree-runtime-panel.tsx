import { useI18n } from "@etyon/i18n/react"
import type { AppSettings } from "@etyon/rpc"
import type { BestOfNRun, ManagedWorktree } from "@etyon/rpc/schemas/worktrees"
import { cn } from "@etyon/ui/lib/utils"
import { GitForkIcon, Layers01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { BestOfNPanel } from "@/renderer/components/chat/best-of-n-panel"
import type {
  BestOfNModelOption,
  BestOfNPanelProps
} from "@/renderer/components/chat/best-of-n-panel"
import { WorktreePanel } from "@/renderer/components/chat/worktree-panel"
import type { PanelSurfaceKind } from "@/renderer/lib/chat/side-panel-tabs"
import { MOTION_TRANSITION_FAST_CLASS } from "@/renderer/lib/motion"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import {
  resolveActiveProfile,
  resolveProfileRoster
} from "@/shared/agents/profiles"

const canStartBestOfN = (settings: AppSettings | undefined): boolean => {
  if (!settings) {
    return false
  }
  const profile = resolveActiveProfile(settings.agents)
  return (
    !profile.readonly &&
    profile.allowDelegation &&
    resolveProfileRoster(settings.agents).some(
      (candidate) =>
        candidate.available &&
        !candidate.readonly &&
        profile.allowedDelegateProfileIds.includes(candidate.id)
    )
  )
}

/**
 * Best-of-N runs and kept isolated workspaces for one chat session. Shared by
 * the header chip and the two side-panel surfaces; react-query dedupes the
 * polling, so every consumer reads the same cache.
 */
const useWorktreeRuntime = (sessionId: string) => {
  const queryClient = useQueryClient()
  const runOptions = orpc.bestOfN.list.queryOptions({
    input: { sessionId },
    refetchInterval: 3000
  })
  const treeOptions = orpc.worktrees.list.queryOptions({
    input: { sessionId },
    refetchInterval: 5000
  })
  const runs = useQuery(runOptions)
  const trees = useQuery(treeOptions)
  const runQueryKey = runOptions.queryKey
  const treeQueryKey = treeOptions.queryKey
  useEffect(
    () =>
      window.electron.ipcRenderer.on(
        "best-of-n:updated",
        (_event, payload: unknown) => {
          if (
            payload &&
            typeof payload === "object" &&
            "sessionId" in payload &&
            payload.sessionId === sessionId
          ) {
            void queryClient.invalidateQueries({ queryKey: runQueryKey })
            void queryClient.invalidateQueries({ queryKey: treeQueryKey })
          }
        }
      ),
    [queryClient, runQueryKey, sessionId, treeQueryKey]
  )
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: runQueryKey })
    await queryClient.invalidateQueries({ queryKey: treeQueryKey })
  }
  const runList: BestOfNRun[] = runs.data?.runs ?? []
  const candidateTrees = new Set(
    runList.flatMap((run) =>
      run.candidates.flatMap((candidate) =>
        candidate.worktreeId ? [candidate.worktreeId] : []
      )
    )
  )
  const independentTrees: ManagedWorktree[] = (
    trees.data?.worktrees ?? []
  ).filter((tree) => !candidateTrees.has(tree.id))
  return {
    error: runs.error ?? trees.error,
    independentTrees,
    refresh,
    runs: runList
  }
}

export const BestOfNSurface = ({
  isRunDisabled,
  models,
  onStart,
  sessionId
}: {
  isRunDisabled: boolean
  models: BestOfNModelOption[]
  onStart: BestOfNPanelProps["onStart"]
  sessionId: string
}) => {
  const { t } = useI18n()
  const { error, refresh, runs } = useWorktreeRuntime(sessionId)
  const settings = useQuery(orpc.settings.get.queryOptions({}))
  const canDelegate = canStartBestOfN(settings.data)
  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto p-4">
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error.message}
        </p>
      )}
      {!canDelegate && (
        <p className="rounded-xl bg-surface p-3 text-xs leading-5 text-muted-foreground">
          {t("chat.bestOfN.unavailable")}
        </p>
      )}
      <BestOfNPanel
        isRunDisabled={isRunDisabled || !canDelegate}
        labels={{
          applied: t("chat.bestOfN.applied"),
          apply: t("chat.bestOfN.apply"),
          cancel: t("chat.bestOfN.cancel"),
          cancelDiscard: t("chat.bestOfN.cancelDiscard"),
          confirmDiscard: t("chat.bestOfN.confirmDiscard"),
          conflicts: t("chat.bestOfN.conflicts"),
          discard: t("chat.bestOfN.discard"),
          discardConfirmation: t("chat.bestOfN.discardConfirmation"),
          empty: t("chat.bestOfN.empty"),
          discarded: t("chat.bestOfN.discarded"),
          failed: t("chat.bestOfN.failed"),
          files: t("chat.bestOfN.files"),
          modelFilter: t("chat.bestOfN.modelFilter"),
          modelLimit: t("chat.bestOfN.modelLimit"),
          models: t("chat.bestOfN.models"),
          newRun: t("chat.bestOfN.newRun"),
          noChanges: t("chat.bestOfN.noChanges"),
          pending: t("chat.bestOfN.pending"),
          preview: t("chat.bestOfN.preview"),
          prompt: t("chat.bestOfN.prompt"),
          ready: t("chat.bestOfN.ready"),
          recommendation: t("chat.bestOfN.recommendation"),
          recommended: t("chat.bestOfN.recommended"),
          running: t("chat.bestOfN.running"),
          start: t("chat.bestOfN.start"),
          title: t("chat.bestOfN.title"),
          view: t("chat.bestOfN.view")
        }}
        models={models}
        onApply={async (id, candidateId, expectedFingerprint) => {
          const result = await rpcClient.bestOfN.apply({
            candidateId,
            expectedFingerprint,
            id,
            sessionId
          })
          await refresh()
          return result
        }}
        onCancel={async (id) => {
          await rpcClient.bestOfN.cancel({ id, sessionId })
          await refresh()
        }}
        onDiscard={async (id) => {
          await rpcClient.bestOfN.discard({ id, sessionId })
          await refresh()
        }}
        onPreview={async (id, candidateId) =>
          await rpcClient.bestOfN.preview({ candidateId, id, sessionId })
        }
        onStart={onStart}
        runs={runs}
      />
    </div>
  )
}

export const WorktreesSurface = ({ sessionId }: { sessionId: string }) => {
  const { t } = useI18n()
  const { error, independentTrees, refresh } = useWorktreeRuntime(sessionId)
  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto p-4">
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error.message}
        </p>
      )}
      <WorktreePanel
        labels={{
          apply: t("chat.worktrees.apply"),
          confirmDiscard: t("chat.worktrees.confirmDiscard"),
          discard: t("chat.worktrees.discard"),
          empty: t("chat.worktrees.empty"),
          files: t("chat.worktrees.files"),
          orphaned: t("chat.worktrees.orphaned"),
          preview: t("chat.worktrees.preview"),
          title: t("chat.worktrees.title")
        }}
        onApply={async (id, expectedFingerprint) => {
          const result = await rpcClient.worktrees.apply({
            expectedFingerprint,
            id,
            sessionId
          })
          await refresh()
          return result
        }}
        onPreview={async (id) =>
          await rpcClient.worktrees.preview({ id, sessionId })
        }
        onPrune={async (id, discardChanges) => {
          await rpcClient.worktrees.prune({ discardChanges, id, sessionId })
          await refresh()
        }}
        worktrees={independentTrees}
      />
    </div>
  )
}

const getRunProgress = (run: BestOfNRun | undefined) => {
  if (!run) {
    return null
  }
  const settled = run.candidates.filter(
    (candidate) =>
      candidate.state !== "pending" && candidate.state !== "running"
  ).length
  return `${settled}/${run.candidates.length}`
}

/**
 * Header entry point for Best-of-N and isolated workspaces. Hidden until the
 * session has something to show; starting a run lives in the panel's `+` menu.
 */
export const WorktreeRuntimeChip = ({
  onOpenSurface,
  sessionId
}: {
  onOpenSurface: (
    kind: Extract<PanelSurfaceKind, "bestOfN" | "worktrees">
  ) => void
  sessionId: string
}) => {
  const { t } = useI18n()
  const { independentTrees, runs } = useWorktreeRuntime(sessionId)
  const progress = getRunProgress(runs[0])
  const treeCount = independentTrees.length
  if (!progress && treeCount === 0) {
    return null
  }
  return (
    <button
      aria-label={t("chat.worktrees.openChip")}
      className={cn(
        "flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-xs text-foreground hover:bg-default",
        MOTION_TRANSITION_FAST_CLASS
      )}
      onClick={() => onOpenSurface(progress ? "bestOfN" : "worktrees")}
      type="button"
    >
      {progress ? (
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon icon={GitForkIcon} size={14} strokeWidth={1.75} />
          {t("chat.bestOfN.title")}
          <span className="font-mono text-muted-foreground">{progress}</span>
        </span>
      ) : null}
      {progress && treeCount > 0 ? (
        <span aria-hidden className="h-3 w-px bg-border" />
      ) : null}
      {treeCount > 0 ? (
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon icon={Layers01Icon} size={14} strokeWidth={1.75} />
          {t("chat.worktrees.shortTitle")}
          <span className="font-mono text-muted-foreground">{treeCount}</span>
        </span>
      ) : null}
    </button>
  )
}
