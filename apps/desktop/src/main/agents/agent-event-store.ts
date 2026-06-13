import { randomUUID } from "node:crypto"

import type { UIMessage } from "ai"
import { and, asc, eq, inArray, lt } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import {
  agentApprovals,
  agentEvents,
  agentRuns,
  agentToolCalls
} from "@/main/db/schema"
import { isRecord } from "@/renderer/lib/utils"

/**
 * Event-sourced agent run log.
 *
 * Every agent turn opens an `agent_runs` row and appends ordered, insert-only
 * rows to `agent_events` (plus `agent_tool_calls` / `agent_approvals`
 * projections). The chat transcript stays a fast read-model in `chat_messages`,
 * linked back to its run via `chat_messages.agent_projection_run_id`, and can be
 * rebuilt from the event log via {@link buildRunProjection}. A crash leaves a
 * `running` row that {@link recoverInterruptedAgentRuns} closes on next launch,
 * and pending approvals are durable so they survive a restart and expire after
 * {@link APPROVAL_TTL_MS}.
 */

const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RUN_STARTED_SEQUENCE = 0
const TOOL_PART_PREFIX = "tool-"
const NON_TOOL_PART_TYPES = new Set([
  "tool-approval-request",
  "tool-approval-response"
])

type AppReader = Pick<AppDatabase, "select">

type ToolCallState =
  | "approval_requested"
  | "failed"
  | "finished"
  | "requested"
  | "running"
type ApprovalColumnState = "approved" | "denied" | "not_required" | "pending"

interface DerivedToolCall {
  approvalColumnState: ApprovalColumnState
  inputJson: string
  outputJson: string | null
  state: ToolCallState
  toolCallId: string
  toolName: string
}

interface DerivedApproval {
  approvalId: string
  toolCallId: string
}

export interface DerivedRunRecords {
  approvedToolCallIds: string[]
  deniedToolCallIds: string[]
  pendingApprovals: DerivedApproval[]
  runStatus: "succeeded" | "suspended"
  toolCalls: DerivedToolCall[]
}

export interface AgentRunProjectionEvent {
  payload: unknown
  sequence: number
  type: string
}

export interface AgentRunProjection {
  events: AgentRunProjectionEvent[]
  run: typeof agentRuns.$inferSelect
}

const nowIso = (): string => new Date().toISOString()

const serialize = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return "null"
  }
}

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

interface ParsedToolPart {
  approvalId: string | null
  input: unknown
  output: unknown
  state: string
  toolCallId: string
  toolName: string
}

const parseToolPart = (part: unknown): ParsedToolPart | null => {
  if (!isRecord(part)) {
    return null
  }

  const type = typeof part.type === "string" ? part.type : ""

  if (NON_TOOL_PART_TYPES.has(type)) {
    return null
  }

  const isDynamic = type === "dynamic-tool"
  const isStatic = type.startsWith(TOOL_PART_PREFIX)

  if (!(isDynamic || isStatic)) {
    return null
  }

  const toolCallId =
    typeof part.toolCallId === "string" ? part.toolCallId : null

  if (!toolCallId) {
    return null
  }

  const dynamicToolName =
    typeof part.toolName === "string" ? part.toolName : "unknown"
  const toolName = isDynamic
    ? dynamicToolName
    : type.slice(TOOL_PART_PREFIX.length)
  const approvalId =
    isRecord(part.approval) && typeof part.approval.id === "string"
      ? part.approval.id
      : null

  return {
    approvalId,
    input: part.input,
    output: part.output ?? part.errorText ?? null,
    state: typeof part.state === "string" ? part.state : "input-available",
    toolCallId,
    toolName
  }
}

const mapToolPartState = (
  state: string
): { approvalColumnState: ApprovalColumnState; state: ToolCallState } => {
  switch (state) {
    case "approval-requested": {
      return { approvalColumnState: "pending", state: "approval_requested" }
    }
    case "approval-responded": {
      return { approvalColumnState: "approved", state: "running" }
    }
    case "output-available": {
      return { approvalColumnState: "not_required", state: "finished" }
    }
    case "output-denied": {
      return { approvalColumnState: "denied", state: "failed" }
    }
    case "output-error": {
      return { approvalColumnState: "not_required", state: "failed" }
    }
    default: {
      return { approvalColumnState: "not_required", state: "running" }
    }
  }
}

/**
 * The index of the first message produced by the latest agent turn: everything
 * after the last user message. Used so we only record this run's output.
 */
export const getRunAssistantStartIndex = (messages: UIMessage[]): number =>
  messages.findLastIndex((message) => message.role === "user") + 1

/**
 * Pure projection of a turn's assistant messages into run records. Exported for
 * unit tests; defensive so unknown part shapes are ignored rather than thrown.
 */
export const deriveAgentRunRecords = ({
  assistantStartIndex,
  messages
}: {
  assistantStartIndex: number
  messages: UIMessage[]
}): DerivedRunRecords => {
  const toolCalls: DerivedToolCall[] = []
  const pendingApprovals: DerivedApproval[] = []
  const approvedToolCallIds: string[] = []
  const deniedToolCallIds: string[] = []
  const seenToolCallIds = new Set<string>()
  let suspended = false

  for (let index = assistantStartIndex; index < messages.length; index += 1) {
    const message = messages[index]

    if (!message || message.role !== "assistant") {
      continue
    }

    for (const part of message.parts) {
      const tool = parseToolPart(part)

      if (!tool || seenToolCallIds.has(tool.toolCallId)) {
        continue
      }

      seenToolCallIds.add(tool.toolCallId)
      const mapped = mapToolPartState(tool.state)
      toolCalls.push({
        approvalColumnState: mapped.approvalColumnState,
        inputJson: serialize(tool.input),
        outputJson:
          tool.output === null || tool.output === undefined
            ? null
            : serialize(tool.output),
        state: mapped.state,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName
      })

      if (tool.state === "approval-requested") {
        suspended = true

        if (tool.approvalId) {
          pendingApprovals.push({
            approvalId: tool.approvalId,
            toolCallId: tool.toolCallId
          })
        }
      } else if (
        tool.state === "output-available" ||
        tool.state === "approval-responded"
      ) {
        approvedToolCallIds.push(tool.toolCallId)
      } else if (tool.state === "output-denied") {
        deniedToolCallIds.push(tool.toolCallId)
      }
    }
  }

  return {
    approvedToolCallIds,
    deniedToolCallIds,
    pendingApprovals,
    runStatus: suspended ? "suspended" : "succeeded",
    toolCalls
  }
}

const countRunEvents = async (
  reader: AppReader,
  runId: string
): Promise<number> => {
  const rows = await reader
    .select({ id: agentEvents.id })
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))

  return rows.length
}

/** Opens a run before the stream starts so a crash leaves a recoverable row. */
export const startAgentRun = async ({
  chatSessionId,
  db,
  modelId,
  parentRunId = null,
  profileId
}: {
  chatSessionId: string
  db: AppDatabase
  modelId: string | null
  parentRunId?: string | null
  profileId: string
}): Promise<string> => {
  const runId = randomUUID()
  const now = nowIso()

  await db.transaction(async (tx) => {
    await tx.insert(agentRuns).values({
      chatSessionId,
      id: runId,
      modelId,
      parentRunId,
      profileId,
      startedAt: now,
      status: "running"
    })
    await tx.insert(agentEvents).values({
      createdAt: now,
      id: randomUUID(),
      payloadJson: serialize({ parentRunId, profileId }),
      runId,
      sequence: RUN_STARTED_SEQUENCE,
      type: "run.started"
    })
  })

  return runId
}

export interface DelegatedToolCallRecord {
  input: unknown
  output: unknown
  toolCallId: string
  toolName: string
}

/**
 * Closes a delegated child run started by the `delegate` tool. Child runs use a
 * headless AI SDK loop (not UIMessages), so their tool calls are recorded
 * directly here rather than derived from a chat projection.
 */
export const recordDelegatedRunOutcome = async ({
  db,
  errorMessage = null,
  runId,
  status,
  toolCalls
}: {
  db: AppDatabase
  errorMessage?: string | null
  runId: string
  status: "failed" | "succeeded"
  toolCalls: readonly DelegatedToolCallRecord[]
}): Promise<void> => {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)

  if (!run) {
    return
  }

  const now = nowIso()
  const startSequence = await countRunEvents(db, runId)

  await db.transaction(async (tx) => {
    let sequence = startSequence

    for (const toolCall of toolCalls) {
      await tx
        .insert(agentToolCalls)
        .values({
          approvalState: "not_required",
          finishedAt: now,
          id: `${runId}:${toolCall.toolCallId}`,
          inputJson: serialize(toolCall.input),
          outputJson: serialize(toolCall.output),
          runId,
          startedAt: now,
          state: "finished",
          toolName: toolCall.toolName
        })
        .onConflictDoNothing()
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        }),
        runId,
        sequence,
        type: "tool.result"
      })
      sequence += 1
    }

    await tx
      .update(agentRuns)
      .set({ errorMessage, finishedAt: now, status })
      .where(eq(agentRuns.id, runId))
    await tx.insert(agentEvents).values({
      createdAt: now,
      id: randomUUID(),
      payloadJson: serialize({ status }),
      runId,
      sequence,
      type: status === "succeeded" ? "run.succeeded" : "run.failed"
    })
  })
}

/**
 * Closes a run: appends its tool-call, approval and lifecycle events, links the
 * run to `succeeded`/`suspended`, and reconciles any prior pending approvals
 * that this turn resolved (the approve/deny-after-restart path).
 */
export const recordAgentRunOutcome = async ({
  assistantStartIndex,
  db,
  messages,
  runId
}: {
  assistantStartIndex: number
  db: AppDatabase
  messages: UIMessage[]
  runId: string
}): Promise<void> => {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)

  if (!run) {
    return
  }

  const derived = deriveAgentRunRecords({ assistantStartIndex, messages })
  const now = nowIso()
  const startSequence = await countRunEvents(db, runId)

  await db.transaction(async (tx) => {
    let sequence = startSequence

    for (const toolCall of derived.toolCalls) {
      const toolCallRowId = `${runId}:${toolCall.toolCallId}`
      const isTerminal =
        toolCall.state === "finished" || toolCall.state === "failed"
      await tx
        .insert(agentToolCalls)
        .values({
          approvalState: toolCall.approvalColumnState,
          finishedAt: isTerminal ? now : null,
          id: toolCallRowId,
          inputJson: toolCall.inputJson,
          outputJson: toolCall.outputJson,
          runId,
          startedAt: now,
          state: toolCall.state,
          toolName: toolCall.toolName
        })
        .onConflictDoNothing()
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({
          state: toolCall.state,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        }),
        runId,
        sequence,
        type: toolCall.state === "finished" ? "tool.result" : "tool.call"
      })
      sequence += 1
    }

    for (const approval of derived.pendingApprovals) {
      await tx
        .insert(agentApprovals)
        .values({
          createdAt: now,
          id: randomUUID(),
          runId,
          state: "pending",
          toolCallId: approval.toolCallId,
          toolCallRowId: `${runId}:${approval.toolCallId}`
        })
        .onConflictDoNothing()
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({
          approvalId: approval.approvalId,
          toolCallId: approval.toolCallId
        }),
        runId,
        sequence,
        type: "approval.requested"
      })
      sequence += 1
    }

    const sessionRunRows = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.chatSessionId, run.chatSessionId))
    const sessionRunIds = sessionRunRows.map((row) => row.id)

    const resolvePriorApprovals = async (
      toolCallIds: string[],
      state: "approved" | "denied"
    ): Promise<void> => {
      if (toolCallIds.length === 0) {
        return
      }

      const pendingRows = await tx
        .select()
        .from(agentApprovals)
        .where(
          and(
            inArray(agentApprovals.runId, sessionRunIds),
            inArray(agentApprovals.toolCallId, toolCallIds),
            eq(agentApprovals.state, "pending")
          )
        )

      for (const pending of pendingRows) {
        await tx
          .update(agentApprovals)
          .set({ respondedAt: now, state })
          .where(eq(agentApprovals.id, pending.id))
        await tx.insert(agentEvents).values({
          createdAt: now,
          id: randomUUID(),
          payloadJson: serialize({
            approvalId: pending.id,
            state,
            toolCallId: pending.toolCallId
          }),
          runId,
          sequence,
          type: "approval.responded"
        })
        sequence += 1
      }
    }

    await resolvePriorApprovals(derived.approvedToolCallIds, "approved")
    await resolvePriorApprovals(derived.deniedToolCallIds, "denied")

    await tx
      .update(agentRuns)
      .set({
        finishedAt: derived.runStatus === "suspended" ? null : now,
        status: derived.runStatus
      })
      .where(eq(agentRuns.id, runId))
    await tx.insert(agentEvents).values({
      createdAt: now,
      id: randomUUID(),
      payloadJson: serialize({ status: derived.runStatus }),
      runId,
      sequence,
      type:
        derived.runStatus === "suspended" ? "run.suspended" : "run.succeeded"
    })
  })
}

/**
 * Startup recovery: a `running` row can only exist if the previous process
 * exited mid-turn, so close those as `failed`. Suspended runs (legitimately
 * waiting for a durable approval) are left intact.
 */
export const recoverInterruptedAgentRuns = async ({
  db,
  now = nowIso()
}: {
  db: AppDatabase
  now?: string
}): Promise<number> => {
  const interrupted = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.status, "running"))

  if (interrupted.length === 0) {
    return 0
  }

  await db.transaction(async (tx) => {
    for (const run of interrupted) {
      await tx
        .update(agentRuns)
        .set({
          errorMessage: "Interrupted by app restart",
          finishedAt: now,
          status: "failed"
        })
        .where(eq(agentRuns.id, run.id))
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({ reason: "interrupted" }),
        runId: run.id,
        sequence: await countRunEvents(tx, run.id),
        type: "run.recovered"
      })
    }
  })

  return interrupted.length
}

/** Expires pending approvals older than the TTL and fails their suspended runs. */
export const expireStaleApprovals = async ({
  db,
  now = nowIso(),
  ttlMs = APPROVAL_TTL_MS
}: {
  db: AppDatabase
  now?: string
  ttlMs?: number
}): Promise<number> => {
  const cutoff = new Date(Date.parse(now) - ttlMs).toISOString()
  const stale = await db
    .select()
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.state, "pending"),
        lt(agentApprovals.createdAt, cutoff)
      )
    )

  if (stale.length === 0) {
    return 0
  }

  await db.transaction(async (tx) => {
    for (const approval of stale) {
      await tx
        .update(agentApprovals)
        .set({ respondedAt: now, state: "denied" })
        .where(eq(agentApprovals.id, approval.id))
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({
          approvalId: approval.id,
          reason: "ttl-expired",
          toolCallId: approval.toolCallId
        }),
        runId: approval.runId,
        sequence: await countRunEvents(tx, approval.runId),
        type: "approval.expired"
      })
      await tx
        .update(agentRuns)
        .set({
          errorMessage: "Approval expired",
          finishedAt: now,
          status: "failed"
        })
        .where(
          and(
            eq(agentRuns.id, approval.runId),
            eq(agentRuns.status, "suspended")
          )
        )
    }
  })

  return stale.length
}

/** Rebuilds a run's ordered timeline from the event log (the projector). */
export const buildRunProjection = async ({
  db,
  runId
}: {
  db: AppDatabase
  runId: string
}): Promise<AgentRunProjection | null> => {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)

  if (!run) {
    return null
  }

  const events = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))
    .orderBy(asc(agentEvents.sequence))

  return {
    events: events.map((event) => ({
      payload: safeParse(event.payloadJson),
      sequence: event.sequence,
      type: event.type
    })),
    run
  }
}
