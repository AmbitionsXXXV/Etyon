import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { isRecord } from "@/renderer/lib/utils"
import {
  PULL_REQUEST_TOOL_NAME,
  PULL_REQUEST_TOOL_PART_TYPE,
  PullRequestCardSchema
} from "@/shared/chat/pull-request"
import type {
  PullRequestCard,
  PullRequestCommit,
  PullRequestLane
} from "@/shared/chat/pull-request"

/**
 * View model for the inline PR merge card. The card walks one PR through
 * checking → conflicts → resolving → testing → ready → merging → merged; this
 * file holds the stage rules and the commit graph geometry so the component
 * only renders.
 */

export const PULL_REQUEST_STAGES = [
  "checking",
  "conflicts",
  "resolving",
  "testing",
  "ready",
  "merging",
  "merged"
] as const

export type PullRequestStage = (typeof PULL_REQUEST_STAGES)[number]

/** Stages after the resolve step committed the base branch into the head. */
const STAGES_WITH_MERGE_COMMIT = new Set<PullRequestStage>([
  "merged",
  "merging",
  "ready",
  "resolving",
  "testing"
])

export const isPullRequestToolPart = (part: unknown): boolean => {
  if (!isRecord(part)) {
    return false
  }

  if (part.type === PULL_REQUEST_TOOL_PART_TYPE) {
    return true
  }

  return (
    part.type === "dynamic-tool" && part.toolName === PULL_REQUEST_TOOL_NAME
  )
}

/** The card data once the tool call finished; null before that or if invalid. */
export const getPullRequestCard = (
  part: ChatToolPart
): PullRequestCard | null => {
  const { output, state } = part as { output?: unknown; state?: unknown }

  if (!isPullRequestToolPart(part) || state !== "output-available") {
    return null
  }

  const parsed = PullRequestCardSchema.safeParse(output)

  return parsed.success ? parsed.data : null
}

export const getStageAfterChecking = (
  card: PullRequestCard
): PullRequestStage => (card.conflicts.length > 0 ? "conflicts" : "ready")

/**
 * Where the card opens. A card arriving in a live run plays the merge check
 * first; one reopened from history skips straight to its outcome.
 */
export const getInitialPullRequestStage = (
  card: PullRequestCard,
  animateEntry: boolean
): PullRequestStage => {
  if (animateEntry) {
    return "checking"
  }

  return getStageAfterChecking(card)
}

// Graph geometry: one 30px row per commit, lanes 14px apart.
export const GRAPH_ROW_HEIGHT = 30
export const GRAPH_WIDTH = 52
const ROW_CENTER = GRAPH_ROW_HEIGHT / 2
const LANE_X: Record<PullRequestLane, number> = { base: 8, head: 22, side: 36 }

export type PullRequestDot =
  | "base"
  | "conflict"
  | "head"
  | "merged"
  | "ring"
  | "ring-merged"
  | "side"

export type PullRequestRowTone = "conflict" | "muted" | "primary"

export type PullRequestRowHighlight = "active" | "merged" | "scan" | null

export interface PullRequestGraphPaths {
  base: string
  baseDashed: string
  head: string
  side: string
}

export interface PullRequestRow {
  /** Conflicts this base commit still carries; undefined once resolved. */
  badge?: number
  commit: PullRequestCommit
  dot: PullRequestDot
  dotX: number
  highlight: PullRequestRowHighlight
  isMergeCommit: boolean
  paths: PullRequestGraphPaths
  /** Shows a check once the resolve step cleared this commit's conflicts. */
  resolved: boolean
  showBranch: boolean
  tone: PullRequestRowTone
}

const getGraphPaths = ({
  isLast,
  isMergeCommit,
  sideStarts,
  sideState
}: {
  isLast: boolean
  isMergeCommit: boolean
  sideStarts: boolean
  sideState: "active" | "none"
}): PullRequestGraphPaths => {
  const { base, head, side } = LANE_X
  const bottom = GRAPH_ROW_HEIGHT

  if (isLast) {
    // The fork point: the head and side lanes curve back into the base.
    return {
      base: `M${base} 0 V${ROW_CENTER}`,
      baseDashed: `M${base} ${ROW_CENTER} V${bottom}`,
      head: `M${head} 0 C${head} 9 ${base} 9 ${base} ${ROW_CENTER}`,
      side:
        sideState === "active"
          ? `M${side} 0 C${side} 10 ${base} 9 ${base} ${ROW_CENTER}`
          : ""
    }
  }

  let sidePath = ""

  if (sideStarts) {
    sidePath = `M${side} ${ROW_CENTER} V${bottom}`
  } else if (sideState === "active") {
    sidePath = `M${side} 0 V${bottom}`
  }

  if (isMergeCommit) {
    // The base branch flows up into the merge commit's ring.
    return {
      base: `M${base} 0 V${bottom} M${base} ${bottom} C${base} 22 ${head} 24 ${head} 19`,
      baseDashed: "",
      head: `M${head} 0 V11 M${head} 19 V${bottom}`,
      side: sidePath
    }
  }

  return {
    base: `M${base} 0 V${bottom}`,
    baseDashed: "",
    head: `M${head} 0 V${bottom}`,
    side: sidePath
  }
}

/**
 * Each conflicting base commit clears once the resolve step has worked through
 * its hunks, in commit order: with 1 + 2 conflicts, the first clears at 1 and
 * the second at 3.
 */
const getConflictThresholds = (commits: PullRequestCommit[]): number[] => {
  let total = 0

  return commits.map((commit) => {
    total += commit.conflicts ?? 0

    return total
  })
}

const getRowDot = ({
  commit,
  isMergeCommit,
  isMerged,
  isOpenConflict
}: {
  commit: PullRequestCommit
  isMergeCommit: boolean
  isMerged: boolean
  isOpenConflict: boolean
}): PullRequestDot => {
  if (isMergeCommit) {
    return isMerged ? "ring-merged" : "ring"
  }

  if (isOpenConflict) {
    return "conflict"
  }

  if (isMerged && commit.lane === "head") {
    return "merged"
  }

  return commit.lane
}

const getRowHighlight = ({
  commit,
  isMergeCommit,
  isMerged,
  stage
}: {
  commit: PullRequestCommit
  isMergeCommit: boolean
  isMerged: boolean
  stage: PullRequestStage
}): PullRequestRowHighlight => {
  if (stage === "checking" && commit.conflicts) {
    return "scan"
  }

  if (isMerged && commit.lane === "head") {
    return "merged"
  }

  if (stage === "resolving" && isMergeCommit) {
    return "active"
  }

  return null
}

export const buildPullRequestRows = ({
  card,
  resolved,
  stage
}: {
  card: PullRequestCard
  /** Conflicts the resolve step has cleared so far. */
  resolved: number
  stage: PullRequestStage
}): PullRequestRow[] => {
  const hasMergeCommit = STAGES_WITH_MERGE_COMMIT.has(stage)
  const commits = hasMergeCommit
    ? [card.mergeCommit, ...card.commits]
    : card.commits
  const thresholds = getConflictThresholds(commits)
  const sideStart = commits.findIndex((commit) => commit.lane === "side")
  const conflictsLive = stage === "conflicts" || stage === "resolving"
  const isMerged = stage === "merged"

  return commits.map((commit, index) => {
    const isMergeCommit = hasMergeCommit && index === 0
    const threshold = thresholds[index] ?? 0
    const isOpenConflict =
      Boolean(commit.conflicts) && conflictsLive && resolved < threshold
    const showResolved =
      Boolean(commit.conflicts) &&
      ((stage === "resolving" && resolved >= threshold) || stage === "testing")
    let tone: PullRequestRowTone = "muted"

    if (isOpenConflict) {
      tone = "conflict"
    } else if (commit.lane === "head") {
      tone = "primary"
    }

    return {
      ...(isOpenConflict ? { badge: commit.conflicts } : {}),
      commit,
      dot: getRowDot({ commit, isMergeCommit, isMerged, isOpenConflict }),
      dotX: LANE_X[commit.lane],
      highlight: getRowHighlight({ commit, isMergeCommit, isMerged, stage }),
      isMergeCommit,
      paths: getGraphPaths({
        isLast: index === commits.length - 1,
        isMergeCommit,
        sideStarts: index === sideStart,
        sideState: sideStart !== -1 && index >= sideStart ? "active" : "none"
      }),
      resolved: showResolved,
      // Once the merge commit lands it carries the head branch's label.
      showBranch:
        Boolean(commit.branch) &&
        !(
          hasMergeCommit &&
          !isMergeCommit &&
          commit.branch === card.headBranch
        ),
      tone
    }
  })
}

/** How many tests the simulated run adds per tick. */
export const TESTS_PER_TICK = 3

export const getNextTestCount = (current: number, total: number): number =>
  Math.min(total, current + TESTS_PER_TICK)
