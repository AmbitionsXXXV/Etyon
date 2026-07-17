import { randomUUID } from "node:crypto"

import type { UIMessage } from "ai"
import { and, asc, eq, inArray, lt } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import {
  agentApprovals,
  agentArtifacts,
  agentEvents,
  agentRuns,
  agentToolCalls
} from "@/main/db/schema"
import { isRecord } from "@/renderer/lib/utils"
import { isInputRequiredToolName } from "@/shared/agents/input-tools"

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

export interface DerivedArtifact {
  byteLength: number | null
  kind: string
  metadataJson: string
  path: string
  toolCallId: string
}

export interface DerivedRunRecords {
  approvedToolCallIds: string[]
  artifacts: DerivedArtifact[]
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

// Best-effort, defense-in-depth redaction of obviously-secret tokens before
// they are persisted. Complements the name-based secret-path filter in
// workspace-core. Patterns are deliberately specific to avoid mangling the
// id/status event payloads that also pass through serialize().
const SECRET_TOKEN_PATTERNS: readonly RegExp[] = [
  // OpenAI-style keys
  /\bsk-[A-Za-z0-9]{16,}\b/gu,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/gu,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/gu,
  // Authorization: Bearer ...
  /(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gu,
  // key=value
  /((?:api[_-]?key|secret|password|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/giu
]

const SECRET_PLACEHOLDER = "[REDACTED]"

/** Replaces obviously-secret tokens in a serialized JSON string. Best-effort:
 * it lowers, not eliminates, the chance of persisting a live credential. */
export const redactSecretsFromJson = (json: string): string => {
  let result = json

  for (const pattern of SECRET_TOKEN_PATTERNS) {
    result = result.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string"
        ? `${prefix}${SECRET_PLACEHOLDER}`
        : SECRET_PLACEHOLDER
    )
  }

  return result
}

const serialize = (value: unknown): string => {
  try {
    return redactSecretsFromJson(JSON.stringify(value ?? null))
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

// Only the `artifact` tool publishes artifacts. Generated images are not
// artifacts — they render inline in the message and are not recorded here.
const ARTIFACT_TOOL_NAME = "artifact"

/** Reads the artifact record out of a finished `artifact` tool result. */
const parseArtifactToolOutput = (
  output: unknown
): Omit<DerivedArtifact, "toolCallId"> | null => {
  if (!isRecord(output)) {
    return null
  }

  const kind = typeof output.kind === "string" ? output.kind : null
  const path = typeof output.path === "string" ? output.path : null

  if (!kind || !path) {
    return null
  }

  return {
    byteLength:
      typeof output.byteLength === "number" ? output.byteLength : null,
    kind,
    metadataJson: serialize({
      description:
        typeof output.description === "string" ? output.description : null,
      title: typeof output.title === "string" ? output.title : null
    }),
    path
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
 * Row state override for input-required tools: an unanswered
 * ask_user/propose_plan call stays pending (`requested`) instead of the generic
 * running mapping, and marks the run as waiting on the user.
 */
const resolveDerivedToolCallState = (
  tool: { state: string; toolName: string },
  mappedState: ToolCallState
): { isPendingInput: boolean; state: ToolCallState } => {
  const isPendingInput =
    tool.state === "input-available" && isInputRequiredToolName(tool.toolName)

  return { isPendingInput, state: isPendingInput ? "requested" : mappedState }
}

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
  const artifacts: DerivedArtifact[] = []
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
      // An unanswered ask_user/propose_plan call: the run is waiting on the
      // user's answer exactly like a pending approval, so it must suspend the
      // run (not settle it as succeeded) and the row must stay pending (not be
      // swept to failed by the terminal settlement).
      const { isPendingInput, state } = resolveDerivedToolCallState(
        tool,
        mapped.state
      )
      toolCalls.push({
        approvalColumnState: mapped.approvalColumnState,
        inputJson: serialize(tool.input),
        outputJson:
          tool.output === null || tool.output === undefined
            ? null
            : serialize(tool.output),
        state,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName
      })

      if (
        tool.toolName === ARTIFACT_TOOL_NAME &&
        tool.state === "output-available"
      ) {
        const artifact = parseArtifactToolOutput(tool.output)

        if (artifact) {
          artifacts.push({ ...artifact, toolCallId: tool.toolCallId })
        }
      }

      if (tool.state === "approval-requested") {
        suspended = true

        if (tool.approvalId) {
          pendingApprovals.push({
            approvalId: tool.approvalId,
            toolCallId: tool.toolCallId
          })
        }
      } else if (isPendingInput) {
        suspended = true
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
    artifacts,
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
      const outputJson = serialize(toolCall.output)

      // Upsert (not insert-only): a writable child's edit/write/bash whose row
      // was pre-created at approval time (state `approval_requested`,
      // approvalState `approved`) must be finalized to `finished` with its
      // output, keeping the recorded approvalState. Read-only children never
      // conflict, so their rows insert fresh as `not_required`.
      await tx
        .insert(agentToolCalls)
        .values({
          approvalState: "not_required",
          finishedAt: now,
          id: `${runId}:${toolCall.toolCallId}`,
          inputJson: serialize(toolCall.input),
          outputJson,
          runId,
          startedAt: now,
          state: "finished",
          toolName: toolCall.toolName
        })
        .onConflictDoUpdate({
          set: { finishedAt: now, outputJson, state: "finished" },
          target: agentToolCalls.id
        })
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
 * Approval id for a delegated child's gated tool call. Deterministic so the
 * broker key, the durable row id, and the transient stream part all agree, and
 * so {@link parseChildApprovalId} can recover the run/tool from an oRPC request.
 * `runId` is a UUID (no colon), so the first colon is the unambiguous separator.
 */
export const buildChildApprovalId = (
  runId: string,
  toolCallId: string
): string => `${runId}:${toolCallId}`

export const parseChildApprovalId = (
  approvalId: string
): { runId: string; toolCallId: string } | null => {
  const separatorIndex = approvalId.indexOf(":")

  if (separatorIndex <= 0 || separatorIndex >= approvalId.length - 1) {
    return null
  }

  return {
    runId: approvalId.slice(0, separatorIndex),
    toolCallId: approvalId.slice(separatorIndex + 1)
  }
}

/**
 * Opens a durable pending approval for a writable child's gated tool call:
 * pre-creates the tool-call row (so the approval row's FK resolves and the run
 * inspector shows the request), inserts the pending `agent_approvals` row, and
 * appends `approval.requested`. The actual gating is the in-memory broker; this
 * is the durable trace + the row {@link expireStaleApprovals} later reaps if the
 * app dies mid-approval. Wrap the call in `runExclusiveDbWrite`.
 */
export const recordChildApprovalRequest = async ({
  db,
  input,
  runId,
  toolCallId,
  toolName
}: {
  db: AppDatabase
  input: unknown
  runId: string
  toolCallId: string
  toolName: string
}): Promise<string> => {
  const approvalId = buildChildApprovalId(runId, toolCallId)
  const toolCallRowId = `${runId}:${toolCallId}`
  const now = nowIso()

  await db.transaction(async (tx) => {
    await tx
      .insert(agentToolCalls)
      .values({
        approvalState: "pending",
        id: toolCallRowId,
        inputJson: serialize(input),
        runId,
        startedAt: now,
        state: "approval_requested",
        toolName
      })
      .onConflictDoNothing()
    await tx
      .insert(agentApprovals)
      .values({
        createdAt: now,
        id: approvalId,
        runId,
        state: "pending",
        toolCallId,
        toolCallRowId
      })
      .onConflictDoNothing()
    await tx.insert(agentEvents).values({
      createdAt: now,
      id: randomUUID(),
      payloadJson: serialize({ approvalId, toolCallId, toolName }),
      runId,
      sequence: await countRunEvents(tx, runId),
      type: "approval.requested"
    })
  })

  return approvalId
}

/**
 * Settles a child's pending approval. Idempotent (a no-op if the row is no
 * longer pending) so the abort/expiry path in the child and the oRPC responder
 * can both call it without double-writing. `reason` distinguishes the durable
 * event: user/abort → `approval.responded`, TTL → `approval.expired`. Denied
 * calls also flip the tool-call row to `failed`; an approved call keeps its
 * `approval_requested`/`approved` row until `recordDelegatedRunOutcome`
 * finalizes it. Wrap the call in `runExclusiveDbWrite`.
 */
export const recordChildApprovalResponse = async ({
  approved,
  db,
  reason,
  runId,
  toolCallId
}: {
  approved: boolean
  db: AppDatabase
  reason: "aborted" | "expired" | "responded"
  runId: string
  toolCallId: string
}): Promise<void> => {
  const approvalId = buildChildApprovalId(runId, toolCallId)
  const now = nowIso()

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, approvalId))
      .limit(1)

    if (!existing || existing.state !== "pending") {
      return
    }

    await tx
      .update(agentApprovals)
      .set({ respondedAt: now, state: approved ? "approved" : "denied" })
      .where(eq(agentApprovals.id, approvalId))
    await tx
      .update(agentToolCalls)
      .set({
        approvalState: approved ? "approved" : "denied",
        ...(approved ? {} : { finishedAt: now, state: "failed" })
      })
      .where(eq(agentToolCalls.id, `${runId}:${toolCallId}`))
    await tx.insert(agentEvents).values({
      createdAt: now,
      id: randomUUID(),
      payloadJson: serialize({
        approvalId,
        reason,
        state: approved ? "approved" : "denied",
        toolCallId
      }),
      runId,
      sequence: await countRunEvents(tx, runId),
      type: reason === "expired" ? "approval.expired" : "approval.responded"
    })
  })
}

export type AgentRunExitReason =
  | "aborted"
  | "completed"
  | "max-steps"
  | "model-error"
  | "suspended"

/**
 * Loop-reported outcome used to settle a run. Structurally identical to the
 * agent loop's `AgentLoopOutcome`, declared here so the event store does not
 * depend on the loop module.
 */
export interface AgentRunLoopOutcome {
  errorMessage: string | null
  exitReason: AgentRunExitReason
  finishReason: string | null
  nudged: boolean
  stepCount: number
}

export interface AgentRunStepRecord {
  finishReason: string
  stepIndex: number
  toolCallCount: number
}

/** Appends a `step.finished` event while the loop is running (best-effort). */
export const recordAgentRunStep = async ({
  db,
  runId,
  step
}: {
  db: AppDatabase
  runId: string
  step: AgentRunStepRecord
}): Promise<void> => {
  await db.insert(agentEvents).values({
    createdAt: nowIso(),
    id: randomUUID(),
    payloadJson: serialize(step),
    runId,
    sequence: await countRunEvents(db, runId),
    type: "step.finished"
  })
}

const resolveRunFinishReason = (
  outcome: AgentRunLoopOutcome
): string | null => {
  switch (outcome.exitReason) {
    case "aborted": {
      return "aborted"
    }
    case "max-steps": {
      return "max-steps"
    }
    case "model-error": {
      return "error"
    }
    default: {
      return outcome.finishReason
    }
  }
}

/**
 * Closes a run: appends its tool-call, approval and lifecycle events, links the
 * run to `succeeded`/`suspended`/`failed`, and reconciles any prior pending
 * approvals that this turn resolved (the approve/deny-after-restart path).
 *
 * A `suspended` projection (pending approval parts, or an unanswered
 * ask_user/propose_plan call) always wins so the durable approval and
 * question-resume flows stay intact; otherwise a loop-reported `model-error`
 * settles the run as `failed` instead of a silent success.
 */
export const recordAgentRunOutcome = async ({
  assistantStartIndex,
  db,
  messages,
  outcome = null,
  runId
}: {
  assistantStartIndex: number
  db: AppDatabase
  messages: UIMessage[]
  outcome?: AgentRunLoopOutcome | null
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
  const resolveRunStatus = (): "failed" | "succeeded" | "suspended" => {
    if (derived.runStatus === "suspended") {
      return "suspended"
    }

    if (outcome?.exitReason === "model-error") {
      return "failed"
    }

    return derived.runStatus
  }
  const runStatus = resolveRunStatus()
  const finishReason =
    runStatus === "suspended" || !outcome
      ? null
      : resolveRunFinishReason(outcome)

  await db.transaction(async (tx) => {
    let sequence = startSequence

    for (const toolCall of derived.toolCalls) {
      const toolCallRowId = `${runId}:${toolCall.toolCallId}`
      const isTerminal =
        toolCall.state === "finished" || toolCall.state === "failed"
      // Upsert: a row first written during a suspended turn (state
      // `approval_requested`) must advance to its resumed state instead of
      // being frozen by insert-only conflict handling.
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
        .onConflictDoUpdate({
          set: {
            approvalState: toolCall.approvalColumnState,
            finishedAt: isTerminal ? now : null,
            outputJson: toolCall.outputJson,
            state: toolCall.state
          },
          target: agentToolCalls.id
        })
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

    for (const artifact of derived.artifacts) {
      const artifactId = `${runId}:${artifact.toolCallId}`

      await tx
        .insert(agentArtifacts)
        .values({
          byteLength: artifact.byteLength,
          createdAt: now,
          id: artifactId,
          kind: artifact.kind,
          metadataJson: artifact.metadataJson,
          path: artifact.path,
          runId,
          toolCallId: artifact.toolCallId
        })
        .onConflictDoNothing()
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({
          artifactId,
          kind: artifact.kind,
          path: artifact.path,
          toolCallId: artifact.toolCallId
        }),
        runId,
        sequence,
        type: "artifact.published"
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

    // A prior run left `suspended` on a pending approval never closes on its
    // own once this later turn resolves that approval: the approval row flips to
    // approved/denied, but nothing settles the run row. Mark every other
    // suspended run in this session `superseded` so a session keeps at most one
    // open suspended run instead of leaking them forever.
    const priorSuspendedRunIds = sessionRunIds.filter((id) => id !== runId)

    if (priorSuspendedRunIds.length > 0) {
      const suspendedSiblings = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            inArray(agentRuns.id, priorSuspendedRunIds),
            eq(agentRuns.status, "suspended")
          )
        )

      for (const sibling of suspendedSiblings) {
        await tx
          .update(agentRuns)
          .set({ finishedAt: now, status: "superseded" })
          .where(eq(agentRuns.id, sibling.id))
        await tx.insert(agentEvents).values({
          createdAt: now,
          id: randomUUID(),
          payloadJson: serialize({ supersededByRunId: runId }),
          runId: sibling.id,
          sequence: await countRunEvents(tx, sibling.id),
          type: "run.superseded"
        })
      }
    }

    // A terminal settlement finalizes tool calls the stream left unsettled
    // (abort or crash mid-call), so a closed run can never keep a `running`
    // tool-call row forever.
    if (runStatus !== "suspended") {
      await tx
        .update(agentToolCalls)
        .set({ finishedAt: now, state: "failed" })
        .where(
          and(
            eq(agentToolCalls.runId, runId),
            inArray(agentToolCalls.state, ["requested", "running"])
          )
        )
    }

    if (outcome?.exitReason === "max-steps") {
      await tx.insert(agentEvents).values({
        createdAt: now,
        id: randomUUID(),
        payloadJson: serialize({ stepCount: outcome.stepCount }),
        runId,
        sequence,
        type: "run.truncated"
      })
      sequence += 1
    }

    await tx
      .update(agentRuns)
      .set({
        errorMessage: outcome?.errorMessage ?? null,
        finishedAt: runStatus === "suspended" ? null : now,
        finishReason,
        status: runStatus
      })
      .where(eq(agentRuns.id, runId))

    const resolveFinalEventType = (): string => {
      if (runStatus === "failed") {
        return "run.failed"
      }

      if (runStatus === "suspended") {
        return "run.suspended"
      }

      return "run.succeeded"
    }

    await tx.insert(agentEvents).values({
      createdAt: now,
      id: randomUUID(),
      payloadJson: serialize({
        ...(finishReason ? { finishReason } : {}),
        ...(outcome
          ? { nudged: outcome.nudged, stepCount: outcome.stepCount }
          : {}),
        status: runStatus
      }),
      runId,
      sequence,
      type: resolveFinalEventType()
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
          finishReason: "interrupted",
          status: "failed"
        })
        .where(eq(agentRuns.id, run.id))
      await tx
        .update(agentToolCalls)
        .set({ finishedAt: now, state: "failed" })
        .where(
          and(
            eq(agentToolCalls.runId, run.id),
            inArray(agentToolCalls.state, ["requested", "running"])
          )
        )
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
