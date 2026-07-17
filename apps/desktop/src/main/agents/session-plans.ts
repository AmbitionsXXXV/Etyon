import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { chatSessionPlans } from "@/main/db/schema"
import { isRecord } from "@/renderer/lib/utils"
import {
  PROPOSE_PLAN_TOOL_PART_TYPE,
  ProposePlanInputSchema,
  ProposePlanOutputSchema
} from "@/shared/agents/input-tools"

/**
 * `chat_session_plans` is a single-row-per-session read-model of the latest
 * `propose_plan` tool call. It is rebuildable from the durable message parts, so
 * the derivation here is pure and idempotent: re-persisting an old turn must
 * never resurrect a plan the user manually finished. The wrapper reads the
 * current row, applies the derivation, and upserts.
 */

export type SessionPlanStatus =
  | "dismissed"
  | "done"
  | "implementing"
  | "proposed"

/** The two statuses a user can set manually (via RPC), after the model's part
 * can no longer drive the row. */
export type SessionPlanManualStatus = "dismissed" | "done"

export type ChatSessionPlanRow = typeof chatSessionPlans.$inferSelect

/** Minimal view of the stored row the derivation reads for its clobber guards. */
export interface ExistingSessionPlanForUpsert {
  sourceToolCallId: string | null
  status: SessionPlanStatus
}

/** The model can only ever derive `proposed`/`implementing`; `done`/`dismissed`
 * are manual states. `decided` tells the wrapper whether to stamp `decidedAt`. */
export interface SessionPlanUpsert {
  decided: boolean
  planMarkdown: string
  sourceRunId: string | null
  sourceToolCallId: string
  status: "implementing" | "proposed"
  title: string
}

interface ProposePlanPartView {
  input: unknown
  output: unknown
  toolCallId: string
}

const nowIso = (): string => new Date().toISOString()

const toProposePlanPart = (part: unknown): ProposePlanPartView | null => {
  if (!isRecord(part) || part.type !== PROPOSE_PLAN_TOOL_PART_TYPE) {
    return null
  }

  const toolCallId =
    typeof part.toolCallId === "string" ? part.toolCallId : null

  if (!toolCallId) {
    return null
  }

  return { input: part.input, output: part.output, toolCallId }
}

const findLastProposePlanPart = (
  messages: UIMessage[]
): ProposePlanPartView | null => {
  let last: ProposePlanPartView | null = null

  for (const message of messages) {
    for (const part of message.parts) {
      const view = toProposePlanPart(part)

      if (view) {
        last = view
      }
    }
  }

  return last
}

/**
 * Pure projection of a turn's messages into the plan upsert action (or null when
 * nothing should change). Exported for unit tests.
 *
 * Clobber guards, given the LAST `propose_plan` part:
 * - Same tool call, existing row already `done`/`dismissed`: return null. A
 *   re-persist of the old turn must not revive a finished plan.
 * - Same tool call, existing row `proposed`/`implementing`: allow only the
 *   output-driven `proposed` -> `implementing` transition; otherwise no-op.
 * - Different tool call: a newer plan supersedes the old one fully.
 */
export const deriveSessionPlanUpsert = ({
  existing,
  messages,
  runId
}: {
  existing: ExistingSessionPlanForUpsert | null
  messages: UIMessage[]
  runId: string | null
}): SessionPlanUpsert | null => {
  const part = findLastProposePlanPart(messages)

  if (!part) {
    return null
  }

  const parsedInput = ProposePlanInputSchema.safeParse(part.input)

  if (!parsedInput.success) {
    return null
  }

  const parsedOutput = ProposePlanOutputSchema.safeParse(part.output)
  const decision = parsedOutput.success ? parsedOutput.data.decision : null
  const status: "implementing" | "proposed" =
    decision === "implement" ? "implementing" : "proposed"

  const action: SessionPlanUpsert = {
    decided: decision !== null,
    planMarkdown: parsedInput.data.plan,
    sourceRunId: runId,
    sourceToolCallId: part.toolCallId,
    status,
    title: parsedInput.data.title
  }

  if (!existing) {
    return action
  }

  // A different (newer) plan supersedes the old one fully, even a finished one.
  if (existing.sourceToolCallId !== part.toolCallId) {
    return action
  }

  // Same tool call: never resurrect a manually finished plan.
  if (existing.status === "done" || existing.status === "dismissed") {
    return null
  }

  // Same active plan: the only allowed change is proposed -> implementing.
  if (existing.status === "proposed" && status === "implementing") {
    return action
  }

  // Nothing changed (or a disallowed regression) — no write.
  return null
}

export const getSessionPlan = async (
  db: AppDatabase,
  sessionId: string
): Promise<ChatSessionPlanRow | null> => {
  const [row] = await db
    .select()
    .from(chatSessionPlans)
    .where(eq(chatSessionPlans.sessionId, sessionId))
    .limit(1)

  return row ?? null
}

export const upsertSessionPlanFromMessages = async ({
  db,
  messages,
  runId,
  sessionId
}: {
  db: AppDatabase
  messages: UIMessage[]
  runId: string | null
  sessionId: string
}): Promise<ChatSessionPlanRow | null> => {
  const existing = await getSessionPlan(db, sessionId)
  const action = deriveSessionPlanUpsert({ existing, messages, runId })

  if (!action) {
    return existing
  }

  const now = nowIso()
  const decidedAt = action.decided ? now : null
  const [row] = await db
    .insert(chatSessionPlans)
    .values({
      createdAt: now,
      decidedAt,
      planMarkdown: action.planMarkdown,
      sessionId,
      sourceRunId: action.sourceRunId,
      sourceToolCallId: action.sourceToolCallId,
      status: action.status,
      title: action.title,
      updatedAt: now
    })
    .onConflictDoUpdate({
      set: {
        decidedAt,
        planMarkdown: action.planMarkdown,
        sourceRunId: action.sourceRunId,
        sourceToolCallId: action.sourceToolCallId,
        status: action.status,
        title: action.title,
        updatedAt: now
      },
      target: chatSessionPlans.sessionId
    })
    .returning()

  return row ?? null
}

export const setSessionPlanStatus = async ({
  db,
  sessionId,
  status
}: {
  db: AppDatabase
  sessionId: string
  status: SessionPlanManualStatus
}): Promise<ChatSessionPlanRow | null> => {
  const now = nowIso()
  const [row] = await db
    .update(chatSessionPlans)
    .set({ decidedAt: now, status, updatedAt: now })
    .where(eq(chatSessionPlans.sessionId, sessionId))
    .returning()

  return row ?? null
}
