import type {
  ApplyWorktreeOutput,
  BestOfNCandidate,
  BestOfNRun,
  WorktreeDiff
} from "@etyon/rpc/schemas/worktrees"
import { Button, ScrollShadow } from "@heroui/react"
import { useState } from "react"
import type { SyntheticEvent } from "react"

import { DEFAULT_BEST_OF_N_LABELS } from "@/renderer/lib/worktrees/labels"
import type { BestOfNPanelLabels } from "@/renderer/lib/worktrees/labels"

export interface BestOfNModelOption {
  id: string
  label: string
}

export interface BestOfNPanelProps {
  isRunDisabled?: boolean
  labels?: BestOfNPanelLabels
  models: BestOfNModelOption[]
  onApply: (
    id: string,
    candidateId: string,
    fingerprint: string
  ) => Promise<ApplyWorktreeOutput>
  onCancel: (id: string) => Promise<void>
  onDiscard: (id: string) => Promise<void>
  onPreview: (id: string, candidateId: string) => Promise<WorktreeDiff>
  onStart: (request: {
    models: { modelId: string }[]
    prompt: string
  }) => Promise<void>
  runs: BestOfNRun[]
}

const CandidateCard = ({
  candidate,
  isBusy,
  labels,
  onPreview,
  recommended
}: {
  candidate: BestOfNCandidate
  isBusy: boolean
  labels: BestOfNPanelLabels
  onPreview: () => void
  recommended: boolean
}) => {
  const status = labels[candidate.state]
  return (
    <article className="min-w-0 space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold">
          {candidate.modelId}
        </h3>
        <span className="shrink-0 text-[0.625rem] text-muted-foreground">
          {status}
        </span>
      </div>
      {recommended && (
        <p className="text-xs font-medium text-success">{labels.recommended}</p>
      )}
      {candidate.stats && (
        <p className="text-[0.625rem] text-muted-foreground">
          {candidate.stats.changedFileCount} {labels.files} · +
          {candidate.stats.additions} −{candidate.stats.deletions}
        </p>
      )}
      <ScrollShadow className="max-h-40">
        <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
          {candidate.summary || candidate.error || status}
        </p>
      </ScrollShadow>
      {candidate.error && candidate.summary && (
        <p className="text-xs text-danger">{candidate.error}</p>
      )}
      {candidate.worktreeId ? (
        <Button
          isDisabled={isBusy || candidate.state === "running"}
          onPress={onPreview}
          size="sm"
          variant="secondary"
        >
          {labels.preview}
        </Button>
      ) : candidate.state === "ready" ? (
        <p className="text-xs text-muted-foreground">{labels.noChanges}</p>
      ) : null}
    </article>
  )
}

const BestOfNLaunchForm = ({
  isBusy,
  isRunDisabled,
  labels,
  models,
  onStart
}: {
  isBusy: boolean
  isRunDisabled: boolean
  labels: BestOfNPanelLabels
  models: BestOfNModelOption[]
  onStart: BestOfNPanelProps["onStart"]
}) => {
  const [selectedModels, setSelectedModels] = useState<string[]>(() =>
    models.slice(0, 2).map(({ id }) => id)
  )
  const [prompt, setPrompt] = useState("")
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  )
  const start = async (
    event: SyntheticEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    const modelIds = selectedModels.filter((id) =>
      models.some((model) => model.id === id)
    )
    if (modelIds.length < 2 || modelIds.length > 4) {
      setValidationMessage(labels.modelLimit)
      return
    }
    setValidationMessage(null)
    await onStart({
      models: modelIds.map((modelId) => ({ modelId })),
      prompt: prompt.trim()
    })
  }
  return (
    <>
      <form className="space-y-3" onSubmit={start}>
        <fieldset>
          <legend className="mb-2 text-xs font-medium">{labels.models}</legend>
          <ScrollShadow className="max-h-28">
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {models.map(({ id, label }) => (
                <label className="flex items-center gap-1.5 text-xs" key={id}>
                  <input
                    checked={selectedModels.includes(id)}
                    disabled={
                      isBusy ||
                      isRunDisabled ||
                      (!selectedModels.includes(id) &&
                        selectedModels.length >= 4)
                    }
                    onChange={(event) => {
                      setSelectedModels(
                        event.target.checked
                          ? [...selectedModels, id]
                          : selectedModels.filter((modelId) => modelId !== id)
                      )
                    }}
                    type="checkbox"
                  />
                  {label}
                </label>
              ))}
            </div>
          </ScrollShadow>
        </fieldset>
        <label className="block space-y-1 text-xs">
          <span>{labels.prompt}</span>
          <textarea
            className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 text-xs"
            disabled={isBusy || isRunDisabled}
            maxLength={16_000}
            onChange={(event) => {
              setPrompt(event.target.value)
            }}
            required
            value={prompt}
          />
        </label>
        <Button
          isDisabled={
            isBusy ||
            isRunDisabled ||
            selectedModels.length < 2 ||
            !prompt.trim()
          }
          size="sm"
          type="submit"
        >
          {labels.start}
        </Button>
      </form>
      {validationMessage && (
        <p className="text-xs text-danger" role="alert">
          {validationMessage}
        </p>
      )}
    </>
  )
}

const CandidateDiffPreview = ({
  candidate,
  diff,
  isBusy,
  labels,
  onApply,
  run
}: {
  candidate: BestOfNCandidate | undefined
  diff: WorktreeDiff
  isBusy: boolean
  labels: BestOfNPanelLabels
  onApply: () => void
  run: BestOfNRun
}) => (
  <div className="space-y-2 rounded-lg border border-border p-3">
    <p className="text-xs text-muted-foreground">
      {diff.paths.length} {labels.files} · +{diff.additions} −{diff.deletions}
    </p>
    {diff.conflicts.length > 0 && (
      <p className="text-xs whitespace-pre-wrap text-danger" role="alert">
        {labels.conflicts}
        {"\n"}
        {diff.conflicts.join("\n")}
      </p>
    )}
    <ScrollShadow className="max-h-64">
      <pre className="text-[0.625rem] leading-4 break-all whitespace-pre-wrap">
        {diff.patch || labels.noChanges}
      </pre>
    </ScrollShadow>
    <Button
      isDisabled={
        isBusy ||
        run.state !== "ready" ||
        candidate?.state !== "ready" ||
        diff.conflicts.length > 0 ||
        !diff.patch
      }
      onPress={onApply}
      size="sm"
    >
      {labels.apply}
    </Button>
  </div>
)

export const BestOfNPanel = ({
  isRunDisabled = false,
  labels = DEFAULT_BEST_OF_N_LABELS,
  models,
  onApply,
  onCancel,
  onDiscard,
  onPreview,
  onStart,
  runs
}: BestOfNPanelProps) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    candidateId: string
    diff: WorktreeDiff
    runId: string
  } | null>(null)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const run = runs.find(({ id }) => id === selectedRunId) ?? runs[0]
  const selectedCandidate = run?.candidates.find(
    ({ id }) => id === preview?.candidateId
  )
  const currentPreview = preview?.runId === run?.id ? preview : null

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
  const showPreview = async (candidateId: string): Promise<void> => {
    if (!run) {
      return
    }
    await perform(async () => {
      setPreview({
        candidateId,
        diff: await onPreview(run.id, candidateId),
        runId: run.id
      })
    })
  }
  const apply = async (): Promise<void> => {
    if (!currentPreview || !run) {
      return
    }
    await perform(async () => {
      const result = await onApply(
        run.id,
        currentPreview.candidateId,
        currentPreview.diff.fingerprint
      )
      if (!result.ok) {
        setFailureMessage(
          `${result.error ?? labels.conflicts}${result.conflicts.length > 0 ? `\n${result.conflicts.join("\n")}` : ""}`
        )
        return
      }
      setPreview(null)
    })
  }

  return (
    <section aria-label={labels.title} className="flex min-h-0 flex-col gap-3">
      <h2 className="text-sm font-semibold">{labels.title}</h2>
      <BestOfNLaunchForm
        isBusy={isBusy}
        isRunDisabled={isRunDisabled}
        labels={labels}
        models={models}
        onStart={(request) =>
          perform(async () => {
            await onStart(request)
          })
        }
      />
      {failureMessage && (
        <p className="text-xs whitespace-pre-wrap text-danger" role="alert">
          {failureMessage}
        </p>
      )}
      <ScrollShadow className="max-h-[50vh] min-h-0 space-y-3">
        {!run && (
          <p className="text-xs text-muted-foreground">{labels.empty}</p>
        )}
        {runs.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {runs.map((item) => (
              <Button
                aria-pressed={item.id === run?.id}
                isDisabled={isBusy}
                key={item.id}
                onPress={() => {
                  setSelectedRunId(item.id)
                  setPreview(null)
                  setConfirmDiscard(false)
                }}
                size="sm"
                variant={item.id === run?.id ? "secondary" : "ghost"}
              >
                {item.prompt.slice(0, 40)}
              </Button>
            ))}
          </div>
        )}
        {run && (
          <>
            <p className="text-xs leading-5 whitespace-pre-wrap">
              {run.prompt}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
              {run.candidates.map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  isBusy={isBusy}
                  key={candidate.id}
                  labels={labels}
                  onPreview={() => {
                    void showPreview(candidate.id)
                  }}
                  recommended={
                    run.review?.recommendedCandidateId === candidate.id
                  }
                />
              ))}
            </div>
            {run.review && (
              <div className="space-y-1 rounded-lg bg-muted/40 p-3">
                <h3 className="text-xs font-medium">{labels.recommendation}</h3>
                <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                  {run.review.recommendation}
                </p>
              </div>
            )}
            {currentPreview && (
              <CandidateDiffPreview
                candidate={selectedCandidate}
                diff={currentPreview.diff}
                isBusy={isBusy}
                labels={labels}
                onApply={() => {
                  void apply()
                }}
                run={run}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {run.state === "running" ? (
                <Button
                  isDisabled={isBusy}
                  onPress={() => {
                    void perform(async () => {
                      await onCancel(run.id)
                    })
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {labels.cancel}
                </Button>
              ) : (
                run.candidates.some((candidate) => candidate.worktreeId) && (
                  <Button
                    isDisabled={isBusy || run.state === "applying"}
                    onPress={() => {
                      setConfirmDiscard(true)
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {labels.discard}
                  </Button>
                )
              )}
            </div>
            {confirmDiscard && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs">{labels.discardConfirmation}</p>
                <div className="flex gap-2">
                  <Button
                    isDisabled={isBusy}
                    onPress={() => {
                      void perform(async () => {
                        await onDiscard(run.id)
                        setPreview(null)
                        setConfirmDiscard(false)
                      })
                    }}
                    size="sm"
                    variant="danger"
                  >
                    {labels.confirmDiscard}
                  </Button>
                  <Button
                    isDisabled={isBusy}
                    onPress={() => {
                      setConfirmDiscard(false)
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {labels.cancelDiscard}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </ScrollShadow>
    </section>
  )
}
