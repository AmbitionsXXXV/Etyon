import { randomUUID } from "node:crypto"

import { asc, eq, max } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { agentEvents, agentRuns, agentToolCalls } from "@/main/db/schema"

export type AgentEventType =
  | "agent_run_failed"
  | "agent_run_finished"
  | "agent_run_started"
  | "agent_step_finished"
  | "agent_step_started"
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
  status: "failed" | "running" | "succeeded"
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
  state: "failed" | "finished" | "requested" | "running"
  toolName: string
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

export interface ListAgentEventsOptions {
  db: AppDatabase
  runId: string
}

export interface ListAgentToolCallsOptions {
  db: AppDatabase
  runId: string
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

export interface UpdateAgentToolCallOptions {
  db: AppDatabase
  errorMessage?: string | null
  id: string
  output?: unknown
  state: AgentToolCall["state"]
}

export interface UpdateAgentRunOptions {
  db: AppDatabase
  errorMessage?: string | null
  id: string
  status: AgentRun["status"]
}

const getNowIsoString = (): string => new Date().toISOString()

const parseJson = (value: string): unknown => JSON.parse(value)

const serializeJson = (value: unknown): string => JSON.stringify(value ?? {})

const toAgentEvent = (row: typeof agentEvents.$inferSelect): AgentEvent => ({
  createdAt: row.createdAt,
  id: row.id,
  payload: parseJson(row.payloadJson),
  runId: row.runId,
  sequence: row.sequence,
  type: row.type
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
  id: row.id,
  input: parseJson(row.inputJson),
  output: row.outputJson ? parseJson(row.outputJson) : undefined,
  parentToolCallId: row.parentToolCallId,
  runId: row.runId,
  startedAt: row.startedAt,
  state: row.state,
  toolName: row.toolName
})

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

export const appendAgentEvent = async ({
  db,
  payload,
  runId,
  type
}: AppendAgentEventInput & {
  db: AppDatabase
  runId: string
}): Promise<AgentEvent> => {
  const sequence = await getNextEventSequence(db, runId)
  const [row] = await db
    .insert(agentEvents)
    .values({
      createdAt: getNowIsoString(),
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

  return toAgentEvent(row)
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
      finishedAt: status === "running" ? null : getNowIsoString(),
      status
    })
    .where(eq(agentRuns.id, id))
    .returning()

  if (!row) {
    throw new Error(`Agent run not found: ${id}`)
  }

  return toAgentRun(db, row)
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
  const [row] = await db
    .insert(agentToolCalls)
    .values({
      approvalState,
      errorMessage: null,
      finishedAt: null,
      id,
      inputJson: serializeJson(input),
      outputJson: null,
      parentToolCallId,
      runId,
      startedAt: getNowIsoString(),
      state,
      toolName
    })
    .returning()

  if (!row) {
    throw new Error("Failed to record agent tool call.")
  }

  return toAgentToolCall(row)
}

export const updateAgentToolCall = async ({
  db,
  errorMessage = null,
  id,
  output,
  state
}: UpdateAgentToolCallOptions): Promise<AgentToolCall> => {
  const [row] = await db
    .update(agentToolCalls)
    .set({
      errorMessage,
      finishedAt:
        state === "failed" || state === "finished" ? getNowIsoString() : null,
      outputJson: output === undefined ? null : serializeJson(output),
      state
    })
    .where(eq(agentToolCalls.id, id))
    .returning()

  if (!row) {
    throw new Error(`Agent tool call not found: ${id}`)
  }

  return toAgentToolCall(row)
}
