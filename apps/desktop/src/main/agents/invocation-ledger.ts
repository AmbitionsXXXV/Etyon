import { createHash } from "node:crypto"

import type { ToolSet } from "ai"
import { and, desc, eq, or } from "drizzle-orm"

import { redactSecretsFromJson } from "@/main/agents/agent-event-store"
import { HookBlockedError } from "@/main/agents/hooks/runner"
import type { AppDatabase } from "@/main/db"
import { getDb } from "@/main/db"
import { agentInvocations } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"

const SIDE_EFFECT_TOOLS = new Set([
  "artifact",
  "bash",
  "best_of_n",
  "browser",
  "edit",
  "imagen",
  "mcp",
  "save_memory",
  "task_create",
  "task_update",
  "write"
])
const MAX_RESULT_BYTES = 512 * 1024

export class InvocationOutcomeUnknownError extends Error {
  constructor(id: string, reason?: string) {
    super(
      `The outcome of invocation ${id} is unknown. ${reason ? `${String(redactSecretsFromJson(reason)).slice(0, 2000)} ` : ""}Check the existing operation before retrying.`
    )
    this.name = "InvocationOutcomeUnknownError"
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  return value
}

const inputSummary = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return {}
  }
  const record = value as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const name of [
    "action",
    "id",
    "path",
    "ref",
    "serverId",
    "taskId",
    "toolName"
  ]) {
    if (typeof record[name] === "string") {
      summary[name] = record[name].slice(0, 256)
    }
  }
  if (typeof record.command === "string") {
    const [commandName] = record.command.trim().split(/\s+/u)
    summary.commandName = commandName
  }
  return summary
}

export const runPersistedInvocation = async <TValue>({
  db,
  effectScope = "",
  execute,
  input,
  runId,
  sessionId,
  toolCallId,
  toolName
}: {
  db: AppDatabase
  effectScope?: string
  execute: () => Promise<TValue>
  input: unknown
  runId?: string | null
  sessionId: string
  toolCallId: string
  toolName: string
}): Promise<TValue> => {
  const scopedToolCallId = effectScope
    ? `${createHash("sha256").update(effectScope).digest("hex")}:${toolCallId}`
    : toolCallId
  const id = createHash("sha256")
    .update(`${sessionId}\u0000${scopedToolCallId}`)
    .digest("hex")
  const inputHash = createHash("sha256")
    .update(
      effectScope
        ? `${effectScope}\u0000${JSON.stringify(canonicalize(input))}`
        : JSON.stringify(canonicalize(input))
    )
    .digest("hex")
  const start = await runExclusiveDbWrite(async () => {
    const [existing] = await db
      .select()
      .from(agentInvocations)
      .where(eq(agentInvocations.id, id))
      .limit(1)
    if (existing) {
      if (existing.inputHash !== inputHash || existing.toolName !== toolName) {
        throw new Error("Invocation id was reused with different input")
      }
      if (existing.state === "succeeded" && existing.outputJson !== null) {
        return { cached: existing.outputJson }
      }
      if (existing.state === "succeeded") {
        throw new Error(
          "This operation was confirmed completed. Its original result is unavailable; do not replay it."
        )
      }
      if (existing.state === "failed") {
        throw new Error(
          existing.error ??
            "The invocation failed; a new approved call is required"
        )
      }
      throw new InvocationOutcomeUnknownError(id)
    }
    const [unsettled] = await db
      .select({ id: agentInvocations.id })
      .from(agentInvocations)
      .where(
        and(
          eq(agentInvocations.sessionId, sessionId),
          eq(agentInvocations.toolName, toolName),
          eq(agentInvocations.inputHash, inputHash),
          or(
            eq(agentInvocations.state, "unknown"),
            eq(agentInvocations.state, "executing")
          )
        )
      )
      .limit(1)
    if (unsettled) {
      throw new InvocationOutcomeUnknownError(unsettled.id)
    }
    const now = new Date().toISOString()
    await db.insert(agentInvocations).values({
      createdAt: now,
      error: null,
      id,
      inputHash,
      outputJson: null,
      runId: runId ?? null,
      sessionId,
      state: "executing",
      summaryJson: JSON.stringify(inputSummary(input)),
      toolCallId: scopedToolCallId,
      toolName,
      updatedAt: now
    })
    return { cached: null }
  })
  if (start.cached !== null) {
    return JSON.parse(start.cached) as TValue
  }
  let executed = false
  try {
    executed = true
    const result = await execute()
    const serialized = JSON.stringify(result)
    if (serialized === undefined) {
      throw new Error("Invocation returned no persistable result")
    }
    const outputJson = redactSecretsFromJson(serialized)
    if (
      outputJson === undefined ||
      Buffer.byteLength(outputJson) > MAX_RESULT_BYTES
    ) {
      throw new Error(
        "Invocation result cannot be persisted within the result limit"
      )
    }
    await runExclusiveDbWrite(async () => {
      await db
        .update(agentInvocations)
        .set({
          error: null,
          outputJson,
          state: "succeeded",
          updatedAt: new Date().toISOString()
        })
        .where(eq(agentInvocations.id, id))
    })
    return result
  } catch (error) {
    const unknown =
      !(error instanceof HookBlockedError) &&
      (executed || (error instanceof Error && error.name === "AbortError"))
    const message = error instanceof Error ? error.message : "Invocation failed"
    try {
      await runExclusiveDbWrite(async () => {
        await db
          .update(agentInvocations)
          .set({
            error: String(redactSecretsFromJson(message)).slice(0, 2000),
            state: unknown ? "unknown" : "failed",
            updatedAt: new Date().toISOString()
          })
          .where(eq(agentInvocations.id, id))
      })
    } catch {
      // The durable executing record remains a barrier to replay when the database is unavailable.
      throw new InvocationOutcomeUnknownError(id, message)
    }
    if (unknown) {
      throw new InvocationOutcomeUnknownError(id, message)
    }
    throw error
  }
}

export const recoverInterruptedInvocations = async (
  db: AppDatabase
): Promise<void> => {
  await runExclusiveDbWrite(async () => {
    await db
      .update(agentInvocations)
      .set({
        error: "Process stopped before the outcome was recorded",
        state: "unknown",
        updatedAt: new Date().toISOString()
      })
      .where(eq(agentInvocations.state, "executing"))
  })
}

export const listInvocations = async (db: AppDatabase, sessionId: string) =>
  await db
    .select({
      createdAt: agentInvocations.createdAt,
      error: agentInvocations.error,
      id: agentInvocations.id,
      state: agentInvocations.state,
      summaryJson: agentInvocations.summaryJson,
      toolName: agentInvocations.toolName,
      updatedAt: agentInvocations.updatedAt
    })
    .from(agentInvocations)
    .where(
      and(
        eq(agentInvocations.sessionId, sessionId),
        eq(agentInvocations.state, "unknown")
      )
    )
    .orderBy(desc(agentInvocations.createdAt))
    .limit(100)

export const resolveInvocationOutcome = async (
  db: AppDatabase,
  sessionId: string,
  id: string,
  completed: boolean
): Promise<void> => {
  await runExclusiveDbWrite(async () => {
    await db
      .update(agentInvocations)
      .set({
        error: completed
          ? "Confirmed completed by the user; original result unavailable"
          : "Confirmed not completed by the user",
        state: completed ? "succeeded" : "failed",
        updatedAt: new Date().toISOString()
      })
      .where(
        and(
          eq(agentInvocations.id, id),
          eq(agentInvocations.sessionId, sessionId),
          eq(agentInvocations.state, "unknown")
        )
      )
  })
}

export const protectToolInvocations = (
  tools: ToolSet,
  scope: {
    effectScope?: string
    protectAll?: boolean
    runId?: string | null
    sessionId?: string | null
  }
): ToolSet => {
  const { sessionId } = scope
  if (!sessionId) {
    return tools
  }
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const original = definition.execute
      if (
        !original ||
        !(
          scope.protectAll ||
          SIDE_EFFECT_TOOLS.has(toolName) ||
          toolName.startsWith("mcp__")
        )
      ) {
        return [toolName, definition]
      }
      return [
        toolName,
        {
          ...definition,
          execute: async (
            input: unknown,
            options: Parameters<typeof original>[1]
          ) =>
            await runPersistedInvocation({
              db: getDb(),
              effectScope: scope.effectScope,
              execute: async () => await original(input, options),
              input,
              runId: scope.runId,
              sessionId,
              toolCallId: options.toolCallId,
              toolName
            })
        }
      ]
    })
  )
}
