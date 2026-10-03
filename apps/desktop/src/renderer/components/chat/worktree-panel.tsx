import type {
  ApplyWorktreeOutput,
  ManagedWorktree,
  WorktreeDiff
} from "@etyon/rpc/schemas/worktrees"
import { Button, ScrollShadow } from "@heroui/react"
import { useState } from "react"

import { DEFAULT_WORKTREE_LABELS } from "@/renderer/lib/worktrees/labels"
import type { WorktreePanelLabels } from "@/renderer/lib/worktrees/labels"

export const WorktreePanel = ({
  labels = DEFAULT_WORKTREE_LABELS,
  onApply,
  onPreview,
  onPrune,
  worktrees
}: {
  labels?: WorktreePanelLabels
  onApply: (id: string, fingerprint: string) => Promise<ApplyWorktreeOutput>
  onPreview: (id: string) => Promise<WorktreeDiff>
  onPrune: (id: string, discardChanges: boolean) => Promise<void>
  worktrees: ManagedWorktree[]
}) => {
  const [preview, setPreview] = useState<WorktreeDiff | null>(null)
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true)
    setFailureMessage(null)
    try {
      await action()
    } catch (error) {
      setFailureMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }
  return (
    <section aria-label={labels.title} className="flex min-h-0 flex-col gap-3">
      <h2 className="text-sm font-semibold">{labels.title}</h2>
      {failureMessage && (
        <p className="text-xs whitespace-pre-wrap text-danger" role="alert">
          {failureMessage}
        </p>
      )}
      <ScrollShadow className="max-h-[50vh] min-h-0 space-y-3">
        {worktrees.length === 0 && (
          <p className="text-xs text-muted-foreground">{labels.empty}</p>
        )}
        {worktrees.map((tree) => (
          <article
            className="space-y-2 rounded-lg border border-border p-3"
            key={tree.id}
          >
            <h3 className="text-xs font-semibold">{tree.label}</h3>
            <p className="truncate text-[0.625rem] text-muted-foreground">
              {tree.workspacePath}
            </p>
            {tree.state === "orphaned" && (
              <p className="text-xs text-warning">{labels.orphaned}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                isDisabled={isBusy || tree.state === "running"}
                onPress={() => {
                  void perform(async () => {
                    setPreview(await onPreview(tree.id))
                  })
                }}
                size="sm"
                variant="secondary"
              >
                {labels.preview}
              </Button>
              <Button
                isDisabled={isBusy || tree.state === "running"}
                onPress={() => {
                  setPendingDiscard(tree.id)
                }}
                size="sm"
                variant="ghost"
              >
                {labels.discard}
              </Button>
            </div>
            {pendingDiscard === tree.id && (
              <Button
                isDisabled={isBusy}
                onPress={() => {
                  void perform(async () => {
                    await onPrune(tree.id, true)
                    setPendingDiscard(null)
                    if (preview?.worktree.id === tree.id) {
                      setPreview(null)
                    }
                  })
                }}
                size="sm"
                variant="danger"
              >
                {labels.confirmDiscard}
              </Button>
            )}
          </article>
        ))}
        {preview && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs">
              {preview.paths.length} {labels.files} · +{preview.additions} −
              {preview.deletions}
            </p>
            {preview.conflicts.length > 0 && (
              <p
                className="text-xs whitespace-pre-wrap text-danger"
                role="alert"
              >
                {preview.conflicts.join("\n")}
              </p>
            )}
            <ScrollShadow className="max-h-64">
              <pre className="text-[0.625rem] leading-4 break-all whitespace-pre-wrap">
                {preview.patch}
              </pre>
            </ScrollShadow>
            <Button
              isDisabled={
                isBusy ||
                preview.conflicts.length > 0 ||
                !preview.patch ||
                preview.worktree.state === "running" ||
                preview.worktree.state === "applied"
              }
              onPress={() => {
                void perform(async () => {
                  const result = await onApply(
                    preview.worktree.id,
                    preview.fingerprint
                  )
                  if (!result.ok) {
                    setFailureMessage(
                      `${result.error ?? "Application failed"}\n${result.conflicts.join("\n")}`
                    )
                    return
                  }
                  setPreview(null)
                })
              }}
              size="sm"
            >
              {labels.apply}
            </Button>
          </div>
        )}
      </ScrollShadow>
    </section>
  )
}
