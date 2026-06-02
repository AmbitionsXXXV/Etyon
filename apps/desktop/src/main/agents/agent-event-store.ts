import { randomUUID } from "node:crypto"

import { and, asc, desc, eq, isNull, max, or } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import {
  agentApprovals,
  agentArtifacts,
  agentEvents,
  agentRuns,
  agentToolCalls,
  chatSessions
} from "@/main/db/schema"

export type AgentEventType =
  | "agent_model_fallback_used"
  | "agent_tool_result_summary_cached"
  | "agent_run_graph_checkpoint_created"
  | "agent_run_graph_instantiated"
  | "agent_run_graph_node_failed"
  | "agent_run_graph_node_retrying"
  | "agent_run_graph_node_resumed"
  | "agent_run_graph_node_skipped"
  | "agent_run_graph_node_started"
  | "agent_run_graph_node_succeeded"
  | "agent_run_graph_node_suspended"
  | "agent_run_graph_retry_policy_updated"
  | "agent_run_graph_stage_started"
  | "agent_loop_event"
  | "agent_run_failed"
  | "agent_run_finished"
  | "agent_run_started"
  | "agent_runtime_snapshot_created"
  | "agent_session_entry_appended"
  | "agent_session_runtime_disposed"
  | "agent_session_runtime_disposing"
  | "agent_session_runtime_started"
  | "agent_session_runtime_starting"
  | "agent_session_save_point_created"
  | "agent_stream_disconnected"
  | "agent_ui_stream_snapshot_created"
  | "agent_step_finished"
  | "agent_step_started"
  | "background_process_finished"
  | "background_process_output"
  | "background_process_started"
  | "lsp_diagnostics_collected"
  | "lsp_server_started"
  | "plan_step_completed"
  | "sandbox_command_finished"
  | "sandbox_command_output"
  | "sandbox_command_started"
  | "plan_validated"
  | "subagent_finished"
  | "subagent_started"
  | "tool_call_approval_requested"
  | "tool_call_approved"
  | "tool_call_delta"
  | "tool_call_denied"
  | "tool_call_failed"
  | "tool_call_finished"
  | "tool_call_requested"
  | "tool_call_started"

export interface AgentEvent {
  createdAt: string
  id: string
  payload: unknown
  runId: string
  sequence: number
  type: string
}

export interface AgentEventNotification extends AgentEvent {
  chatSessionId: string
}

export type AgentEventListener = (event: AgentEventNotification) => void

export interface AgentRun {
  appendEvent: (event: AppendAgentEventInput) => Promise<AgentEvent>
  chatSessionId: string
  errorMessage: string | null
  finishedAt: string | null
  id: string
  modelId: string | null
  parentRunId: string | null
  profileId: string
  startedAt: string
  status: "failed" | "running" | "succeeded" | "suspended"
}

export interface AgentToolCall {
  approvalState: "approved" | "denied" | "not_required" | "pending"
  errorMessage: string | null
  finishedAt: string | null
  id: string
  input: unknown
  output: unknown
  parentToolCallId: string | null
  runId: string
  startedAt: string
  state: "approval_requested" | "failed" | "finished" | "requested" | "running"
  toolName: string
}

export interface AgentArtifact {
  byteLength: number | null
  createdAt: string
  id: string
  kind: string
  metadata: unknown
  path: string
  runId: string
  toolCallId: string | null
}

export interface PendingAgentApproval extends AgentToolCall {
  approvalId: string | null
  chatSessionId: string
  profileId: string
  runStatus: AgentRun["status"]
}

export interface AppendAgentEventInput {
  payload?: unknown
  type: AgentEventType
}

export interface CreateAgentRunOptions {
  chatSessionId: string
  db: AppDatabase
  modelId?: string | null
  parentRunId?: string | null
  profileId: string
}

export interface GetActiveAgentRunForSessionOptions {
  chatSessionId: string
  db: AppDatabase
}

export interface GetLatestCompletedAgentRunForSessionOptions {
  chatSessionId: string
  db: AppDatabase
}

export interface GetAgentRunForToolCallOptions {
  chatSessionId?: string
  db: AppDatabase
  pendingApprovalOnly?: boolean
  toolCallId: string
}

export interface GetAgentRunForToolApprovalOptions {
  approvalId: string
  chatSessionId?: string
  db: AppDatabase
  pendingApprovalOnly?: boolean
  toolCallId?: string
}

export interface GetAgentRunOptions {
  chatSessionId?: string
  db: AppDatabase
  projectPath?: string
  runId: string
}

export interface GetAgentArtifactOptions {
  artifactId: string
  chatSessionId?: string
  db: AppDatabase
  projectPath?: string
}

export interface ListAgentEventsOptions {
  db: AppDatabase
  runId: string
}

export interface ListAgentToolCallsOptions {
  db: AppDatabase
  runId: string
}

export interface ListAgentArtifactsOptions {
  db: AppDatabase
  runId: string
}

export interface ListAgentRunsOptions {
  chatSessionId?: string
  db: AppDatabase
  limit?: number
}

export interface ListPendingAgentApprovalsOptions {
  chatSessionId?: string
  db: AppDatabase
}

export interface ListRecoverableAgentRunsOptions {
  chatSessionId?: string
  db: AppDatabase
}

export interface RecoverInterruptedAgentRunsOptions {
  approvalTtlMs?: number
  db: AppDatabase
  now?: Date
}

export interface RecoverInterruptedAgentRunsResult {
  expiredApprovalRunIds: string[]
  failedRunIds: string[]
  suspendedRunIds: string[]
}

export interface RecordAgentToolCallOptions {
  approvalState: AgentToolCall["approvalState"]
  db: AppDatabase
  id: string
  input: unknown
  parentToolCallId?: string | null
  runId: string
  state: AgentToolCall["state"]
  toolName: string
}

export interface RecordAgentArtifactOptions {
  byteLength?: number | null
  db: AppDatabase
  kind: string
  metadata?: unknown
  path: string
  runId: string
  toolCallId?: string | null
}

export interface UpdateAgentToolCallOptions {
  approvalState?: AgentToolCall["approvalState"]
  db: AppDatabase
  errorMessage?: string | null
  id: string
  output?: unknown
  runId?: string
  state: AgentToolCall["state"]
}

export interface UpdateAgentRunOptions {
  db: AppDatabase
  errorMessage?: string | null
  id: string
  status: AgentRun["status"]
}

const getNowIsoString = (): string => new Date().toISOString()
const INTERRUPTED_RUN_ERROR_MESSAGE =
  "Agent run was interrupted before the app could finish it."
const SUSPENDED_APPROVAL_EXPIRED_ERROR_MESSAGE =
  "Suspended agent approval expired before it was resumed."
const eventAppendQueues = new Map<string, Promise<unknown>>()
const agentEventListeners = new Set<AgentEventListener>()

const parseJson = (value: string): unknown => JSON.parse(value)

const serializeJson = (value: unknown): string => JSON.stringify(value ?? {})

const getStoredToolCallId = ({
  runId,
  toolCallId
}: {
  runId: string
  toolCallId: string
}): string => `${runId}:${toolCallId}`

const getModelToolCallId = ({
  runId,
  storedId
}: {
  runId: string
  storedId: string
}): string =>
  storedId.startsWith(`${runId}:`) ? storedId.slice(runId.length + 1) : storedId

const getApprovalRequestPayload = (
  payload: unknown
): { approvalId: string; toolCallId: string } | null => {
  if (typeof payload !== "object" || payload === null) {
    return null
  }

  const record = payload as Record<string, unknown>

  if (
    typeof record.approvalId !== "string" ||
    typeof record.toolCallId !== "string"
  ) {
    return null
  }

  return {
    approvalId: record.approvalId,
    toolCallId: record.toolCallId
  }
}

const getApprovalEventPayload = getApprovalRequestPayload

export const assertAgentEventShape = <TPayload>(
  event: AgentEvent,
  type: AgentEventType,
  predicate: (payload: unknown) => payload is TPayload,
  description: string = type
): TPayload => {
  if (event.type !== type) {
    throw new Error(
      `Expected agent event type ${type}, received ${event.type}.`
    )
  }

  if (!predicate(event.payload)) {
    throw new Error(`Invalid agent event payload for ${description}.`)
  }

  return event.payload
}

const isSuspendedApprovalExpired = ({
  approvalTtlMs,
  now,
  startedAt
}: {
  approvalTtlMs: number | undefined
  now: Date
  startedAt: string
}): boolean => {
  if (typeof approvalTtlMs !== "number" || approvalTtlMs <= 0) {
    return false
  }

  const startedAtMs = Date.parse(startedAt)

  if (!Number.isFinite(startedAtMs)) {
    return false
  }

  return now.getTime() - startedAtMs > approvalTtlMs
}

const isActiveAgentRunStatus = (status: AgentRun["status"]): boolean =>
  status === "running" || status === "suspended"

const toAgentEvent = (row: typeof agentEvents.$inferSelect): AgentEvent => ({
  createdAt: row.createdAt,
  id: row.id,
  payload: parseJson(row.payloadJson),
  runId: row.runId,
  sequence: row.sequence,
  type: row.type
})

const toAgentArtifact = (
  row: typeof agentArtifacts.$inferSelect
): AgentArtifact => ({
  byteLength: row.byteLength,
  createdAt: row.createdAt,
  id: row.id,
  kind: row.kind,
  metadata: parseJson(row.metadataJson),
  path: row.path,
  runId: row.runId,
  toolCallId: row.toolCallId
})

const toAgentRun = (
  db: AppDatabase,
  row: typeof agentRuns.$inferSelect
): AgentRun => ({
  appendEvent: (event) =>
    appendAgentEvent({
      ...event,
      db,
      runId: row.id
    }),
  chatSessionId: row.chatSessionId,
  errorMessage: row.errorMessage,
  finishedAt: row.finishedAt,
  id: row.id,
  modelId: row.modelId,
  parentRunId: row.parentRunId,
  profileId: row.profileId,
  startedAt: row.startedAt,
  status: row.status
})

const toAgentToolCall = (
  row: typeof agentToolCalls.$inferSelect
): AgentToolCall => ({
  approvalState: row.approvalState,
  errorMessage: row.errorMessage,
  finishedAt: row.finishedAt,
  id: getModelToolCallId({
    runId: row.runId,
    storedId: row.id
  }),
  input: parseJson(row.inputJson),
  output: row.outputJson ? parseJson(row.outputJson) : undefined,
  parentToolCallId: row.parentToolCallId,
  runId: row.runId,
  startedAt: row.startedAt,
  state: row.state,
  toolName: row.toolName
})

const toPendingAgentApproval = (row: {
  approvalId: string | null
  chatSessionId: string
  errorMessage: string | null
  finishedAt: string | null
  id: string
  inputJson: string
  outputJson: string | null
  parentToolCallId: string | null
  profileId: string
  runId: string
  runStatus: AgentRun["status"]
  startedAt: string
  state: AgentToolCall["state"]
  toolName: string
}): PendingAgentApproval => ({
  approvalId: row.approvalId,
  approvalState: "pending",
  chatSessionId: row.chatSessionId,
  errorMessage: row.errorMessage,
  finishedAt: row.finishedAt,
  id: getModelToolCallId({
    runId: row.runId,
    storedId: row.id
  }),
  input: parseJson(row.inputJson),
  output: row.outputJson ? parseJson(row.outputJson) : undefined,
  parentToolCallId: row.parentToolCallId,
  profileId: row.profileId,
  runId: row.runId,
  runStatus: row.runStatus,
  startedAt: row.startedAt,
  state: row.state,
  toolName: row.toolName
})

const getRootRunIdFromRows = ({
  runId,
  runsById
}: {
  runId: string
  runsById: Map<string, typeof agentRuns.$inferSelect>
}): string | null => {
  let currentRun = runsById.get(runId)
  const visitedRunIds = new Set<string>()

  while (currentRun) {
    if (visitedRunIds.has(currentRun.id)) {
      return null
    }

    visitedRunIds.add(currentRun.id)

    if (!currentRun.parentRunId) {
      return currentRun.id
    }

    currentRun = runsById.get(currentRun.parentRunId)
  }

  return null
}

const getLatestTopLevelRunBySessionId = (
  runs: readonly (typeof agentRuns.$inferSelect)[]
): Map<string, typeof agentRuns.$inferSelect> => {
  const latestRunBySessionId = new Map<string, typeof agentRuns.$inferSelect>()

  for (const run of runs) {
    if (run.parentRunId) {
      continue
    }

    const currentRun = latestRunBySessionId.get(run.chatSessionId)

    if (
      !currentRun ||
      run.startedAt > currentRun.startedAt ||
      (run.startedAt === currentRun.startedAt && run.id > currentRun.id)
    ) {
      latestRunBySessionId.set(run.chatSessionId, run)
    }
  }

  return latestRunBySessionId
}

const listAgentRunsForSessionIds = async ({
  db,
  sessionIds
}: {
  db: AppDatabase
  sessionIds: readonly string[]
}): Promise<(typeof agentRuns.$inferSelect)[]> => {
  if (sessionIds.length === 0) {
    return []
  }

  const sessionConditions = sessionIds.map((sessionId) =>
    eq(agentRuns.chatSessionId, sessionId)
  )
  const whereCondition =
    sessionConditions.length === 1
      ? sessionConditions[0]
      : or(...sessionConditions)

  return await db.select().from(agentRuns).where(whereCondition)
}

const isRunInCurrentActiveRootBranchFromRows = ({
  chatSessionId,
  runId,
  runs
}: {
  chatSessionId: string
  runId: string
  runs: readonly (typeof agentRuns.$inferSelect)[]
}): boolean => {
  const latestTopLevelRun =
    getLatestTopLevelRunBySessionId(runs).get(chatSessionId)

  if (!latestTopLevelRun || !isActiveAgentRunStatus(latestTopLevelRun.status)) {
    return false
  }

  const rootRunId = getRootRunIdFromRows({
    runId,
    runsById: new Map(runs.map((run) => [run.id, run]))
  })

  return rootRunId === latestTopLevelRun.id
}

const isRunInCurrentActiveRootBranch = async ({
  chatSessionId,
  db,
  runId
}: {
  chatSessionId: string
  db: AppDatabase
  runId: string
}): Promise<boolean> =>
  isRunInCurrentActiveRootBranchFromRows({
    chatSessionId,
    runId,
    runs: await listAgentRunsForSessionIds({
      db,
      sessionIds: [chatSessionId]
    })
  })

const filterRowsToCurrentActiveRootBranches = async <
  TRow extends {
    chatSessionId: string
    runId: string
  }
>({
  db,
  rows
}: {
  db: AppDatabase
  rows: TRow[]
}): Promise<TRow[]> => {
  const sessionIds = [...new Set(rows.map((row) => row.chatSessionId))]
  const runs = await listAgentRunsForSessionIds({
    db,
    sessionIds
  })

  return rows.filter((row) =>
    isRunInCurrentActiveRootBranchFromRows({
      chatSessionId: row.chatSessionId,
      runId: row.runId,
      runs
    })
  )
}

const upsertAgentApprovalRequest = async ({
  db,
  payload,
  runId,
  timestamp
}: {
  db: AppDatabase
  payload: unknown
  runId: string
  timestamp: string
}): Promise<void> => {
  const approval = getApprovalEventPayload(payload)

  if (!approval) {
    return
  }

  const toolCallRowId = getStoredToolCallId({
    runId,
    toolCallId: approval.toolCallId
  })
  const [existingRow] = await db
    .select({
      id: agentApprovals.id
    })
    .from(agentApprovals)
    .where(eq(agentApprovals.id, approval.approvalId))
    .limit(1)

  if (existingRow) {
    await db
      .update(agentApprovals)
      .set({
        respondedAt: null,
        responseJson: null,
        runId,
        state: "pending",
        toolCallId: approval.toolCallId,
        toolCallRowId
      })
      .where(eq(agentApprovals.id, approval.approvalId))
    return
  }

  await db.insert(agentApprovals).values({
    createdAt: timestamp,
    id: approval.approvalId,
    respondedAt: null,
    responseJson: null,
    runId,
    state: "pending",
    toolCallId: approval.toolCallId,
    toolCallRowId
  })
}

const updateAgentApprovalResponse = async ({
  db,
  payload,
  state,
  timestamp
}: {
  db: AppDatabase
  payload: unknown
  state: "approved" | "denied"
  timestamp: string
}): Promise<void> => {
  const approval = getApprovalEventPayload(payload)

  if (!approval) {
    return
  }

  await db
    .update(agentApprovals)
    .set({
      respondedAt: timestamp,
      responseJson: serializeJson(payload),
      state
    })
    .where(eq(agentApprovals.id, approval.approvalId))
}

const syncAgentApprovalProjection = async ({
  db,
  payload,
  runId,
  timestamp,
  type
}: {
  db: AppDatabase
  payload: unknown
  runId: string
  timestamp: string
  type: AgentEventType
}): Promise<void> => {
  if (type === "tool_call_approval_requested") {
    await upsertAgentApprovalRequest({
      db,
      payload,
      runId,
      timestamp
    })
    return
  }

  if (type === "tool_call_approved" || type === "tool_call_denied") {
    await updateAgentApprovalResponse({
      db,
      payload,
      state: type === "tool_call_approved" ? "approved" : "denied",
      timestamp
    })
  }
}

const findAgentToolCallRow = async ({
  db,
  runId,
  toolCallId
}: {
  db: AppDatabase
  runId?: string
  toolCallId: string
}): Promise<typeof agentToolCalls.$inferSelect | null> => {
  if (runId) {
    const [row] = await db
      .select()
      .from(agentToolCalls)
      .where(
        and(
          eq(agentToolCalls.runId, runId),
          or(
            eq(agentToolCalls.id, getStoredToolCallId({ runId, toolCallId })),
            eq(agentToolCalls.id, toolCallId)
          )
        )
      )

    return row ?? null
  }

  const rows = await db.select().from(agentToolCalls)
  const matches = rows.filter(
    (row) =>
      getModelToolCallId({
        runId: row.runId,
        storedId: row.id
      }) === toolCallId
  )

  if (matches.length > 1) {
    throw new Error(
      `Agent tool call id is ambiguous without run scope: ${toolCallId}`
    )
  }

  return matches[0] ?? null
}

const getNextEventSequence = async (
  db: AppDatabase,
  runId: string
): Promise<number> => {
  const [stats] = await db
    .select({
      sequence: max(agentEvents.sequence)
    })
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))

  return Number(stats?.sequence ?? 0) + 1
}

const enqueueAgentEventAppend = async <TValue>(
  runId: string,
  task: () => Promise<TValue>
): Promise<TValue> => {
  const previousTask = eventAppendQueues.get(runId) ?? Promise.resolve()
  const currentTask = (async () => {
    try {
      await previousTask
    } catch {
      // Keep later event appends moving even if an earlier append failed.
    }

    return await task()
  })()

  eventAppendQueues.set(runId, currentTask)

  try {
    return await currentTask
  } finally {
    if (eventAppendQueues.get(runId) === currentTask) {
      eventAppendQueues.delete(runId)
    }
  }
}

const appendAgentEventNow = async ({
  db,
  payload,
  runId,
  type
}: AppendAgentEventInput & {
  db: AppDatabase
  runId: string
}): Promise<AgentEvent> => {
  const sequence = await getNextEventSequence(db, runId)
  const createdAt = getNowIsoString()
  const [row] = await db
    .insert(agentEvents)
    .values({
      createdAt,
      id: randomUUID(),
      payloadJson: serializeJson(payload),
      runId,
      sequence,
      type
    })
    .returning()

  if (!row) {
    throw new Error("Failed to append agent event.")
  }

  await syncAgentApprovalProjection({
    db,
    payload,
    runId,
    timestamp: createdAt,
    type
  })

  const event = toAgentEvent(row)
  const [runOwner] = await db
    .select({
      chatSessionId: agentRuns.chatSessionId
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)
  const notification = {
    ...event,
    chatSessionId: runOwner?.chatSessionId ?? ""
  }

  for (const listener of agentEventListeners) {
    try {
      listener(notification)
    } catch {
      // Observers must not break event persistence.
    }
  }

  return event
}

export const appendAgentEvent = (
  input: AppendAgentEventInput & {
    db: AppDatabase
    runId: string
  }
): Promise<AgentEvent> =>
  enqueueAgentEventAppend(input.runId, () => appendAgentEventNow(input))

export const subscribeAgentEvents = (
  listener: AgentEventListener
): (() => void) => {
  agentEventListeners.add(listener)

  return () => {
    agentEventListeners.delete(listener)
  }
}

export const createAgentRun = async ({
  chatSessionId,
  db,
  modelId = null,
  parentRunId = null,
  profileId
}: CreateAgentRunOptions): Promise<AgentRun> => {
  const [row] = await db
    .insert(agentRuns)
    .values({
      chatSessionId,
      errorMessage: null,
      finishedAt: null,
      id: randomUUID(),
      modelId,
      parentRunId,
      profileId,
      startedAt: getNowIsoString(),
      status: "running"
    })
    .returning()

  if (!row) {
    throw new Error("Failed to create agent run.")
  }

  return toAgentRun(db, row)
}

export const listAgentEvents = async ({
  db,
  runId
}: ListAgentEventsOptions): Promise<AgentEvent[]> => {
  const rows = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))
    .orderBy(asc(agentEvents.sequence))

  return rows.map(toAgentEvent)
}

export const listAgentToolCalls = async ({
  db,
  runId
}: ListAgentToolCallsOptions): Promise<AgentToolCall[]> => {
  const rows = await db
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.runId, runId))
    .orderBy(asc(agentToolCalls.startedAt))

  return rows.map(toAgentToolCall)
}

export const listAgentArtifacts = async ({
  db,
  runId
}: ListAgentArtifactsOptions): Promise<AgentArtifact[]> => {
  const rows = await db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.runId, runId))
    .orderBy(asc(agentArtifacts.createdAt), asc(agentArtifacts.id))

  return rows.map(toAgentArtifact)
}

export const getAgentArtifact = async ({
  artifactId,
  chatSessionId,
  db,
  projectPath
}: GetAgentArtifactOptions): Promise<AgentArtifact | null> => {
  const [row] = await db
    .select({
      byteLength: agentArtifacts.byteLength,
      createdAt: agentArtifacts.createdAt,
      id: agentArtifacts.id,
      kind: agentArtifacts.kind,
      metadataJson: agentArtifacts.metadataJson,
      path: agentArtifacts.path,
      runId: agentArtifacts.runId,
      toolCallId: agentArtifacts.toolCallId
    })
    .from(agentArtifacts)
    .innerJoin(agentRuns, eq(agentArtifacts.runId, agentRuns.id))
    .innerJoin(chatSessions, eq(agentRuns.chatSessionId, chatSessions.id))
    .where(
      and(
        eq(agentArtifacts.id, artifactId),
        ...(chatSessionId ? [eq(agentRuns.chatSessionId, chatSessionId)] : []),
        ...(projectPath ? [eq(chatSessions.projectPath, projectPath)] : [])
      )
    )

  return row ? toAgentArtifact(row) : null
}

export const listAgentRuns = async ({
  chatSessionId,
  db,
  limit = 30
}: ListAgentRunsOptions): Promise<AgentRun[]> => {
  const conditions = chatSessionId
    ? [eq(agentRuns.chatSessionId, chatSessionId)]
    : []
  const query = db.select().from(agentRuns)
  const rows = await (
    conditions.length > 0 ? query.where(and(...conditions)) : query
  )
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(limit)

  return rows.map((row) => toAgentRun(db, row))
}

export const getAgentRun = async ({
  chatSessionId,
  db,
  projectPath,
  runId
}: GetAgentRunOptions): Promise<AgentRun | null> => {
  const [row] = await db
    .select({
      chatSessionId: agentRuns.chatSessionId,
      errorMessage: agentRuns.errorMessage,
      finishedAt: agentRuns.finishedAt,
      id: agentRuns.id,
      modelId: agentRuns.modelId,
      parentRunId: agentRuns.parentRunId,
      profileId: agentRuns.profileId,
      startedAt: agentRuns.startedAt,
      status: agentRuns.status
    })
    .from(agentRuns)
    .innerJoin(chatSessions, eq(agentRuns.chatSessionId, chatSessions.id))
    .where(
      and(
        eq(agentRuns.id, runId),
        ...(chatSessionId ? [eq(agentRuns.chatSessionId, chatSessionId)] : []),
        ...(projectPath ? [eq(chatSessions.projectPath, projectPath)] : [])
      )
    )

  return row ? toAgentRun(db, row) : null
}

export const getActiveAgentRunForSession = async ({
  chatSessionId,
  db
}: GetActiveAgentRunForSessionOptions): Promise<AgentRun | null> => {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.chatSessionId, chatSessionId),
        isNull(agentRuns.parentRunId)
      )
    )
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(1)

  return row && isActiveAgentRunStatus(row.status) ? toAgentRun(db, row) : null
}

export const getLatestCompletedAgentRunForSession = async ({
  chatSessionId,
  db
}: GetLatestCompletedAgentRunForSessionOptions): Promise<AgentRun | null> => {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.chatSessionId, chatSessionId),
        isNull(agentRuns.parentRunId),
        or(eq(agentRuns.status, "failed"), eq(agentRuns.status, "succeeded"))
      )
    )
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.finishedAt))
    .limit(1)

  return row ? toAgentRun(db, row) : null
}

export const getAgentRunForToolCall = async ({
  chatSessionId,
  db,
  pendingApprovalOnly = false,
  toolCallId
}: GetAgentRunForToolCallOptions): Promise<AgentRun | null> => {
  const conditions = [
    ...(chatSessionId ? [eq(agentRuns.chatSessionId, chatSessionId)] : []),
    ...(pendingApprovalOnly
      ? [
          eq(agentToolCalls.approvalState, "pending"),
          eq(agentToolCalls.state, "approval_requested"),
          or(eq(agentRuns.status, "running"), eq(agentRuns.status, "suspended"))
        ]
      : [])
  ]
  const query = db
    .select({
      chatSessionId: agentRuns.chatSessionId,
      errorMessage: agentRuns.errorMessage,
      finishedAt: agentRuns.finishedAt,
      id: agentRuns.id,
      modelId: agentRuns.modelId,
      parentRunId: agentRuns.parentRunId,
      profileId: agentRuns.profileId,
      startedAt: agentRuns.startedAt,
      status: agentRuns.status,
      storedToolCallId: agentToolCalls.id
    })
    .from(agentToolCalls)
    .innerJoin(agentRuns, eq(agentToolCalls.runId, agentRuns.id))
  const rows =
    conditions.length > 0 ? await query.where(and(...conditions)) : await query
  const currentBranchRows =
    pendingApprovalOnly && chatSessionId
      ? await filterRowsToCurrentActiveRootBranches({
          db,
          rows: rows.map((row) => ({
            ...row,
            runId: row.id
          }))
        })
      : rows
  const row = currentBranchRows.find(
    (candidate) =>
      getModelToolCallId({
        runId: candidate.id,
        storedId: candidate.storedToolCallId
      }) === toolCallId
  )

  return row ? toAgentRun(db, row) : null
}

export const getAgentRunForToolApproval = async ({
  approvalId,
  chatSessionId,
  db,
  pendingApprovalOnly = false,
  toolCallId
}: GetAgentRunForToolApprovalOptions): Promise<AgentRun | null> => {
  const conditions = [
    eq(agentApprovals.id, approvalId),
    ...(chatSessionId ? [eq(agentRuns.chatSessionId, chatSessionId)] : []),
    ...(toolCallId ? [eq(agentApprovals.toolCallId, toolCallId)] : []),
    ...(pendingApprovalOnly
      ? [
          eq(agentApprovals.state, "pending"),
          eq(agentToolCalls.approvalState, "pending"),
          eq(agentToolCalls.state, "approval_requested"),
          or(eq(agentRuns.status, "running"), eq(agentRuns.status, "suspended"))
        ]
      : [])
  ]
  const query = db
    .select({
      chatSessionId: agentRuns.chatSessionId,
      errorMessage: agentRuns.errorMessage,
      finishedAt: agentRuns.finishedAt,
      id: agentRuns.id,
      modelId: agentRuns.modelId,
      parentRunId: agentRuns.parentRunId,
      profileId: agentRuns.profileId,
      startedAt: agentRuns.startedAt,
      status: agentRuns.status,
      storedToolCallId: agentToolCalls.id
    })
    .from(agentApprovals)
    .innerJoin(
      agentToolCalls,
      eq(agentApprovals.toolCallRowId, agentToolCalls.id)
    )
    .innerJoin(agentRuns, eq(agentToolCalls.runId, agentRuns.id))
    .where(and(...conditions))
    .limit(1)
  const [row] = await query

  if (!row) {
    return null
  }

  if (
    pendingApprovalOnly &&
    chatSessionId &&
    !(await isRunInCurrentActiveRootBranch({
      chatSessionId,
      db,
      runId: row.id
    }))
  ) {
    return null
  }

  return toAgentRun(db, row)
}

export const listPendingAgentApprovals = async ({
  chatSessionId,
  db
}: ListPendingAgentApprovalsOptions): Promise<PendingAgentApproval[]> => {
  const rows = await db
    .select({
      approvalId: agentApprovals.id,
      chatSessionId: agentRuns.chatSessionId,
      errorMessage: agentToolCalls.errorMessage,
      finishedAt: agentToolCalls.finishedAt,
      id: agentToolCalls.id,
      inputJson: agentToolCalls.inputJson,
      outputJson: agentToolCalls.outputJson,
      parentToolCallId: agentToolCalls.parentToolCallId,
      profileId: agentRuns.profileId,
      runId: agentToolCalls.runId,
      runStatus: agentRuns.status,
      startedAt: agentToolCalls.startedAt,
      state: agentToolCalls.state,
      toolName: agentToolCalls.toolName
    })
    .from(agentApprovals)
    .innerJoin(
      agentToolCalls,
      eq(agentApprovals.toolCallRowId, agentToolCalls.id)
    )
    .innerJoin(agentRuns, eq(agentToolCalls.runId, agentRuns.id))
    .where(
      and(
        eq(agentApprovals.state, "pending"),
        eq(agentToolCalls.approvalState, "pending"),
        eq(agentToolCalls.state, "approval_requested"),
        or(eq(agentRuns.status, "running"), eq(agentRuns.status, "suspended")),
        ...(chatSessionId ? [eq(agentRuns.chatSessionId, chatSessionId)] : [])
      )
    )
    .orderBy(asc(agentToolCalls.startedAt))

  const currentBranchRows = await filterRowsToCurrentActiveRootBranches({
    db,
    rows
  })

  return currentBranchRows.map(toPendingAgentApproval)
}

export const listRecoverableAgentRuns = async ({
  chatSessionId,
  db
}: ListRecoverableAgentRunsOptions): Promise<AgentRun[]> => {
  const conditions = [
    isNull(agentRuns.parentRunId),
    ...(chatSessionId ? [eq(agentRuns.chatSessionId, chatSessionId)] : [])
  ]
  const rows = await db
    .select()
    .from(agentRuns)
    .where(and(...conditions))
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.finishedAt))
  const seenSessionIds = new Set<string>()
  const recoverableRows: typeof rows = []

  for (const row of rows) {
    if (seenSessionIds.has(row.chatSessionId)) {
      continue
    }

    seenSessionIds.add(row.chatSessionId)

    if (row.status === "failed") {
      recoverableRows.push(row)
    }
  }

  return recoverableRows.map((row) => toAgentRun(db, row))
}

export const updateAgentRun = async ({
  db,
  errorMessage = null,
  id,
  status
}: UpdateAgentRunOptions): Promise<AgentRun> => {
  const [row] = await db
    .update(agentRuns)
    .set({
      errorMessage,
      finishedAt:
        status === "failed" || status === "succeeded"
          ? getNowIsoString()
          : null,
      status
    })
    .where(eq(agentRuns.id, id))
    .returning()

  if (!row) {
    throw new Error(`Agent run not found: ${id}`)
  }

  return toAgentRun(db, row)
}

export const recoverInterruptedAgentRuns = async ({
  approvalTtlMs,
  db,
  now = new Date()
}: RecoverInterruptedAgentRunsOptions): Promise<RecoverInterruptedAgentRunsResult> => {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(
      or(eq(agentRuns.status, "running"), eq(agentRuns.status, "suspended"))
    )
  const failedRunIds: string[] = []
  const expiredApprovalRunIds: string[] = []
  const suspendedRunIds: string[] = []

  for (const row of rows) {
    if (row.status === "suspended") {
      if (
        !isSuspendedApprovalExpired({
          approvalTtlMs,
          now,
          startedAt: row.startedAt
        })
      ) {
        suspendedRunIds.push(row.id)
        continue
      }

      await updateAgentRun({
        db,
        errorMessage: SUSPENDED_APPROVAL_EXPIRED_ERROR_MESSAGE,
        id: row.id,
        status: "failed"
      })
      await appendAgentEvent({
        db,
        payload: {
          error: SUSPENDED_APPROVAL_EXPIRED_ERROR_MESSAGE,
          reason: "approval_timeout"
        },
        runId: row.id,
        type: "agent_run_failed"
      })
      expiredApprovalRunIds.push(row.id)
      failedRunIds.push(row.id)
      continue
    }

    await updateAgentRun({
      db,
      errorMessage: INTERRUPTED_RUN_ERROR_MESSAGE,
      id: row.id,
      status: "failed"
    })
    await appendAgentEvent({
      db,
      payload: {
        error: INTERRUPTED_RUN_ERROR_MESSAGE,
        reason: "app_startup_recovery"
      },
      runId: row.id,
      type: "agent_run_failed"
    })
    failedRunIds.push(row.id)
  }

  return {
    expiredApprovalRunIds,
    failedRunIds,
    suspendedRunIds
  }
}

export const recordAgentToolCall = async ({
  approvalState,
  db,
  id,
  input,
  parentToolCallId = null,
  runId,
  state,
  toolName
}: RecordAgentToolCallOptions): Promise<AgentToolCall> => {
  const now = getNowIsoString()
  const storedId = getStoredToolCallId({
    runId,
    toolCallId: id
  })
  const existingRow = await findAgentToolCallRow({
    db,
    runId,
    toolCallId: id
  })

  if (existingRow) {
    const [row] = await db
      .update(agentToolCalls)
      .set({
        approvalState:
          existingRow.approvalState === "not_required"
            ? approvalState
            : existingRow.approvalState,
        errorMessage: null,
        inputJson: serializeJson(input),
        parentToolCallId,
        runId,
        state,
        toolName
      })
      .where(eq(agentToolCalls.id, existingRow.id))
      .returning()

    if (!row) {
      throw new Error(`Agent tool call not found: ${id}`)
    }

    return toAgentToolCall(row)
  }

  const [row] = await db
    .insert(agentToolCalls)
    .values({
      approvalState,
      errorMessage: null,
      finishedAt: null,
      id: storedId,
      inputJson: serializeJson(input),
      outputJson: null,
      parentToolCallId,
      runId,
      startedAt: now,
      state,
      toolName
    })
    .returning()

  if (!row) {
    throw new Error("Failed to record agent tool call.")
  }

  return toAgentToolCall(row)
}

export const recordAgentArtifact = async ({
  byteLength = null,
  db,
  kind,
  metadata = {},
  path,
  runId,
  toolCallId = null
}: RecordAgentArtifactOptions): Promise<AgentArtifact> => {
  const row = {
    byteLength,
    createdAt: getNowIsoString(),
    id: randomUUID(),
    kind,
    metadataJson: serializeJson(metadata),
    path,
    runId,
    toolCallId
  } satisfies typeof agentArtifacts.$inferInsert

  await db.insert(agentArtifacts).values(row)

  return toAgentArtifact(row)
}

export const updateAgentToolCall = async ({
  approvalState,
  db,
  errorMessage = null,
  id,
  output,
  runId,
  state
}: UpdateAgentToolCallOptions): Promise<AgentToolCall> => {
  const existingRow = await findAgentToolCallRow({
    db,
    runId,
    toolCallId: id
  })

  if (!existingRow) {
    throw new Error(`Agent tool call not found: ${id}`)
  }

  const [row] = await db
    .update(agentToolCalls)
    .set({
      ...(approvalState ? { approvalState } : {}),
      errorMessage,
      finishedAt:
        state === "failed" || state === "finished" ? getNowIsoString() : null,
      outputJson: output === undefined ? null : serializeJson(output),
      state
    })
    .where(eq(agentToolCalls.id, existingRow.id))
    .returning()

  if (!row) {
    throw new Error(`Agent tool call not found: ${id}`)
  }

  return toAgentToolCall(row)
}
