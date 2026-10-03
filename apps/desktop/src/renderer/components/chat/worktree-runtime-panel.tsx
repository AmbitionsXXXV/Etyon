import { useI18n } from "@etyon/i18n/react"
import type { AppSettings } from "@etyon/rpc"
import { ScrollShadow } from "@heroui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { BestOfNPanel } from "@/renderer/components/chat/best-of-n-panel"
import type {
  BestOfNModelOption,
  BestOfNPanelProps
} from "@/renderer/components/chat/best-of-n-panel"
import { WorktreePanel } from "@/renderer/components/chat/worktree-panel"
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

export const WorktreeRuntimePanel = ({
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
  const settings = useQuery(orpc.settings.get.queryOptions({}))
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: runOptions.queryKey })
    await queryClient.invalidateQueries({ queryKey: treeOptions.queryKey })
  }
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
            void queryClient.invalidateQueries({
              queryKey: orpc.bestOfN.list.queryOptions({ input: { sessionId } })
                .queryKey
            })
            void queryClient.invalidateQueries({
              queryKey: orpc.worktrees.list.queryOptions({
                input: { sessionId }
              }).queryKey
            })
          }
        }
      ),
    [queryClient, sessionId]
  )
  const canDelegate = canStartBestOfN(settings.data)
  const candidateTrees = new Set(
    (runs.data?.runs ?? []).flatMap((run) =>
      run.candidates.flatMap((candidate) =>
        candidate.worktreeId ? [candidate.worktreeId] : []
      )
    )
  )
  const independentTrees = (trees.data?.worktrees ?? []).filter(
    (tree) => !candidateTrees.has(tree.id)
  )
  return (
    <details className="shrink-0 rounded-lg border border-border bg-card px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium">
        {t("chat.bestOfN.title")} · {t("chat.worktrees.title")}
      </summary>
      <ScrollShadow className="mt-3 max-h-[45vh] space-y-5 pr-1">
        {(runs.error || trees.error) && (
          <p className="text-xs text-danger" role="alert">
            {runs.error?.message ?? trees.error?.message}
          </p>
        )}
        {!canDelegate && (
          <p className="text-xs text-muted-foreground">
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
            modelLimit: t("chat.bestOfN.modelLimit"),
            models: t("chat.bestOfN.models"),
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
          runs={runs.data?.runs ?? []}
        />
        {independentTrees.length > 0 && (
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
        )}
      </ScrollShadow>
    </details>
  )
}
