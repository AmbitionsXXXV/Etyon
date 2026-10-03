import path from "node:path"

import { AutomationTaskDraftSchema } from "@etyon/rpc/schemas/automation"
import type {
  AutomationRun,
  AutomationTask,
  AutomationTaskDraft
} from "@etyon/rpc/schemas/automation"
import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import { migrate } from "drizzle-orm/libsql/migrator"
import { drizzle } from "drizzle-orm/libsql/node"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { createAutomationManager } from "@/main/agents/automation/manager"
import type { AutomationExecutionResult } from "@/main/agents/automation/manager"
import { nextAutomationRunAt } from "@/main/agents/automation/schedule"
import { createAutomationStore } from "@/main/agents/automation/store"
import { chatSessions, schema } from "@/main/db/schema"

const clients: Client[] = []
const managers: ReturnType<typeof createAutomationManager>[] = []
const migrationsFolder = path.join(
  process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : path.join(process.cwd(), "apps/desktop"),
  "drizzle"
)

const createFixture = async () => {
  const client = createClient({ url: "file::memory:" })
  clients.push(client)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  const time = "2026-10-03T00:00:00.000Z"
  await db.insert(chatSessions).values({
    createdAt: time,
    id: "chat-a",
    lastOpenedAt: time,
    projectPath: "/tmp/automation-test",
    title: "Automation chat",
    updatedAt: time
  })
  const store = createAutomationStore(db)
  let date = new Date(time)
  const execute = vi.fn(
    (
      _task: AutomationTask,
      _run: AutomationRun,
      _signal: AbortSignal
    ): Promise<AutomationExecutionResult> =>
      Promise.resolve({
        agentRunId: "agent-a",
        status: "succeeded",
        summary: "Done"
      })
  )
  const inspectRun = vi.fn(
    (_run: AutomationRun): Promise<AutomationExecutionResult | null> =>
      Promise.resolve(null)
  )
  const isSessionAvailable = vi.fn(() => Promise.resolve(true))
  const notify = vi.fn(async () => {
    /* fake notification */
  })
  const cancelSuspended = vi.fn(async () => {
    /* fake approval cancellation */
  })
  const manager = createAutomationManager({
    cancelSuspended,
    execute,
    inspectRun,
    isSessionAvailable,
    now: () => date,
    notify,
    onError: vi.fn(),
    store,
    validateTask: vi.fn(async () => {
      /* fixture session exists */
    })
  })
  managers.push(manager)
  return {
    cancelSuspended,
    db,
    execute,
    inspectRun,
    isSessionAvailable,
    manager,
    notify,
    setDate: (value: string) => {
      date = new Date(value)
    },
    store
  }
}

const draft = (
  overrides: Partial<AutomationTaskDraft> = {}
): AutomationTaskDraft =>
  AutomationTaskDraftSchema.parse({
    name: "Check project",
    prompt: "Read the project status",
    schedule: { kind: "manual" },
    sessionId: "chat-a",
    ...overrides
  })

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    await manager.stop()
  }
  for (const client of clients.splice(0)) {
    client.close()
  }
  vi.useRealTimers()
})

describe("background automation", () => {
  it("defaults to disabled schedules and rejects bypass permissions", () => {
    const task = draft()
    expect(task.enabled).toBe(false)
    expect(task.permissionMode).toBe("default")
    expect(task.notifyTelegram).toBe(false)
    expect(() =>
      AutomationTaskDraftSchema.parse({ ...task, permissionMode: "bypass" })
    ).toThrow()
  })

  it("computes cron runs in the task's time zone and refuses malformed schedules", () => {
    expect(
      nextAutomationRunAt(
        { expression: "0 9 * * 1-5", kind: "cron", timeZone: "Asia/Tokyo" },
        new Date("2026-10-02T00:01:00Z")
      )
    ).toBe("2026-10-05T00:00:00.000Z")
    expect(() =>
      nextAutomationRunAt(
        { expression: "bad", kind: "cron", timeZone: "Asia/Tokyo" },
        new Date()
      )
    ).toThrow()
    expect(() =>
      nextAutomationRunAt(
        { expression: "0 9 * * *", kind: "cron", timeZone: "Bad/Zone" },
        new Date()
      )
    ).toThrow()
  })

  it("persists an overdue interval cursor beyond now and runs only once after sleep", async () => {
    const fixture = await createFixture()
    const task = await fixture.manager.save(
      draft({ enabled: true, schedule: { kind: "interval", minutes: 5 } })
    )
    fixture.setDate("2026-10-03T12:00:00Z")
    await fixture.manager.tick()
    await fixture.manager.waitForIdle()
    await fixture.manager.tick()
    const data = await fixture.manager.list()
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    expect(data.tasks[0]?.nextRunAt).toBe("2026-10-03T12:05:00.000Z")
    expect(data.runs[0]).toMatchObject({
      status: "succeeded",
      taskId: task.id,
      trigger: "scheduled"
    })
    expect(fixture.notify).toHaveBeenCalledTimes(1)
  })

  it("prevents simultaneous tasks from sharing a chat", async () => {
    const fixture = await createFixture()
    const result = Promise.withResolvers<{
      agentRunId: string
      status: "succeeded"
      summary: string
    }>()
    fixture.execute.mockImplementation(async () => await result.promise)
    const task = await fixture.manager.save(draft())
    const other = await fixture.manager.save(draft({ name: "Second task" }))
    const running = await fixture.manager.runNow(task.id)
    const skipped = await fixture.manager.runNow(other.id)
    expect(running.status).toBe("running")
    expect(skipped.status).toBe("skipped")
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    result.resolve({
      agentRunId: "agent-a",
      status: "succeeded",
      summary: "Done"
    })
    await fixture.manager.waitForIdle()
  })

  it("skips a busy or pending-approval chat without executing or notifying", async () => {
    const fixture = await createFixture()
    fixture.isSessionAvailable.mockResolvedValue(false)
    const task = await fixture.manager.save(draft())
    const run = await fixture.manager.runNow(task.id)
    expect(run.status).toBe("skipped")
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.notify).not.toHaveBeenCalled()
  })

  it("holds a suspended task until its approval continuation settles", async () => {
    const fixture = await createFixture()
    fixture.execute.mockResolvedValue({
      agentRunId: "agent-a",
      status: "suspended",
      summary: "Approval needed"
    })
    const task = await fixture.manager.save(draft())
    const run = await fixture.manager.runNow(task.id)
    await fixture.manager.waitForIdle()
    expect(await fixture.store.getRun(run.id)).toMatchObject({
      finishedAt: null,
      status: "suspended"
    })
    const skipped = await fixture.manager.runNow(task.id)
    expect(skipped.status).toBe("skipped")
    await expect(
      fixture.manager.save({ ...draft(), id: task.id })
    ).rejects.toThrow("Finish or cancel")
    fixture.inspectRun.mockResolvedValue({
      agentRunId: "continuation",
      status: "succeeded",
      summary: "Approved and finished"
    })
    await fixture.manager.tick()
    expect(await fixture.store.getRun(run.id)).toMatchObject({
      agentRunId: "continuation",
      status: "succeeded"
    })
    expect(fixture.notify).toHaveBeenCalledTimes(2)
  })

  it("waits for execution to settle before acknowledging cancellation", async () => {
    const fixture = await createFixture()
    const settled = Promise.withResolvers<{
      agentRunId: string
      status: "succeeded"
      summary: string
    }>()
    let abortSignal: AbortSignal | undefined
    fixture.execute.mockImplementation(async (_task, _run, signal) => {
      abortSignal = signal
      return await settled.promise
    })
    const task = await fixture.manager.save(draft())
    const run = await fixture.manager.runNow(task.id)
    const cancellation = fixture.manager.cancel(run.id)
    expect(abortSignal?.aborted).toBe(true)
    const beforeSettlement = await fixture.store.getRun(run.id)
    expect(beforeSettlement?.status).toBe("running")
    settled.resolve({
      agentRunId: "agent-a",
      status: "succeeded",
      summary: "Stopped"
    })
    const cancelled = await cancellation
    expect(cancelled.status).toBe("cancelled")
  })

  it("denies a paused run through the suspension adapter before cancelling its ledger", async () => {
    const fixture = await createFixture()
    fixture.execute.mockResolvedValue({
      agentRunId: "agent-a",
      status: "suspended",
      summary: "Approval needed"
    })
    const task = await fixture.manager.save(draft())
    const run = await fixture.manager.runNow(task.id)
    await fixture.manager.waitForIdle()
    const cancelled = await fixture.manager.cancel(run.id)
    expect(cancelled.status).toBe("cancelled")
    expect(fixture.cancelSuspended).toHaveBeenCalledWith(
      expect.objectContaining({ agentRunId: "agent-a", id: run.id })
    )
  })

  it("recovers interrupted runs without replaying their prompts or missed intervals", async () => {
    const fixture = await createFixture()
    const task = await fixture.manager.save(
      draft({ enabled: true, schedule: { kind: "interval", minutes: 5 } })
    )
    const run = await fixture.store.insertRun({
      task,
      time: "2026-10-03T00:00:00.000Z",
      trigger: "scheduled"
    })
    fixture.setDate("2026-10-04T00:00:00Z")
    await fixture.manager.start()
    await fixture.manager.tick()
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(run && (await fixture.store.getRun(run.id))).toMatchObject({
      status: "interrupted"
    })
    const restoredTask = await fixture.store.getTask(task.id)
    expect(restoredTask).toMatchObject({ enabled: false, nextRunAt: null })
    fixture.setDate("2026-10-05T00:00:00Z")
    await fixture.manager.tick()
    expect(fixture.execute).not.toHaveBeenCalled()
    const resumed = await fixture.manager.setEnabled(task.id, true)
    expect(resumed.nextRunAt).toBe("2026-10-05T00:05:00.000Z")
  })

  it("records notification failure without changing a successful execution", async () => {
    const fixture = await createFixture()
    fixture.notify.mockRejectedValue(new Error("Notification unavailable"))
    const task = await fixture.manager.save(draft())
    const run = await fixture.manager.runNow(task.id)
    await fixture.manager.waitForIdle()
    expect(await fixture.store.getRun(run.id)).toMatchObject({
      notificationError: "Notification unavailable",
      notifiedAt: null,
      status: "succeeded"
    })
  })

  it("keeps a paused run visible after more than thirty skipped triggers", async () => {
    const fixture = await createFixture()
    fixture.execute.mockResolvedValue({
      agentRunId: "agent-a",
      status: "suspended"
    })
    const task = await fixture.manager.save(draft())
    const paused = await fixture.manager.runNow(task.id)
    await fixture.manager.waitForIdle()
    for (let minute = 1; minute <= 31; minute += 1) {
      fixture.setDate(`2026-10-03T00:${String(minute).padStart(2, "0")}:00Z`)
      await fixture.manager.runNow(task.id)
    }
    const data = await fixture.manager.list()
    expect(data.runs.find((run) => run.id === paused.id)?.status).toBe(
      "suspended"
    )
    expect(data.runs).toHaveLength(31)
  })

  it("tracks the next approval when a human continuation pauses a second time", async () => {
    const fixture = await createFixture()
    fixture.execute.mockResolvedValue({
      agentRunId: "agent-a",
      status: "suspended"
    })
    const task = await fixture.manager.save(draft())
    const run = await fixture.manager.runNow(task.id)
    await fixture.manager.waitForIdle()
    fixture.inspectRun.mockResolvedValue({
      agentRunId: "next-approval-run",
      status: "suspended"
    })
    await fixture.manager.tick()
    await fixture.manager.tick()
    expect(await fixture.store.getRun(run.id)).toMatchObject({
      agentRunId: "next-approval-run",
      status: "suspended"
    })
    await fixture.manager.cancel(run.id)
    expect(fixture.cancelSuspended).toHaveBeenCalledWith(
      expect.objectContaining({ agentRunId: "next-approval-run" })
    )
    expect(fixture.notify).toHaveBeenCalledTimes(3)
  })

  it("enforces the time limit and settles the underlying execution before recording failure", async () => {
    const fixture = await createFixture()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    fixture.execute.mockImplementation(async (_task, _run, signal) => {
      const result = Promise.withResolvers<AutomationExecutionResult>()
      signal.addEventListener(
        "abort",
        () => result.resolve({ agentRunId: "timed-out-run", status: "failed" }),
        { once: true }
      )
      return await result.promise
    })
    const task = await fixture.manager.save(draft({ timeoutMinutes: 1 }))
    const run = await fixture.manager.runNow(task.id)
    await vi.advanceTimersByTimeAsync(60_000)
    await fixture.manager.waitForIdle()
    expect(await fixture.store.getRun(run.id)).toMatchObject({
      error: "The automation exceeded its time limit.",
      agentRunId: "timed-out-run",
      status: "failed"
    })
  })

  it("does not enable a task without a recurring schedule", async () => {
    const fixture = await createFixture()
    const task = await fixture.manager.save(draft({ enabled: true }))
    expect(task.enabled).toBe(false)
    await expect(fixture.manager.setEnabled(task.id, true)).rejects.toThrow(
      "Set an interval or cron"
    )
  })

  it("stops a running schedule on app shutdown until the user reviews and reenables it", async () => {
    const fixture = await createFixture()
    fixture.execute.mockImplementation(async (_task, _run, signal) => {
      const result = Promise.withResolvers<AutomationExecutionResult>()
      signal.addEventListener(
        "abort",
        () => result.resolve({ agentRunId: "shutdown-run", status: "failed" }),
        { once: true }
      )
      return await result.promise
    })
    const task = await fixture.manager.save(
      draft({ enabled: true, schedule: { kind: "interval", minutes: 5 } })
    )
    const run = await fixture.manager.runNow(task.id)
    await fixture.manager.stop()
    expect(await fixture.store.getRun(run.id)).toMatchObject({
      agentRunId: "shutdown-run",
      status: "interrupted"
    })
    expect(await fixture.store.getTask(task.id)).toMatchObject({
      enabled: false,
      nextRunAt: null
    })
  })
})
