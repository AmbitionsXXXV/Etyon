import { randomUUID } from "node:crypto"

import { AutomationScheduleSchema } from "@etyon/rpc/schemas/automation"
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationTask,
  AutomationTaskDraft
} from "@etyon/rpc/schemas/automation"
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { automationRuns, automationTasks } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"

const OPEN_STATUSES = ["running", "suspended"] as const

const toTask = (row: typeof automationTasks.$inferSelect): AutomationTask => {
  const { scheduleJson, ...task } = row
  const raw: unknown = JSON.parse(scheduleJson)
  return { ...task, schedule: AutomationScheduleSchema.parse(raw) }
}

export const createAutomationStore = (db: AppDatabase) => {
  const getTask = async (taskId: string): Promise<AutomationTask | null> => {
    const [row] = await db
      .select()
      .from(automationTasks)
      .where(eq(automationTasks.id, taskId))
      .limit(1)
    return row ? toTask(row) : null
  }
  const getRun = async (runId: string): Promise<AutomationRun | null> => {
    const [row] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, runId))
      .limit(1)
    return row ?? null
  }
  const listTasks = async (): Promise<AutomationTask[]> => {
    const rows = await db
      .select()
      .from(automationTasks)
      .orderBy(asc(automationTasks.createdAt))
    return rows.map(toTask)
  }
  const listRuns = async (
    taskId?: string,
    limit = 30
  ): Promise<AutomationRun[]> =>
    await db
      .select()
      .from(automationRuns)
      .where(taskId ? eq(automationRuns.taskId, taskId) : undefined)
      .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
      .limit(limit)

  const listOpenRuns = async (): Promise<AutomationRun[]> =>
    await db
      .select()
      .from(automationRuns)
      .where(inArray(automationRuns.status, [...OPEN_STATUSES]))

  const listDueTasks = async (now: string): Promise<AutomationTask[]> => {
    const rows = await db
      .select()
      .from(automationTasks)
      .where(
        and(
          eq(automationTasks.enabled, true),
          lte(automationTasks.nextRunAt, now)
        )
      )
      .orderBy(asc(automationTasks.nextRunAt))
    return rows.map(toTask)
  }

  const saveTask = async (
    draft: AutomationTaskDraft,
    now: string,
    nextRunAt: string | null
  ): Promise<AutomationTask> =>
    await runExclusiveDbWrite(async () => {
      const existing = draft.id ? await getTask(draft.id) : null
      if (draft.id && !existing) {
        throw new Error("Automation task not found.")
      }
      if (existing) {
        const [active] = await db
          .select({ id: automationRuns.id })
          .from(automationRuns)
          .where(
            and(
              eq(automationRuns.taskId, existing.id),
              inArray(automationRuns.status, [...OPEN_STATUSES])
            )
          )
          .limit(1)
        if (active) {
          throw new Error(
            "Finish or cancel the current run before editing this task."
          )
        }
      }
      const { schedule, ...fields } = draft
      const row = {
        ...fields,
        createdAt: existing?.createdAt ?? now,
        id: existing?.id ?? randomUUID(),
        nextRunAt,
        scheduleJson: JSON.stringify(schedule),
        updatedAt: now
      }
      await db
        .insert(automationTasks)
        .values(row)
        .onConflictDoUpdate({ set: row, target: automationTasks.id })
      return toTask(row)
    })

  const setEnabled = async (
    taskId: string,
    enabled: boolean,
    now: string,
    nextRunAt: string | null
  ): Promise<AutomationTask> =>
    await runExclusiveDbWrite(async () => {
      const task = await getTask(taskId)
      if (!task) {
        throw new Error("Automation task not found.")
      }
      await db
        .update(automationTasks)
        .set({ enabled, nextRunAt, updatedAt: now })
        .where(eq(automationTasks.id, taskId))
      return { ...task, enabled, nextRunAt, updatedAt: now }
    })

  const setNextRunAt = async (
    taskId: string,
    nextRunAt: string | null
  ): Promise<void> => {
    await runExclusiveDbWrite(async () => {
      await db
        .update(automationTasks)
        .set({ nextRunAt })
        .where(eq(automationTasks.id, taskId))
    })
  }

  const removeTask = async (taskId: string): Promise<void> => {
    await runExclusiveDbWrite(async () => {
      const [active] = await db
        .select({ id: automationRuns.id })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.taskId, taskId),
            inArray(automationRuns.status, [...OPEN_STATUSES])
          )
        )
        .limit(1)
      if (active) {
        throw new Error(
          "Finish or cancel the current run before deleting this task."
        )
      }
      await db.delete(automationTasks).where(eq(automationTasks.id, taskId))
    })
  }

  const insertRun = async ({
    error = null,
    status = "running",
    task,
    time,
    trigger
  }: {
    error?: string | null
    status?: "running" | "skipped"
    task: AutomationTask
    time: string
    trigger: AutomationRun["trigger"]
  }): Promise<AutomationRun | null> =>
    await runExclusiveDbWrite(async () => {
      if (status === "running") {
        const [active] = await db
          .select({ id: automationRuns.id })
          .from(automationRuns)
          .where(
            and(
              eq(automationRuns.sessionId, task.sessionId),
              inArray(automationRuns.status, [...OPEN_STATUSES])
            )
          )
          .limit(1)
        if (active) {
          return null
        }
      }
      const run: AutomationRun = {
        agentRunId: null,
        error,
        finishedAt: status === "skipped" ? time : null,
        id: randomUUID(),
        notificationError: null,
        notifiedAt: null,
        sessionId: task.sessionId,
        startedAt: time,
        status,
        summary: null,
        taskId: task.id,
        trigger,
        updatedAt: time
      }
      await db.insert(automationRuns).values(run)
      return run
    })

  const updateRun = async (
    runId: string,
    patch: Partial<
      Omit<
        AutomationRun,
        "id" | "sessionId" | "taskId" | "trigger" | "startedAt"
      >
    >
  ): Promise<AutomationRun> =>
    await runExclusiveDbWrite(async () => {
      await db
        .update(automationRuns)
        .set(patch)
        .where(eq(automationRuns.id, runId))
      const run = await getRun(runId)
      if (!run) {
        throw new Error("Automation run not found.")
      }
      return run
    })

  const recoverRunning = async (now: string): Promise<AutomationRun[]> =>
    await runExclusiveDbWrite(
      async () =>
        await db.transaction(async (tx) => {
          const rows = await tx
            .select()
            .from(automationRuns)
            .where(eq(automationRuns.status, "running"))
          if (rows.length === 0) {
            return []
          }
          const patch = {
            error:
              "The app stopped before this run settled. Check the chat and tool results before running it again.",
            finishedAt: now,
            status: "interrupted" as AutomationRunStatus,
            updatedAt: now
          }
          await tx
            .update(automationRuns)
            .set(patch)
            .where(eq(automationRuns.status, "running"))
          await tx
            .update(automationTasks)
            .set({ enabled: false, nextRunAt: null, updatedAt: now })
            .where(
              inArray(
                automationTasks.id,
                rows.map((row) => row.taskId)
              )
            )
          return rows.map((row) => ({ ...row, ...patch }))
        })
    )

  return {
    getRun,
    getTask,
    insertRun,
    listDueTasks,
    listOpenRuns,
    listRuns,
    listTasks,
    recoverRunning,
    removeTask,
    saveTask,
    setEnabled,
    setNextRunAt,
    updateRun
  }
}

export type AutomationStore = ReturnType<typeof createAutomationStore>
