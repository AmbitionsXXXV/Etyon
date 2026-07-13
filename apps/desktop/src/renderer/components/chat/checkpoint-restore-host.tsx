import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type { AgentCheckpoint, CheckpointOrigin } from "@etyon/rpc"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@etyon/ui/components/dialog"
import { cn } from "@etyon/ui/lib/utils"
import { Button } from "@heroui/react"
import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"

import type {
  CheckpointFileDirection,
  CheckpointRestorePlanEntry
} from "@/renderer/lib/chat/checkpoint-restore"
import {
  isPartialRestore,
  planCheckpointRestore
} from "@/renderer/lib/chat/checkpoint-restore"
import {
  clearCheckpointRestore,
  clearSessionCheckpoints,
  setSessionCheckpoints,
  usePendingCheckpointRestore
} from "@/renderer/lib/chat/checkpoint-restore-store"
import { orpc, rpcClient } from "@/renderer/lib/rpc"

const CHECKPOINTS_STALE_TIME_MS = 30_000

const ORIGIN_LABEL_KEY: Record<CheckpointOrigin, TranslationKey> = {
  bash: "chat.checkpoints.originBash",
  edit: "chat.checkpoints.originEdit",
  write: "chat.checkpoints.originWrite"
}

const DIRECTION_LABEL_KEY: Record<CheckpointFileDirection, TranslationKey> = {
  blocked: "chat.checkpoints.directionBlocked",
  delete: "chat.checkpoints.directionDelete",
  restore: "chat.checkpoints.directionRestore"
}

const DIRECTION_CLASS_NAME: Record<CheckpointFileDirection, string> = {
  blocked: "text-destructive",
  delete: "text-amber-600 dark:text-amber-400",
  restore: "text-muted-foreground"
}

const RestorePlanRow = ({ entry }: { entry: CheckpointRestorePlanEntry }) => {
  const { t } = useI18n()

  return (
    <li className="flex items-center justify-between gap-3 px-2 py-1 text-xs">
      <span className="min-w-0 flex-1 truncate font-mono text-foreground">
        {entry.path}
      </span>
      <span className={cn("shrink-0", DIRECTION_CLASS_NAME[entry.direction])}>
        {t(DIRECTION_LABEL_KEY[entry.direction])}
      </span>
    </li>
  )
}

const RestorePlanList = ({
  plan
}: {
  plan: readonly CheckpointRestorePlanEntry[]
}) => (
  <ul className="max-h-52 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60 bg-background/50">
    {plan.map((entry) => (
      <RestorePlanRow entry={entry} key={entry.path} />
    ))}
  </ul>
)

const RestoreResultPaths = ({ paths }: { paths: readonly string[] }) => {
  if (paths.length === 0) {
    return null
  }

  return (
    <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-background/50 px-2 py-1">
      {paths.map((path) => (
        <li className="truncate font-mono text-[0.6875rem]" key={path}>
          {path}
        </li>
      ))}
    </ul>
  )
}

const RestoreResultSummary = ({
  missingBlobs,
  restored,
  skipped
}: {
  missingBlobs: readonly string[]
  restored: readonly string[]
  skipped: readonly string[]
}) => {
  const { t } = useI18n()
  const partial = isPartialRestore({
    missingBlobs: [...missingBlobs],
    restored: [...restored],
    skipped: [...skipped]
  })

  return (
    <div className="space-y-2 text-xs">
      <div
        className={cn(
          "flex items-center gap-2 font-medium",
          partial
            ? "text-amber-600 dark:text-amber-400"
            : "text-emerald-600 dark:text-emerald-400"
        )}
      >
        <HugeiconsIcon
          icon={partial ? Alert02Icon : CheckmarkCircle01Icon}
          size={15}
        />
        <span>
          {t(
            partial
              ? "chat.checkpoints.partialTitle"
              : "chat.checkpoints.successTitle"
          )}
        </span>
      </div>
      <p className="text-muted-foreground">
        {t("chat.checkpoints.resultRestored", { count: restored.length })}
      </p>
      {skipped.length > 0 ? (
        <div className="space-y-1">
          <p className="text-amber-600 dark:text-amber-400">
            {t("chat.checkpoints.resultSkipped", { count: skipped.length })}
          </p>
          <RestoreResultPaths paths={skipped} />
        </div>
      ) : null}
      {missingBlobs.length > 0 ? (
        <div className="space-y-1">
          <p className="text-amber-600 dark:text-amber-400">
            {t("chat.checkpoints.resultMissing", {
              count: missingBlobs.length
            })}
          </p>
          <RestoreResultPaths paths={missingBlobs} />
        </div>
      ) : null}
    </div>
  )
}

const CheckpointRestoreDialog = ({
  checkpoint,
  sessionId
}: {
  checkpoint: AgentCheckpoint
  sessionId: string
}) => {
  const { locale, t } = useI18n()
  const queryClient = useQueryClient()
  const restoreMutation = useMutation({
    mutationFn: () =>
      rpcClient.checkpoints.restore({ checkpointId: checkpoint.id, sessionId }),
    onSuccess: () => {
      // Mirror the Commit tab's onRefresh: restoring rewrites files on disk, so
      // git diff, the file tree, the snapshot, and sidebar status go stale.
      void queryClient.invalidateQueries({
        queryKey: orpc.chatSessions.list.key()
      })
      void queryClient.invalidateQueries({ queryKey: orpc.git.diff.key() })
      void queryClient.invalidateQueries({
        queryKey: orpc.projectSnapshots.listFiles.key()
      })
      void queryClient.invalidateQueries({
        queryKey: orpc.projectSnapshots.ensure.key()
      })
      void queryClient.invalidateQueries({
        queryKey: orpc.checkpoints.list.key()
      })
    }
  })
  const plan = useMemo(
    () => planCheckpointRestore(checkpoint.files),
    [checkpoint.files]
  )
  const capturedAt = useMemo(
    () =>
      new Date(checkpoint.createdAt).toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short"
      }),
    [checkpoint.createdAt, locale]
  )
  const result = restoreMutation.isSuccess ? restoreMutation.data : null

  const handleOpenChange = (next: boolean) => {
    if (next) {
      return
    }

    restoreMutation.reset()
    clearCheckpointRestore()
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("chat.checkpoints.title")}</DialogTitle>
          <DialogDescription>
            {t("chat.checkpoints.description", {
              origin: t(ORIGIN_LABEL_KEY[checkpoint.origin]),
              time: capturedAt
            })}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <RestoreResultSummary
            missingBlobs={result.missingBlobs}
            restored={result.restored}
            skipped={result.skipped}
          />
        ) : (
          <div className="space-y-2">
            {restoreMutation.isError ? (
              <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                <HugeiconsIcon icon={AlertCircleIcon} size={15} />
                <span>{t("chat.checkpoints.errorBody")}</span>
              </div>
            ) : null}
            <p className="text-xs font-medium text-muted-foreground">
              {t("chat.checkpoints.filesHeading")}
            </p>
            <RestorePlanList plan={plan} />
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button
              onPress={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("chat.checkpoints.close")}
            </Button>
          ) : (
            <>
              <Button
                isDisabled={restoreMutation.isPending}
                onPress={() => handleOpenChange(false)}
                type="button"
                variant="outline"
              >
                {t("chat.checkpoints.cancel")}
              </Button>
              <Button
                isDisabled={restoreMutation.isPending}
                isPending={restoreMutation.isPending}
                onPress={() => restoreMutation.mutate()}
                type="button"
                variant="danger-soft"
              >
                {t(
                  restoreMutation.isPending
                    ? "chat.checkpoints.restoring"
                    : "chat.checkpoints.confirm"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Route-level owner of the checkpoint restore flow. Fetches the session's
 * checkpoints (react-query, shared key) and publishes them to the node-safe
 * store so tool rows can light up their restore affordance; renders the confirm
 * dialog when a row raises a restore request. Kept out of message-tool-trace so
 * that node-tested module never imports rpc/window.
 */
export const CheckpointRestoreHost = ({ sessionId }: { sessionId: string }) => {
  const { data, refetch } = useQuery(
    orpc.checkpoints.list.queryOptions({
      enabled: Boolean(sessionId),
      input: { sessionId },
      staleTime: CHECKPOINTS_STALE_TIME_MS
    })
  )
  const pending = usePendingCheckpointRestore()

  useEffect(() => {
    if (data?.checkpoints) {
      setSessionCheckpoints(sessionId, data.checkpoints)
    }
  }, [data, sessionId])

  useEffect(() => () => clearSessionCheckpoints(sessionId), [sessionId])

  // Refetch when a dialog opens so the manifest reflects the freshest capture.
  useEffect(() => {
    if (pending) {
      void refetch()
    }
  }, [pending, refetch])

  if (!pending) {
    return null
  }

  return <CheckpointRestoreDialog checkpoint={pending} sessionId={sessionId} />
}
