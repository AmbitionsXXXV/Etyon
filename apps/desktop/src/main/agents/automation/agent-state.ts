import { setTimeout as delay } from "node:timers/promises"

import type {
  AutomationRun,
  AutomationTaskDraft
} from "@etyon/rpc/schemas/automation"
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"

import { resolveApproval } from "@/main/agents/approval-broker"
import type { AutomationExecutionResult } from "@/main/agents/automation/manager"
import { getChatSessionById } from "@/main/chat-sessions"
import type { AppDatabase } from "@/main/db"
import {
  agentApprovals,
  agentEvents,
  agentRuns,
  agentToolCalls,
  chatMessages
} from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import {
  isChatSessionExecuting,
  runWithChatSessionExecution
} from "@/main/server/routes/chat-session-execution"
import { getSettings } from "@/main/settings"
import { resolveProfileById } from "@/shared/agents/profiles"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const toExecutionResult = (
  run: typeof agentRuns.$inferSelect
): AutomationExecutionResult => {
  const failed =
    run.status === "failed" ||
    ["aborted", "max-steps", "context-budget", "model-error"].includes(
      run.finishReason ?? ""
    )
  return {
    agentRunId: run.id,
    error:
      run.errorMessage ??
      (failed ? `The agent stopped: ${run.finishReason ?? "failed"}.` : null),
    status:
      run.status === "suspended" ? "suspended" : failed ? "failed" : "succeeded"
  }
}

export const getAutomationSessionConflict = async (
  db: AppDatabase,
  sessionId: string
): Promise<"pending_response" | "running" | null> => {
  const [root] = await db
    .select({ status: agentRuns.status })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.chatSessionId, sessionId),
        isNull(agentRuns.parentRunId),
        inArray(agentRuns.status, ["running", "suspended"])
      )
    )
    .limit(1)
  if (root) {
    return root.status === "running" ? "running" : "pending_response"
  }
  const [approval] = await db
    .select({ id: agentApprovals.id })
    .from(agentApprovals)
    .innerJoin(agentRuns, eq(agentApprovals.runId, agentRuns.id))
    .where(
      and(
        eq(agentRuns.chatSessionId, sessionId),
        eq(agentApprovals.state, "pending")
      )
    )
    .limit(1)
  return approval ? "pending_response" : null
}

export const createAutomationAgentState = (db: AppDatabase) => {
  const findAssociatedRunId = async (
    run: AutomationRun
  ): Promise<string | null> => {
    const [user] = await db
      .select({ sequence: chatMessages.sequence })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, run.sessionId),
          eq(chatMessages.messageId, `automation-${run.id}`)
        )
      )
      .limit(1)
    if (!user) {
      return null
    }
    const rows = await db
      .select({
        agentRunId: chatMessages.agentProjectionRunId,
        role: chatMessages.role,
        sequence: chatMessages.sequence
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, run.sessionId))
      .orderBy(asc(chatMessages.sequence))
    for (const message of rows) {
      if (message.sequence <= user.sequence) {
        continue
      }
      if (message.role === "user") {
        break
      }
      if (message.agentRunId) {
        return message.agentRunId
      }
    }
    return null
  }

  const readResult = async (
    automationRun: AutomationRun,
    initialRunId: string | null
  ): Promise<AutomationExecutionResult> => {
    let runId =
      initialRunId ??
      automationRun.agentRunId ??
      (await findAssociatedRunId(automationRun))
    const visited = new Set<string>()
    while (runId && !visited.has(runId)) {
      visited.add(runId)
      const [run] = await db
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, runId),
            eq(agentRuns.chatSessionId, automationRun.sessionId)
          )
        )
        .limit(1)
      if (!run) {
        break
      }
      if (run.status === "running") {
        return {
          agentRunId: run.id,
          error:
            "The agent result has not settled. Check the chat before running this task again.",
          status: "failed"
        }
      }
      if (run.status !== "superseded") {
        const messages = await db
          .select({ partsJson: chatMessages.partsJson })
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.sessionId, automationRun.sessionId),
              eq(chatMessages.agentProjectionRunId, run.id)
            )
          )
          .orderBy(desc(chatMessages.sequence))
        if (run.status === "succeeded" && messages.length === 0) {
          return {
            agentRunId: run.id,
            error:
              "The agent produced no persisted response. Check the chat before running this task again.",
            status: "failed"
          }
        }
        const parts = messages.flatMap((message) => {
          const value = parseJson(message.partsJson)
          return Array.isArray(value) ? value : []
        })
        const summary = parts
          .filter(
            (part): part is { text: string; type: string } =>
              isRecord(part) &&
              part.type === "text" &&
              typeof part.text === "string"
          )
          .map((part) => part.text)
          .join("\n")
          .slice(0, 1000)
        return { ...toExecutionResult(run), summary: summary || null }
      }
      const [event] = await db
        .select({ payloadJson: agentEvents.payloadJson })
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.runId, run.id),
            eq(agentEvents.type, "run.superseded")
          )
        )
        .orderBy(desc(agentEvents.sequence))
        .limit(1)
      const payload = event ? parseJson(event.payloadJson) : null
      runId =
        isRecord(payload) && typeof payload.supersededByRunId === "string"
          ? payload.supersededByRunId
          : null
    }
    return {
      agentRunId: initialRunId ?? automationRun.agentRunId,
      error:
        "The durable agent result is unavailable. Check the chat before running this task again.",
      status: "failed"
    }
  }

  const isSessionAvailable = async (sessionId: string): Promise<boolean> => {
    if (isChatSessionExecuting(sessionId)) {
      return false
    }
    const conflict = await getAutomationSessionConflict(db, sessionId)
    return conflict === null
  }

  const validateTask = async (draft: AutomationTaskDraft): Promise<void> => {
    const session = await getChatSessionById(db, draft.sessionId)
    if (!session || session.archivedAt) {
      throw new Error("Choose an existing, unarchived chat for this task.")
    }
    if (
      draft.profileId &&
      !resolveProfileById(getSettings().agents, draft.profileId)
    ) {
      throw new Error("The selected agent profile is unavailable.")
    }
  }

  const cancelSuspended = async (
    automationRun: AutomationRun
  ): Promise<void> => {
    if (!automationRun.agentRunId) {
      throw new Error(
        "The suspended agent run is unavailable. Open the chat to inspect it."
      )
    }
    const runId = automationRun.agentRunId
    const response = await runWithChatSessionExecution(
      automationRun.sessionId,
      async () => {
        await runExclusiveDbWrite(async () => {
          const approvalIds = await db.transaction(async (tx) => {
            const [run] = await tx
              .select()
              .from(agentRuns)
              .where(
                and(
                  eq(agentRuns.id, runId),
                  eq(agentRuns.chatSessionId, automationRun.sessionId)
                )
              )
              .limit(1)
            if (!run || run.status !== "suspended") {
              throw new Error(
                "This run has already continued. Refresh the task before cancelling it."
              )
            }
            const time = new Date().toISOString()
            const approvals = await tx
              .select()
              .from(agentApprovals)
              .where(
                and(
                  eq(agentApprovals.runId, runId),
                  eq(agentApprovals.state, "pending")
                )
              )
            const toolRows = await tx
              .select()
              .from(agentToolCalls)
              .where(
                and(
                  eq(agentToolCalls.runId, runId),
                  inArray(agentToolCalls.state, [
                    "approval_requested",
                    "requested"
                  ])
                )
              )
            const toolIds = new Set(
              toolRows.map((tool) => tool.id.slice(runId.length + 1))
            )
            const messages = await tx
              .select()
              .from(chatMessages)
              .where(
                and(
                  eq(chatMessages.sessionId, automationRun.sessionId),
                  eq(chatMessages.agentProjectionRunId, runId)
                )
              )
            for (const message of messages) {
              const raw = parseJson(message.partsJson)
              if (!Array.isArray(raw)) {
                continue
              }
              const parts = raw.map((part: unknown) => {
                if (
                  !isRecord(part) ||
                  typeof part.toolCallId !== "string" ||
                  !toolIds.has(part.toolCallId)
                ) {
                  return part
                }
                if (
                  part.state === "approval-requested" &&
                  isRecord(part.approval)
                ) {
                  return {
                    ...part,
                    approval: {
                      ...part.approval,
                      approved: false,
                      reason: "Automation cancelled."
                    },
                    state: "output-denied"
                  }
                }
                if (part.state === "input-available") {
                  return {
                    ...part,
                    errorText: "Automation cancelled.",
                    state: "output-error"
                  }
                }
                return part
              })
              // Update only this run's existing message rows, inside the same
              // write transaction. A new user turn is protected by the chat lease.
              const metadata = message.metadataJson
                ? parseJson(message.metadataJson)
                : null
              await tx
                .update(chatMessages)
                .set({
                  metadataJson: JSON.stringify({
                    ...(isRecord(metadata) ? metadata : {}),
                    exitReason: "aborted"
                  }),
                  partsJson: JSON.stringify(parts),
                  updatedAt: time
                })
                .where(
                  and(
                    eq(chatMessages.sessionId, automationRun.sessionId),
                    eq(chatMessages.messageId, message.messageId)
                  )
                )
            }
            await tx
              .update(agentApprovals)
              .set({
                respondedAt: time,
                responseJson: JSON.stringify({
                  approved: false,
                  reason: "Automation cancelled."
                }),
                state: "denied"
              })
              .where(
                and(
                  eq(agentApprovals.runId, runId),
                  eq(agentApprovals.state, "pending")
                )
              )
            await tx
              .update(agentToolCalls)
              .set({
                errorMessage: "Automation cancelled.",
                finishedAt: time,
                state: "failed"
              })
              .where(
                and(
                  eq(agentToolCalls.runId, runId),
                  inArray(agentToolCalls.state, [
                    "approval_requested",
                    "requested"
                  ])
                )
              )
            await tx
              .update(agentToolCalls)
              .set({ approvalState: "denied" })
              .where(
                and(
                  eq(agentToolCalls.runId, runId),
                  eq(agentToolCalls.approvalState, "pending")
                )
              )
            await tx
              .update(agentRuns)
              .set({
                errorMessage: "Automation cancelled.",
                finishedAt: time,
                finishReason: "aborted",
                status: "failed"
              })
              .where(eq(agentRuns.id, runId))
            const [last] = await tx
              .select({ sequence: agentEvents.sequence })
              .from(agentEvents)
              .where(eq(agentEvents.runId, runId))
              .orderBy(desc(agentEvents.sequence))
              .limit(1)
            await tx.insert(agentEvents).values({
              createdAt: time,
              id: `${runId}:automation-cancelled`,
              payloadJson: JSON.stringify({
                automationRunId: automationRun.id
              }),
              runId,
              sequence: (last?.sequence ?? -1) + 1,
              type: "run.cancelled"
            })
            return approvals.map((approval) => approval.id)
          })
          for (const approvalId of approvalIds) {
            resolveApproval(approvalId, false)
          }
        })
        return new Response(null, { status: 204 })
      }
    )
    if (!response) {
      throw new Error(
        "This chat is running. Stop or finish its current turn before cancelling the paused task."
      )
    }
  }

  return {
    awaitSessionSettled: async (sessionId: string): Promise<void> => {
      while (isChatSessionExecuting(sessionId)) {
        await delay(50)
      }
    },
    cancelSuspended,
    inspectRun: async (run: AutomationRun) => {
      if (isChatSessionExecuting(run.sessionId)) {
        return null
      }
      return await readResult(run, run.agentRunId)
    },
    isSessionAvailable,
    readResult,
    validateTask
  }
}
