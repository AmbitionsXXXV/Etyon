import type {
  AgentRunsOutput,
  AgentRunTraceArtifact,
  AgentRunTraceEvent,
  AgentRunTraceRun,
  AgentRunTraceToolCall,
  InspectAgentRunOutput,
  PendingAgentApproval,
  PendingAgentApprovalsOutput,
  ReadAgentArtifactOutput
} from "@etyon/rpc"
import { and, asc, desc, eq } from "drizzle-orm"

import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getChatSessionById } from "@/main/chat-sessions"
import type { AppDatabase } from "@/main/db"
import {
  agentApprovals,
  agentArtifacts,
  agentEvents,
  agentRuns,
  agentToolCalls
} from "@/main/db/schema"

/**
 * Read-side projections over the agent event store for the run inspector
 * (Phase 7). These reopen a run from persisted rows: its lifecycle/tool/approval
 * events, tool-call records, and artifacts — without touching the chat snapshot.
 */

const DEFAULT_RUN_LIST_LIMIT = 50

const safeParse = (value: string | null): unknown => {
  if (value === null) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const toTraceRun = (run: typeof agentRuns.$inferSelect): AgentRunTraceRun => ({
  chatSessionId: run.chatSessionId,
  errorMessage: run.errorMessage,
  finishedAt: run.finishedAt,
  id: run.id,
  modelId: run.modelId,
  parentRunId: run.parentRunId,
  parentToolCallId: run.parentToolCallId ?? null,
  profileId: run.profileId,
  startedAt: run.startedAt,
  status: run.status
})

const toTraceEvent = (
  event: typeof agentEvents.$inferSelect
): AgentRunTraceEvent => ({
  createdAt: event.createdAt,
  id: event.id,
  payload: safeParse(event.payloadJson),
  runId: event.runId,
  sequence: event.sequence,
  type: event.type
})

const toTraceToolCall = (
  toolCall: typeof agentToolCalls.$inferSelect
): AgentRunTraceToolCall => ({
  approvalState: toolCall.approvalState,
  errorMessage: toolCall.errorMessage,
  finishedAt: toolCall.finishedAt,
  id: toolCall.id,
  input: safeParse(toolCall.inputJson),
  output: safeParse(toolCall.outputJson),
  parentToolCallId: toolCall.parentToolCallId,
  runId: toolCall.runId,
  startedAt: toolCall.startedAt,
  state: toolCall.state,
  toolName: toolCall.toolName
})

const toTraceArtifact = (
  artifact: typeof agentArtifacts.$inferSelect
): AgentRunTraceArtifact => ({
  byteLength: artifact.byteLength,
  createdAt: artifact.createdAt,
  id: artifact.id,
  kind: artifact.kind,
  metadata: safeParse(artifact.metadataJson),
  path: artifact.path,
  runId: artifact.runId,
  toolCallId: artifact.toolCallId
})

/** Reopens a single run with its ordered event timeline, tool calls, artifacts. */
export const inspectAgentRun = async ({
  db,
  runId
}: {
  db: AppDatabase
  runId: string
}): Promise<InspectAgentRunOutput | null> => {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)

  if (!run) {
    return null
  }

  const [events, toolCalls, artifacts] = await Promise.all([
    db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.runId, runId))
      .orderBy(asc(agentEvents.sequence)),
    db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.runId, runId))
      .orderBy(asc(agentToolCalls.startedAt)),
    db
      .select()
      .from(agentArtifacts)
      .where(eq(agentArtifacts.runId, runId))
      .orderBy(asc(agentArtifacts.createdAt))
  ])

  return {
    artifacts: artifacts.map(toTraceArtifact),
    events: events.map(toTraceEvent),
    run: toTraceRun(run),
    toolCalls: toolCalls.map(toTraceToolCall)
  }
}

/**
 * Reads a persisted artifact's current file content through the workspace
 * sandbox of its run's project. Returns null when the artifact is unknown or
 * does not belong to the requested session.
 */
export const readAgentArtifact = async ({
  artifactId,
  db,
  maxChars,
  sessionId
}: {
  artifactId: string
  db: AppDatabase
  maxChars?: number
  sessionId?: string
}): Promise<ReadAgentArtifactOutput | null> => {
  const [row] = await db
    .select({ artifact: agentArtifacts, run: agentRuns })
    .from(agentArtifacts)
    .innerJoin(agentRuns, eq(agentArtifacts.runId, agentRuns.id))
    .where(eq(agentArtifacts.id, artifactId))
    .limit(1)

  if (!row || (sessionId && row.run.chatSessionId !== sessionId)) {
    return null
  }

  const session = await getChatSessionById(db, row.run.chatSessionId)

  if (!session) {
    return null
  }

  const viewResult = await getWorkspaceCore(session.projectPath).view(
    row.artifact.path
  )

  if (!viewResult.ok) {
    throw new Error(
      `Failed to read artifact file: ${viewResult.error.message} (${viewResult.error.code}: ${viewResult.error.path})`
    )
  }

  const { content } = viewResult.value
  const limitedContent =
    maxChars === undefined ? content : content.slice(0, maxChars)

  return {
    artifact: toTraceArtifact(row.artifact),
    content: limitedContent,
    omittedChars: content.length - limitedContent.length,
    totalChars: content.length,
    truncated: limitedContent.length < content.length
  }
}

/**
 * Lists recent runs, newest first, optionally scoped to a chat session and/or a
 * parent run (the latter powers lazy history lookups of a call's child runs).
 */
export const listAgentRuns = async ({
  db,
  limit = DEFAULT_RUN_LIST_LIMIT,
  parentRunId,
  parentToolCallId,
  sessionId
}: {
  db: AppDatabase
  limit?: number
  parentRunId?: string
  parentToolCallId?: string
  sessionId?: string
}): Promise<AgentRunsOutput> => {
  const runs = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        sessionId ? eq(agentRuns.chatSessionId, sessionId) : undefined,
        parentRunId ? eq(agentRuns.parentRunId, parentRunId) : undefined,
        parentToolCallId
          ? eq(agentRuns.parentToolCallId, parentToolCallId)
          : undefined
      )
    )
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit)

  return { runs: runs.map(toTraceRun) }
}

/**
 * Pending tool approvals across runs — the durable approval inbox. These
 * survive a restart because the approval rows persist; the suspended run stays
 * open until the user approves or denies.
 */
export const listPendingAgentApprovals = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId?: string
}): Promise<PendingAgentApprovalsOutput> => {
  const rows = await db
    .select({
      approval: agentApprovals,
      run: agentRuns,
      toolCall: agentToolCalls
    })
    .from(agentApprovals)
    .innerJoin(
      agentToolCalls,
      eq(agentApprovals.toolCallRowId, agentToolCalls.id)
    )
    .innerJoin(agentRuns, eq(agentApprovals.runId, agentRuns.id))
    .where(
      and(
        eq(agentApprovals.state, "pending"),
        sessionId ? eq(agentRuns.chatSessionId, sessionId) : undefined
      )
    )
    .orderBy(asc(agentApprovals.createdAt))

  const approvals: PendingAgentApproval[] = rows.map(
    ({ approval, run, toolCall }) => ({
      approvalId: approval.id,
      approvalState: toolCall.approvalState,
      chatSessionId: run.chatSessionId,
      errorMessage: toolCall.errorMessage,
      finishedAt: toolCall.finishedAt,
      id: toolCall.id,
      input: safeParse(toolCall.inputJson),
      output: safeParse(toolCall.outputJson),
      parentToolCallId: toolCall.parentToolCallId,
      profileId: run.profileId,
      runId: run.id,
      runStatus: run.status,
      startedAt: toolCall.startedAt,
      state: toolCall.state,
      toolName: toolCall.toolName
    })
  )

  return { approvals }
}
