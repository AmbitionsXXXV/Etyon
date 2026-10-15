import type {
  ApplyWorktreeOutput,
  BestOfNCandidate,
  BestOfNRun,
  WorktreeDiff
} from "@etyon/rpc/schemas/worktrees"
import { cn } from "@etyon/ui/lib/utils"
import { Button, ScrollShadow } from "@heroui/react"
import { useState } from "react"
import type { SyntheticEvent } from "react"

import { MOTION_TRANSITION_FAST_CLASS } from "@/renderer/lib/motion"
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

const CandidateRow = ({
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
    <article
      className={cn(
        "min-w-0 space-y-1.5 rounded-xl px-3 py-2.5",
        recommended ? "bg-accent-soft" : "bg-surface"
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {candidate.modelId}
        </h3>
        {recommended ? (
          <span className="shrink-0 rounded-md bg-accent-soft px-1.5 text-[0.6875rem] font-medium text-accent-soft-foreground">
            {labels.recommended}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {status}
          </span>
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
        ) : null}
      </div>
      {candidate.stats && (
        <p className="font-mono text-xs text-muted-foreground">
          {candidate.stats.changedFileCount} {labels.files}{" "}
          <span className="text-success">+{candidate.stats.additions}</span>{" "}
          <span className="text-danger">−{candidate.stats.deletions}</span>
        </p>
      )}
      <p className="line-clamp-3 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
        {candidate.summary || candidate.error || status}
      </p>
      {candidate.error && candidate.summary && (
        <p className="text-xs text-danger">{candidate.error}</p>
      )}
      {!candidate.worktreeId && candidate.state === "ready" ? (
        <p className="text-xs text-muted-foreground">{labels.noChanges}</p>
      ) : null}
    </article>
  )
}

const MAX_BEST_OF_N_MODELS = 4
const MIN_BEST_OF_N_MODELS = 2

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
    models.slice(0, MIN_BEST_OF_N_MODELS).map(({ id }) => id)
  )
  const [filter, setFilter] = useState("")
  const [prompt, setPrompt] = useState("")
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  )
  const normalizedFilter = filter.trim().toLowerCase()
  const visibleModels = normalizedFilter
    ? models.filter(
        ({ id, label }) =>
          selectedModels.includes(id) ||
          label.toLowerCase().includes(normalizedFilter)
      )
    : models
  const isFormDisabled = isBusy || isRunDisabled
  const hasValidSelection =
    selectedModels.length >= MIN_BEST_OF_N_MODELS &&
    selectedModels.length <= MAX_BEST_OF_N_MODELS
  const start = async (
    event: SyntheticEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    const modelIds = selectedModels.filter((id) =>
      models.some((model) => model.id === id)
    )
    if (
      modelIds.length < MIN_BEST_OF_N_MODELS ||
      modelIds.length > MAX_BEST_OF_N_MODELS
    ) {
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
        <fieldset className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <legend className="text-xs font-medium">{labels.models}</legend>
            <span
              className={cn(
                "font-mono text-xs",
                hasValidSelection ? "text-muted-foreground" : "text-warning"
              )}
            >
              {selectedModels.length}/{MAX_BEST_OF_N_MODELS}
            </span>
          </div>
          <input
            aria-label={labels.modelFilter}
            className="bg-field-background h-8 w-full rounded-lg border border-border px-2.5 text-xs text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:border-focus"
            disabled={isFormDisabled}
            onChange={(event) => {
              setFilter(event.target.value)
            }}
            placeholder={labels.modelFilter}
            type="search"
            value={filter}
          />
          <ScrollShadow className="max-h-32">
            <div className="flex flex-wrap gap-1.5">
              {visibleModels.map(({ id, label }) => {
                const isSelected = selectedModels.includes(id)
                return (
                  <button
                    aria-pressed={isSelected}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      MOTION_TRANSITION_FAST_CLASS,
                      isSelected
                        ? "border-accent/50 bg-accent-soft text-accent-soft-foreground"
                        : "border-border bg-surface text-foreground hover:bg-default"
                    )}
                    disabled={
                      isFormDisabled ||
                      (!isSelected &&
                        selectedModels.length >= MAX_BEST_OF_N_MODELS)
                    }
                    key={id}
                    onClick={() => {
                      setSelectedModels(
                        isSelected
                          ? selectedModels.filter((modelId) => modelId !== id)
                          : [...selectedModels, id]
                      )
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </ScrollShadow>
        </fieldset>
        <label className="block space-y-1 text-xs">
          <span className="font-medium">{labels.prompt}</span>
          <textarea
            className="bg-field-background min-h-20 w-full resize-y rounded-lg border border-border p-2.5 text-xs text-field-foreground outline-none focus-visible:border-focus"
            disabled={isFormDisabled}
            maxLength={16_000}
            onChange={(event) => {
              setPrompt(event.target.value)
            }}
            required
            value={prompt}
          />
        </label>
        <Button
          fullWidth
          isDisabled={isFormDisabled || !hasValidSelection || !prompt.trim()}
          size="sm"
          type="submit"
        >
          {labels.start}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          {labels.empty}
        </p>
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
    <section aria-label={labels.title} className="flex min-h-0 flex-col gap-4">
      {failureMessage && (
        <p className="text-xs whitespace-pre-wrap text-danger" role="alert">
          {failureMessage}
        </p>
      )}
      <div className="min-h-0 space-y-3">
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
            <p className="line-clamp-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
              {run.prompt}
            </p>
            <div className="space-y-1.5">
              {run.candidates.map((candidate) => (
                <CandidateRow
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
              <div className="space-y-1 rounded-xl bg-surface p-3">
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
      </div>
      <div className="space-y-3 border-t border-separator pt-4">
        <h2 className="text-sm font-semibold">{labels.newRun}</h2>
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
      </div>
    </section>
  )
}
