import { AutomationTaskDraftSchema } from "@etyon/rpc/schemas/automation"
import type {
  AutomationRun,
  AutomationTask,
  AutomationTaskDraft
} from "@etyon/rpc/schemas/automation"

import { nextAutomationRunAt } from "@/main/agents/automation/schedule"
import type { AutomationStore } from "@/main/agents/automation/store"

export interface AutomationExecutionResult {
  agentRunId: string | null
  error?: string | null
  status: "failed" | "skipped" | "succeeded" | "suspended"
  summary?: string | null
}

export interface AutomationManagerOptions {
  cancelSuspended: (run: AutomationRun) => Promise<void>
  execute: (
    task: AutomationTask,
    run: AutomationRun,
    signal: AbortSignal
  ) => Promise<AutomationExecutionResult>
  inspectRun: (run: AutomationRun) => Promise<AutomationExecutionResult | null>
  isSessionAvailable: (sessionId: string) => Promise<boolean>
  now?: () => Date
  notify: (task: AutomationTask, run: AutomationRun) => Promise<void>
  onError: (error: unknown) => void
  store: AutomationStore
  validateTask: (draft: AutomationTaskDraft) => Promise<void>
}

const TICK_MS = 1000
const MINUTE_MS = 60_000
const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : "Automation failed."

export const createAutomationManager = ({
  cancelSuspended,
  execute,
  inspectRun,
  isSessionAvailable,
  now = () => new Date(),
  notify,
  onError,
  store,
  validateTask
}: AutomationManagerOptions) => {
  const active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >()
  let timer: ReturnType<typeof setInterval> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let stopping = false
  let started = false

  const enqueue = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = queue
    const next = Promise.withResolvers<null>()
    queue = next.promise
    await previous
    try {
      return await operation()
    } finally {
      next.resolve(null)
    }
  }

  const notifyRun = async (
    task: AutomationTask,
    run: AutomationRun
  ): Promise<void> => {
    if (run.status === "skipped") {
      return
    }
    try {
      await notify(task, run)
      await store.updateRun(run.id, {
        notificationError: null,
        notifiedAt: now().toISOString()
      })
    } catch (error) {
      await store.updateRun(run.id, { notificationError: describeError(error) })
      onError(error)
    }
  }

  const settle = async (
    task: AutomationTask,
    run: AutomationRun,
    result: AutomationExecutionResult
  ): Promise<void> => {
    const time = now().toISOString()
    const current = await store.getRun(run.id)
    const updated = await store.updateRun(run.id, {
      agentRunId: result.agentRunId ?? current?.agentRunId ?? null,
      error: result.error ?? null,
      finishedAt: result.status === "suspended" ? null : time,
      notifiedAt: null,
      status: result.status,
      summary: result.summary ?? null,
      updatedAt: time
    })
    await notifyRun(task, updated)
  }

  const performRun = async (
    task: AutomationTask,
    run: AutomationRun,
    controller: AbortController
  ): Promise<void> => {
    const deadline = new AbortController()
    const timeout = setTimeout(
      () => deadline.abort(),
      task.timeoutMinutes * MINUTE_MS
    )
    timeout.unref?.()
    const signal = AbortSignal.any([controller.signal, deadline.signal])
    let executionResult: AutomationExecutionResult | null = null
    try {
      const result = await execute(task, run, signal)
      executionResult = result
      if (!signal.aborted) {
        await settle(task, run, result)
        return
      }
    } catch (error) {
      if (!signal.aborted) {
        await settle(task, run, {
          agentRunId: run.agentRunId,
          error: describeError(error),
          status: "failed"
        })
        return
      }
    } finally {
      clearTimeout(timeout)
    }
    if (executionResult?.status === "suspended" && executionResult.agentRunId) {
      try {
        await cancelSuspended({
          ...run,
          agentRunId: executionResult.agentRunId,
          status: "suspended"
        })
      } catch (error) {
        await store.updateRun(run.id, {
          agentRunId: executionResult.agentRunId,
          error: describeError(error),
          status: "suspended",
          updatedAt: now().toISOString()
        })
        onError(error)
        return
      }
    }
    const time = now().toISOString()
    const timedOut = deadline.signal.aborted && !controller.signal.aborted
    const status = timedOut
      ? "failed"
      : controller.signal.reason === "shutdown"
        ? "interrupted"
        : "cancelled"
    if (status === "interrupted") {
      await store.setEnabled(task.id, false, time, null)
    }
    const current = await store.getRun(run.id)
    const updated = await store.updateRun(run.id, {
      agentRunId: executionResult?.agentRunId ?? current?.agentRunId ?? null,
      error: timedOut ? "The automation exceeded its time limit." : null,
      finishedAt: time,
      status,
      updatedAt: time
    })
    await notifyRun(task, updated)
  }

  const launch = (task: AutomationTask, run: AutomationRun): void => {
    const controller = new AbortController()
    const promise = (async () => {
      try {
        await performRun(task, run, controller)
      } catch (error) {
        onError(error)
      } finally {
        active.delete(run.id)
      }
    })()
    active.set(run.id, { controller, promise })
  }

  const beginRun = async (
    task: AutomationTask,
    trigger: AutomationRun["trigger"]
  ): Promise<AutomationRun> => {
    if (stopping) {
      throw new Error("The automation service is stopping.")
    }
    const time = now().toISOString()
    if (!(await isSessionAvailable(task.sessionId))) {
      const skipped = await store.insertRun({
        error:
          "The chat is running or awaiting a response. Open it to finish the current turn.",
        status: "skipped",
        task,
        time,
        trigger
      })
      if (!skipped) {
        throw new Error("Unable to record the skipped automation.")
      }
      return skipped
    }
    const run = await store.insertRun({ task, time, trigger })
    if (!run) {
      const skipped = await store.insertRun({
        error: "Another automation owns this chat.",
        status: "skipped",
        task,
        time,
        trigger
      })
      if (!skipped) {
        throw new Error("Unable to record the skipped automation.")
      }
      return skipped
    }
    launch(task, run)
    return run
  }

  const reconcileSuspended = async (): Promise<void> => {
    for (const run of await store.listOpenRuns()) {
      if (active.has(run.id) || run.status !== "suspended") {
        continue
      }
      const result = await inspectRun(run)
      if (
        !result ||
        (result.status === "suspended" && result.agentRunId === run.agentRunId)
      ) {
        continue
      }
      const task = await store.getTask(run.taskId)
      if (task) {
        await settle(task, run, result)
      }
    }
  }

  const tick = async (): Promise<void> => {
    await enqueue(async () => {
      if (stopping) {
        return
      }
      await reconcileSuspended()
      const date = now()
      for (const task of await store.listDueTasks(date.toISOString())) {
        // Move the durable cursor past now before starting a run. A sleep/wake
        // or an overdue cron therefore runs at most once, never a catch-up storm.
        await store.setNextRunAt(
          task.id,
          nextAutomationRunAt(task.schedule, date)
        )
        await beginRun(task, "scheduled")
      }
    })
  }

  const start = async (): Promise<void> => {
    await enqueue(async () => {
      if (started) {
        return
      }
      stopping = false
      const date = now()
      const recovered = await store.recoverRunning(date.toISOString())
      for (const run of recovered) {
        const task = await store.getTask(run.taskId)
        if (task) {
          await notifyRun(task, run)
        }
      }
      for (const task of await store.listTasks()) {
        await store.setNextRunAt(
          task.id,
          task.enabled ? nextAutomationRunAt(task.schedule, date) : null
        )
      }
      await reconcileSuspended()
      started = true
      timer = setInterval(() => {
        void tick().catch(onError)
      }, TICK_MS)
      timer.unref?.()
    })
  }

  const save = async (rawDraft: AutomationTaskDraft): Promise<AutomationTask> =>
    await enqueue(async () => {
      const parsed = AutomationTaskDraftSchema.parse(rawDraft)
      const draft = {
        ...parsed,
        enabled: parsed.schedule.kind !== "manual" && parsed.enabled
      }
      await validateTask(draft)
      const date = now()
      const next = nextAutomationRunAt(draft.schedule, date)
      return await store.saveTask(
        draft,
        date.toISOString(),
        draft.enabled ? next : null
      )
    })

  const setEnabled = async (
    taskId: string,
    enabled: boolean
  ): Promise<AutomationTask> =>
    await enqueue(async () => {
      const task = await store.getTask(taskId)
      if (!task) {
        throw new Error("Automation task not found.")
      }
      const date = now()
      if (enabled && task.schedule.kind === "manual") {
        throw new Error(
          "Set an interval or cron schedule before enabling this task."
        )
      }
      return await store.setEnabled(
        taskId,
        enabled,
        date.toISOString(),
        enabled ? nextAutomationRunAt(task.schedule, date) : null
      )
    })

  const runNow = async (taskId: string): Promise<AutomationRun> =>
    await enqueue(async () => {
      const task = await store.getTask(taskId)
      if (!task) {
        throw new Error("Automation task not found.")
      }
      await validateTask(task)
      return await beginRun(task, "manual")
    })

  const cancel = async (runId: string): Promise<AutomationRun> => {
    const running = active.get(runId)
    if (running) {
      running.controller.abort("cancelled")
      await running.promise
      const run = await store.getRun(runId)
      if (!run) {
        throw new Error("Automation run not found.")
      }
      return run
    }
    return await enqueue(async () => {
      const run = await store.getRun(runId)
      if (!run) {
        throw new Error("Automation run not found.")
      }
      if (run.status !== "suspended") {
        return run
      }
      await cancelSuspended(run)
      const time = now().toISOString()
      const updated = await store.updateRun(runId, {
        error: null,
        finishedAt: time,
        status: "cancelled",
        updatedAt: time
      })
      const task = await store.getTask(run.taskId)
      if (task) {
        await notifyRun(task, updated)
      }
      return updated
    })
  }

  const stop = async (): Promise<void> => {
    stopping = true
    if (timer) {
      clearInterval(timer)
    }
    timer = null
    await queue
    for (const run of active.values()) {
      run.controller.abort("shutdown")
    }
    await Promise.all([...active.values()].map((run) => run.promise))
    started = false
  }

  return {
    cancel,
    list: async () => {
      const recent = await store.listRuns()
      const open = await store.listOpenRuns()
      const runs = [
        ...new Map([...open, ...recent].map((run) => [run.id, run])).values()
      ]
      return { runs, tasks: await store.listTasks() }
    },
    listRuns: store.listRuns,
    remove: async (taskId: string) =>
      await enqueue(async () => {
        await store.removeTask(taskId)
      }),
    runNow,
    save,
    setEnabled,
    start,
    stop,
    tick,
    waitForIdle: async () => {
      await Promise.all([...active.values()].map((run) => run.promise))
    }
  }
}

export type AutomationManager = ReturnType<typeof createAutomationManager>
