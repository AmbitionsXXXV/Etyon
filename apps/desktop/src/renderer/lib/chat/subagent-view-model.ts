import type {
  AgentRunStatus,
  AgentRunTraceRun,
  AgentRunTraceToolCall
} from "@etyon/rpc"

import type {
  ChatToolPart,
  ChatUiMessage
} from "@/renderer/lib/chat/assistant-message-timeline"
import type { SubagentLiveState } from "@/renderer/lib/chat/subagent-stream-store"
import {
  parseDelegateToolInput,
  parseDelegateToolOutput,
  WORKFLOW_CHILD_PROFILE_ID
} from "@/shared/agents/subagent-tools"
import type {
  ChatSubagentApprovalData,
  ChatSubagentEndState
} from "@/shared/chat/stream-data"

/**
 * Pure view-model layer for a nested sub-agent row. Collapses the three status
 * mappings, the `getString()` output digs, and the two ad-hoc `UIMessage` casts
 * that used to live inline in `assistant-message-timeline.tsx` into a single
 * data shape three adapters (live stream / delegate history part / workflow
 * child run) produce and one presentational row consumes. Free of React and of
 * `@/renderer/lib/rpc` so the derivation stays node-testable.
 */

/** Running, or one of the three settled outcomes a nested row can display. */
export type SubagentDisplayStatus = "running" | ChatSubagentEndState

/** Run status → displayed sub-agent status: superseded reads as an abort, and a
 * still-live run (running/suspended) stays "running". */
export const subagentStatusFromRunStatus = (
  status: AgentRunStatus
): SubagentDisplayStatus => {
  if (status === "succeeded") {
    return "succeeded"
  }

  if (status === "failed") {
    return "failed"
  }

  if (status === "superseded") {
    return "aborted"
  }

  return "running"
}

/** Delegate tool part state → displayed status: a delivered output succeeded, an
 * errored/denied output failed, anything earlier is still running. */
export const subagentStatusFromPartState = (
  part: Pick<ChatToolPart, "state">
): SubagentDisplayStatus => {
  if (part.state === "output-available") {
    return "succeeded"
  }

  if (part.state === "output-error" || part.state === "output-denied") {
    return "failed"
  }

  return "running"
}

/** Whether a run status is still in flight (drives the history refetch loop). */
export const isUnsettledRunStatus = (status: AgentRunStatus): boolean =>
  status === "running" || status === "suspended"

/**
 * Body of a sub-agent row: live message parts reduced from the stream, a lazily
 * fetched history trace (by run id), a legacy summary string, or nothing.
 */
export type SubagentRowBody =
  | { isRunActive: boolean; kind: "live-parts"; parts: ChatUiMessage["parts"] }
  | { kind: "none" }
  | { kind: "summary"; text: string }
  | { kind: "trace"; runId: string }

/** Everything the single presentational sub-agent row needs, regardless of
 * whether it was derived from the live store, a delegate tool part, or a
 * recorded workflow child run. */
export interface SubagentRowViewModel {
  activity?: string
  approvals: ChatSubagentApprovalData[]
  body: SubagentRowBody
  durationMs?: number
  origin: "delegate" | "workflow"
  profileId: string
  startedAtMs?: number
  status: SubagentDisplayStatus
  task?: string
}

const getPartInput = (part: ChatToolPart): unknown =>
  (part as { input?: unknown }).input

const getPartOutput = (part: ChatToolPart): unknown =>
  (part as { output?: unknown }).output

/**
 * Widens the live store's parts to the typed chat message parts. The subagent
 * chunk reducer only ever emits text, reasoning, and tool parts, all
 * structurally identical between the generic `UIMessage` the store holds and the
 * typed `ChatUiMessage`; the data-part / metadata generics that differ between
 * the two never appear here, so the single contained assertion is sound.
 */
export const liveSubagentParts = (
  parts: SubagentLiveState["parts"]
): ChatUiMessage["parts"] => parts as ChatUiMessage["parts"]

/**
 * Maps a settled child run's recorded tool calls into renderable message parts
 * for the mini timeline: a failed call becomes an `output-error` part, every
 * other state an `output-available` one, carrying the recorded input/output.
 */
export const traceToolCallsToParts = (
  toolCalls: readonly AgentRunTraceToolCall[]
): ChatUiMessage["parts"] =>
  toolCalls.map((toolCall) => {
    const base = {
      input: toolCall.input,
      toolCallId: toolCall.id,
      type: `tool-${toolCall.toolName}`
    }

    if (toolCall.state === "failed") {
      return {
        ...base,
        errorText: toolCall.errorMessage ?? "error",
        state: "output-error"
      } as ChatUiMessage["parts"][number]
    }

    return {
      ...base,
      output: toolCall.output,
      state: "output-available"
    } as ChatUiMessage["parts"][number]
  })

/** Live delegated/workflow child → row VM (a running row can still tick a timer
 * and surface pending approvals). Live rows always fall back to the "delegated
 * task" title, so their origin is `delegate`. */
export const liveSubagentViewModel = (
  live: SubagentLiveState,
  approvals: ChatSubagentApprovalData[]
): SubagentRowViewModel => ({
  activity: live.activity,
  approvals,
  body: {
    isRunActive: live.status === "running",
    kind: "live-parts",
    parts: liveSubagentParts(live.parts)
  },
  durationMs: live.durationMs,
  origin: "delegate",
  profileId: live.meta.profileId,
  startedAtMs: live.startedAtMs,
  status: live.status,
  task: live.meta.task
})

/** Settled delegate tool part → row VM. Profile/task come from the recorded
 * input; a recorded child run id opens a lazy trace body, else the summary
 * string, else nothing. History delegate rows never show a timer. */
export const delegatePartViewModel = (
  part: ChatToolPart
): SubagentRowViewModel => {
  const input = parseDelegateToolInput(getPartInput(part))
  const output: { childRunId?: string; summary?: string } =
    part.state === "output-available"
      ? parseDelegateToolOutput(getPartOutput(part))
      : {}

  let body: SubagentRowBody = { kind: "none" }

  if (output.childRunId) {
    body = { kind: "trace", runId: output.childRunId }
  } else if (output.summary) {
    body = { kind: "summary", text: output.summary }
  }

  return {
    approvals: [],
    body,
    origin: "delegate",
    profileId: input.profileId ?? "",
    status: subagentStatusFromPartState(part),
    task: input.task
  }
}

/** Recorded workflow child run → row VM. A duration shows only once the run has
 * a finished timestamp (clamped non-negative); the body always opens a lazy
 * trace of the child's recorded tool calls. */
export const workflowChildRunViewModel = (
  run: AgentRunTraceRun
): SubagentRowViewModel => ({
  approvals: [],
  body: { kind: "trace", runId: run.id },
  durationMs: run.finishedAt
    ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))
    : undefined,
  origin: "workflow",
  profileId: run.profileId,
  status: subagentStatusFromRunStatus(run.status)
})

/**
 * Selects a workflow card's history children out of the runs listed under its
 * parent run (listed newest-first), returned chronologically:
 *
 * 1. runs tagged with this exact workflow tool call id — the precise match;
 * 2. no tagged match but some run does record a parent tool call → none belong
 *    to this call (post-migration data), so return nothing;
 * 3. pure legacy rows (every parent tool call id null) → fall back to the
 *    read-only workflow profile filter that predates the recorded id.
 */
export const selectWorkflowChildRuns = (
  runs: readonly AgentRunTraceRun[],
  workflowToolCallId: string
): AgentRunTraceRun[] => {
  const tagged = runs.filter(
    (run) => run.parentToolCallId === workflowToolCallId
  )

  if (tagged.length > 0) {
    return tagged.toReversed()
  }

  if (runs.some((run) => run.parentToolCallId !== null)) {
    return []
  }

  return runs
    .filter((run) => run.profileId === WORKFLOW_CHILD_PROFILE_ID)
    .toReversed()
}
