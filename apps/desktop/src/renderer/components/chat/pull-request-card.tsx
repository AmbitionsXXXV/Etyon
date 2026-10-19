import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Tooltip } from "@heroui/react"
import {
  Alert02Icon,
  GitMergeIcon,
  Loading03Icon,
  Tick02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useId, useMemo, useState } from "react"
import type { ReactNode } from "react"

import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import {
  GRAPH_ROW_HEIGHT,
  GRAPH_WIDTH,
  buildPullRequestRows,
  getInitialPullRequestStage,
  getNextTestCount,
  getPullRequestCard,
  getStageAfterChecking
} from "@/renderer/lib/chat/pull-request-card"
import type {
  PullRequestDot,
  PullRequestRow,
  PullRequestStage
} from "@/renderer/lib/chat/pull-request-card"
import type { PullRequestCard } from "@/shared/chat/pull-request"

// Simulated timings for the sample flow (no real git work runs yet).
const CHECKING_MS = 1800
const RESOLVE_STEP_MS = 800
const TEST_TICK_MS = 110
const SETTLE_MS = 450
const MERGING_MS = 1400

const DOT_CLASS: Record<PullRequestDot, string> = {
  base: "fill-zinc-400 dark:fill-zinc-500",
  conflict: "fill-amber-500",
  head: "fill-blue-500",
  merged: "fill-violet-500",
  ring: "fill-card stroke-blue-500",
  "ring-merged": "fill-card stroke-violet-500",
  side: "fill-teal-500"
}

const TONE_CLASS: Record<PullRequestRow["tone"], string> = {
  conflict: "text-amber-700 dark:text-amber-400",
  muted: "text-muted-foreground",
  primary: "text-foreground"
}

const HIGHLIGHT_CLASS: Record<
  NonNullable<PullRequestRow["highlight"]>,
  string
> = {
  active: "bg-muted/60",
  merged: "bg-violet-500/8",
  scan: "bg-amber-500/8"
}

const BusySpinner = ({ className }: { className?: string }) => (
  <HugeiconsIcon
    className={cn("animate-spin text-muted-foreground", className)}
    icon={Loading03Icon}
    size={13}
    strokeWidth={2}
  />
)

const CheckMark = ({ className }: { className?: string }) => (
  <HugeiconsIcon
    className={cn("text-emerald-600 dark:text-emerald-400", className)}
    icon={Tick02Icon}
    size={12}
    strokeWidth={2.4}
  />
)

const BranchLabel = ({
  isMerged,
  row
}: {
  isMerged: boolean
  row: PullRequestRow
}) => {
  const { lane } = row.commit
  let tone = "bg-muted text-muted-foreground"

  if (lane === "head") {
    tone = isMerged
      ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
      : "bg-blue-500/10 text-blue-700 dark:text-blue-300"
  } else if (lane === "side") {
    tone = "bg-teal-500/10 text-teal-700 dark:text-teal-300"
  }

  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-px font-mono text-[11px] leading-4",
        tone
      )}
    >
      {row.commit.branch}
    </span>
  )
}

const CommitGraph = ({
  isMerged,
  row
}: {
  isMerged: boolean
  row: PullRequestRow
}) => {
  const isRing = row.dot === "ring" || row.dot === "ring-merged"
  const headStroke = isMerged
    ? "stroke-violet-300 dark:stroke-violet-500/60"
    : "stroke-blue-300 dark:stroke-blue-500/60"

  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height={GRAPH_ROW_HEIGHT}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_ROW_HEIGHT}`}
      width={GRAPH_WIDTH}
    >
      <g fill="none" strokeWidth={1.5}>
        <path
          className="stroke-zinc-300 dark:stroke-zinc-600"
          d={row.paths.base}
        />
        <path
          className="stroke-zinc-300 dark:stroke-zinc-600"
          d={row.paths.baseDashed}
          strokeDasharray="2 3"
        />
        <path className={headStroke} d={row.paths.head} />
        <path
          className="stroke-teal-300 dark:stroke-teal-600"
          d={row.paths.side}
        />
      </g>
      <circle
        className={DOT_CLASS[row.dot]}
        cx={row.dotX}
        cy={GRAPH_ROW_HEIGHT / 2}
        r={isRing ? 4 : 3.2}
        strokeWidth={isRing ? 1.6 : 0}
      />
    </svg>
  )
}

const CommitRow = ({
  isMerged,
  progress,
  row,
  trailing
}: {
  isMerged: boolean
  /** 0–1 test progress drawn under the merge commit while tests run. */
  progress?: number
  row: PullRequestRow
  /** Replaces the sha and author, e.g. with "1/3" while resolving. */
  trailing?: string
}) => {
  const { t } = useI18n()
  const { commit } = row

  return (
    <li
      className={cn(
        "relative -mr-2 flex h-[30px] items-center rounded-lg pr-2 transition-colors duration-300",
        row.highlight ? HIGHLIGHT_CLASS[row.highlight] : null
      )}
    >
      <CommitGraph isMerged={isMerged} row={row} />
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className={cn("truncate text-[13px]", TONE_CLASS[row.tone])}>
          {commit.title}
        </span>
        {row.showBranch ? <BranchLabel isMerged={isMerged} row={row} /> : null}
        {row.badge ? (
          <span
            aria-label={t("chat.pullRequest.conflictBadge", {
              count: row.badge
            })}
            className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400"
          >
            {row.badge}
          </span>
        ) : null}
        {row.resolved ? (
          <span
            aria-label={t("chat.pullRequest.resolvedLabel")}
            className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15"
          >
            <CheckMark className="size-2.5" />
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {trailing ? (
          <span className="tabular-nums">{trailing}</span>
        ) : (
          <>
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {commit.sha}
            </span>
            <span>
              {commit.author} · {commit.age}
            </span>
          </>
        )}
      </span>
      {progress === undefined ? null : (
        <span
          aria-hidden="true"
          className="absolute right-0 bottom-px left-[52px] h-0.5 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-emerald-500 transition-[width] duration-100 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </span>
      )}
    </li>
  )
}

const MergeTargetIcon = ({ stage }: { stage: PullRequestStage }) => {
  if (stage === "checking") {
    return (
      <svg
        aria-hidden="true"
        className="animate-spin"
        height={15}
        viewBox="0 0 16 16"
        width={15}
      >
        <circle
          className="fill-card stroke-zinc-400"
          cx={8}
          cy={8}
          r={6}
          strokeDasharray="2.5 2.2"
          strokeWidth={1.5}
        />
      </svg>
    )
  }

  if (stage === "merged") {
    return <span className="size-[13px] rounded-full bg-violet-500" />
  }

  if (stage === "ready" || stage === "merging") {
    return (
      <span className="flex size-[15px] items-center justify-center rounded-full bg-emerald-500">
        <HugeiconsIcon
          className="text-white"
          icon={Tick02Icon}
          size={10}
          strokeWidth={3}
        />
      </span>
    )
  }

  return (
    <span className="flex size-[15px] items-center justify-center rounded-full bg-amber-500 text-[10px] leading-none font-bold text-white">
      !
    </span>
  )
}

const MergeTargetRow = ({
  card,
  stage
}: {
  card: PullRequestCard
  stage: PullRequestStage
}) => {
  const { t } = useI18n()
  const isMerged = stage === "merged"
  let status = t("chat.pullRequest.statusConflicts", {
    count: card.conflicts.length
  })
  let statusClass = "text-amber-700 dark:text-amber-400"

  if (stage === "checking") {
    status = t("chat.pullRequest.statusChecking")
    statusClass = "text-muted-foreground"
  } else if (stage === "testing") {
    status = t("chat.pullRequest.statusResolved")
  } else if (stage === "ready" || stage === "merging") {
    status = t("chat.pullRequest.statusReady")
    statusClass = "text-emerald-700 dark:text-emerald-400"
  } else if (isMerged) {
    status = t("chat.pullRequest.statusMerged")
    statusClass = "text-violet-700 dark:text-violet-400"
  }

  return (
    <li className="flex h-[30px] items-center">
      <span className="relative h-[30px] w-[52px] shrink-0">
        <svg
          aria-hidden="true"
          className="absolute inset-0"
          height={GRAPH_ROW_HEIGHT}
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_ROW_HEIGHT}`}
          width={GRAPH_WIDTH}
        >
          <g fill="none" strokeWidth={1.5}>
            <path
              className="stroke-zinc-300 dark:stroke-zinc-600"
              d="M8 15 V30"
              strokeDasharray="2 3"
            />
            <path
              className={
                isMerged
                  ? "stroke-violet-300 dark:stroke-violet-500/60"
                  : "stroke-blue-300 dark:stroke-blue-500/60"
              }
              d="M8 15 C8 24 22 21 22 30"
              strokeDasharray={isMerged ? undefined : "2 3"}
            />
          </g>
        </svg>
        <span className="absolute top-[7px] left-0 flex size-4 items-center justify-center">
          <MergeTargetIcon stage={stage} />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
        {isMerged ? (
          <>
            {t("chat.pullRequest.mergedInto")}
            <span className="rounded-md bg-muted px-1.5 py-px font-mono text-[11px] leading-4">
              {card.baseBranch}
            </span>
          </>
        ) : (
          t("chat.pullRequest.mergeInto", { branch: card.baseBranch })
        )}
      </span>
      <span className={cn("shrink-0 text-xs font-medium", statusClass)}>
        {status}
      </span>
    </li>
  )
}

const ConflictDetails = ({ card }: { card: PullRequestCard }) => {
  const { t } = useI18n()
  const [theirName] = card.conflictAuthor.split(" ")

  return (
    <div className="flex w-[30rem] max-w-[calc(100vw-4rem)] flex-col py-2.5 text-left">
      <p className="border-b border-border/70 px-3.5 pb-2 text-xs text-muted-foreground">
        <b className="font-semibold text-foreground">{card.conflictAuthor}</b>{" "}
        {t("chat.pullRequest.changedSameLines", { branch: card.baseBranch })}
      </p>
      {card.conflicts.map((conflict, index) => (
        <div
          className={cn(
            "flex flex-col gap-1.5 px-3.5 py-2.5",
            index > 0 && "border-t border-border/70"
          )}
          key={`${conflict.file}:${conflict.line}`}
        >
          <p className="text-xs font-semibold text-foreground">
            {conflict.file}{" "}
            <span className="font-normal text-muted-foreground">
              {t("chat.pullRequest.line", { line: conflict.line })}
            </span>
          </p>
          <div className="grid grid-cols-[3px_2.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs leading-5">
            <span className="h-5 rounded-sm bg-amber-300/80 dark:bg-amber-500/60" />
            <span className="text-muted-foreground">{theirName}</span>
            <code className="truncate font-mono text-foreground">
              {conflict.theirs}
            </code>
            <span className="h-5 rounded-sm bg-blue-300/80 dark:bg-blue-500/60" />
            <span className="text-muted-foreground">
              {t("chat.pullRequest.you")}
            </span>
            <code className="truncate font-mono text-foreground">
              {conflict.ours}
            </code>
          </div>
        </div>
      ))}
    </div>
  )
}

const PillButton = ({
  children,
  isBusy = false,
  onPress
}: {
  children: ReactNode
  isBusy?: boolean
  onPress?: () => void
}) => (
  <button
    className={cn(
      "ml-auto inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
      isBusy
        ? "bg-muted text-muted-foreground"
        : "bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-300"
    )}
    disabled={isBusy}
    onClick={onPress}
    type="button"
  >
    {children}
  </button>
)

const CheckChips = ({ card }: { card: PullRequestCard }) => (
  <div className="flex flex-wrap gap-2 pt-1">
    {card.checks.map((check) => {
      const chip = (
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-xs text-foreground">
          <CheckMark />
          {check.name}
          <span className="text-muted-foreground">{check.summary}</span>
        </span>
      )

      if (!check.detail) {
        return <span key={check.name}>{chip}</span>
      }

      return (
        <Tooltip closeDelay={0} delay={150} key={check.name}>
          <Tooltip.Trigger>
            <button className="rounded-full" type="button">
              {chip}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="top">{check.detail}</Tooltip.Content>
        </Tooltip>
      )
    })}
  </div>
)

const PullRequestFooter = ({
  card,
  onMerge,
  onResolve,
  resolved,
  stage,
  testsRun
}: {
  card: PullRequestCard
  onMerge: () => void
  onResolve: () => void
  resolved: number
  stage: PullRequestStage
  testsRun: number
}) => {
  const { t } = useI18n()
  const total = card.conflicts.length

  if (stage === "checking") {
    return (
      <span className="flex items-center gap-2 text-[13px] text-foreground/80">
        <BusySpinner />
        {t("chat.pullRequest.checking")}
      </span>
    )
  }

  if (stage === "conflicts") {
    return (
      <>
        <span className="flex items-center gap-2 text-[13px] text-foreground/80">
          <HugeiconsIcon
            className="text-amber-600 dark:text-amber-400"
            icon={Alert02Icon}
            size={14}
            strokeWidth={2}
          />
          <Tooltip closeDelay={100} delay={100}>
            <Tooltip.Trigger>
              <button
                className="text-amber-700 underline decoration-amber-400/70 decoration-dotted underline-offset-4 dark:text-amber-400"
                type="button"
              >
                {t("chat.pullRequest.statusConflicts", { count: total })}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content
              className="max-w-none rounded-xl border border-border/70 bg-popover p-0 text-popover-foreground shadow-lg"
              placement="top"
            >
              <ConflictDetails card={card} />
            </Tooltip.Content>
          </Tooltip>
          {t("chat.pullRequest.conflictsWith", { branch: card.baseBranch })}
        </span>
        <PillButton onPress={onResolve}>
          {t("chat.pullRequest.resolve")}
        </PillButton>
      </>
    )
  }

  if (stage === "resolving" || stage === "testing" || stage === "merging") {
    const copy = {
      merging: {
        button: t("chat.pullRequest.merging"),
        label: t("chat.pullRequest.mergingInto", { branch: card.baseBranch })
      },
      resolving: {
        button: t("chat.pullRequest.resolving"),
        label: t("chat.pullRequest.resolvingStep", {
          current: Math.min(resolved + 1, total),
          total
        })
      },
      testing: {
        button: t("chat.pullRequest.testing"),
        label: t("chat.pullRequest.testingStep", {
          done: testsRun,
          total: card.testCount
        })
      }
    }[stage]

    return (
      <>
        <output className="flex items-center gap-2 text-[13px] text-foreground/80">
          <BusySpinner />
          {copy.label}
        </output>
        <PillButton isBusy>
          <BusySpinner className="size-3" />
          {copy.button}
        </PillButton>
      </>
    )
  }

  if (stage === "ready") {
    return (
      <>
        <span className="flex items-center gap-2 text-[13px] text-foreground">
          <CheckMark className="size-3.5" />
          {t("chat.pullRequest.readyToMerge")}
        </span>
        <PillButton onPress={onMerge}>
          <HugeiconsIcon icon={GitMergeIcon} size={14} strokeWidth={2} />
          {t("chat.pullRequest.merge")}
        </PillButton>
      </>
    )
  }

  return (
    <span className="flex items-center gap-2 text-[13px] text-foreground">
      <HugeiconsIcon
        className="text-violet-600 dark:text-violet-400"
        icon={GitMergeIcon}
        size={14}
        strokeWidth={2}
      />
      {t("chat.pullRequest.mergedIntoBranch", { branch: card.baseBranch })}
    </span>
  )
}

const PullRequestMergeCard = ({
  animateEntry,
  card
}: {
  animateEntry: boolean
  card: PullRequestCard
}) => {
  const { t } = useI18n()
  const titleId = useId()
  const [stage, setStage] = useState<PullRequestStage>(() =>
    getInitialPullRequestStage(card, animateEntry)
  )
  const [resolved, setResolved] = useState(0)
  const [testsRun, setTestsRun] = useState(0)
  const conflictTotal = card.conflicts.length
  const { testCount } = card
  const stageAfterChecking = getStageAfterChecking(card)

  // Plays the sample flow: each stage schedules its own way out.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, run: () => void) => {
      timers.push(setTimeout(run, ms))
    }

    if (stage === "checking") {
      later(CHECKING_MS, () => setStage(stageAfterChecking))
    }

    if (stage === "resolving") {
      for (let step = 1; step <= conflictTotal; step += 1) {
        later(step * RESOLVE_STEP_MS, () => setResolved(step))
      }
      later(conflictTotal * RESOLVE_STEP_MS + SETTLE_MS, () =>
        setStage("testing")
      )
    }

    if (stage === "testing") {
      let count = 0
      const tick = () => {
        count = getNextTestCount(count, testCount)
        setTestsRun(count)

        if (count < testCount) {
          later(TEST_TICK_MS, tick)
        } else {
          later(SETTLE_MS, () => setStage("ready"))
        }
      }

      later(TEST_TICK_MS, tick)
    }

    if (stage === "merging") {
      later(MERGING_MS, () => setStage("merged"))
    }

    return () => {
      for (const timer of timers) {
        clearTimeout(timer)
      }
    }
  }, [conflictTotal, stage, stageAfterChecking, testCount])

  const rows = useMemo(
    () => buildPullRequestRows({ card, resolved, stage }),
    [card, resolved, stage]
  )
  const isMerged = stage === "merged"
  const showChecks = stage === "ready" || stage === "merging"

  const getTrailing = (row: PullRequestRow): string | undefined => {
    if (!row.isMergeCommit) {
      return undefined
    }

    if (stage === "resolving") {
      return `${Math.min(resolved + 1, conflictTotal)}/${conflictTotal}`
    }

    return stage === "testing" ? `${testsRun}/${testCount}` : undefined
  }

  return (
    <article
      aria-labelledby={titleId}
      className="flex w-full max-w-2xl flex-col gap-2 rounded-2xl border border-border/70 bg-card px-4 pt-3.5 pb-3 shadow-xs"
    >
      <div className="flex items-center gap-3">
        <h3
          className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
          id={titleId}
        >
          {card.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{card.number}
          </span>
        </h3>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs font-medium",
            isMerged
              ? "text-violet-700 dark:text-violet-400"
              : "text-emerald-700 dark:text-emerald-400"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isMerged ? "bg-violet-500" : "bg-emerald-500"
            )}
          />
          {isMerged ? t("chat.pullRequest.merged") : t("chat.pullRequest.open")}
        </span>
      </div>
      <ol aria-label={t("chat.pullRequest.commits")} className="flex flex-col">
        <MergeTargetRow card={card} stage={stage} />
        {rows.map((row) => (
          <CommitRow
            isMerged={isMerged}
            key={row.commit.sha}
            progress={
              row.isMergeCommit && stage === "testing" && testCount > 0
                ? testsRun / testCount
                : undefined
            }
            row={row}
            trailing={getTrailing(row)}
          />
        ))}
      </ol>
      {showChecks ? <CheckChips card={card} /> : null}
      <div className="flex min-h-9 items-center gap-2.5">
        <PullRequestFooter
          card={card}
          onMerge={() => setStage("merging")}
          onResolve={() => {
            setResolved(0)
            setTestsRun(0)
            setStage("resolving")
          }}
          resolved={resolved}
          stage={stage}
          testsRun={testsRun}
        />
      </div>
    </article>
  )
}

export const PullRequestMessageCard = ({
  animateEntry,
  part
}: {
  animateEntry: boolean
  part: ChatToolPart
}) => {
  const card = useMemo(() => getPullRequestCard(part), [part])

  if (!card) {
    return null
  }

  return <PullRequestMergeCard animateEntry={animateEntry} card={card} />
}
