import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type {
  AutomationRun,
  AutomationTask
} from "@etyon/rpc/schemas/automation"
import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/libsql/migrator"
import { drizzle } from "drizzle-orm/libsql/node"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  createAutomationAgentState,
  getAutomationSessionConflict
} from "@/main/agents/automation/agent-state"
import { createHeadlessAutomationRunner } from "@/main/agents/automation/headless-runner"
import type { AutomationExecutionResult } from "@/main/agents/automation/manager"
import { createAutomationNotifier } from "@/main/agents/automation/notifications"
import { listChatMessages } from "@/main/chat-messages"
import {
  agentApprovals,
  agentEvents,
  agentRuns,
  agentToolCalls,
  chatMessages,
  chatSessions,
  schema
} from "@/main/db/schema"
import { runWithChatSessionExecution } from "@/main/server/routes/chat-session-execution"
import { shouldSendChatAutomatically } from "@/renderer/lib/chat/auto-send"

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
  app: {
    getLocale: () => "en-US",
    getPath: () => "/tmp/etyon-automation-runtime-test",
    getVersion: () => "test"
  }
}))
vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))
vi.mock("@/main/settings", () => ({
  getSettings: () => AppSettingsSchema.parse({})
}))

const clients: Client[] = []
const time = "2026-10-03T00:00:00.000Z"
const task = (overrides: Partial<AutomationTask> = {}): AutomationTask => ({
  createdAt: time,
  enabled: false,
  id: "task-a",
  modelId: "openai/test",
  name: "Check project",
  nextRunAt: null,
  notifyDesktop: true,
  notifyTelegram: false,
  permissionMode: "default",
  profileId: "coder",
  prompt: "Read project status",
  schedule: { kind: "manual" },
  sessionId: "chat-a",
  timeoutMinutes: 30,
  updatedAt: time,
  ...overrides
})
const automationRun = (
  overrides: Partial<AutomationRun> = {}
): AutomationRun => ({
  agentRunId: "agent-a",
  error: null,
  finishedAt: null,
  id: "automation-a",
  notificationError: null,
  notifiedAt: null,
  sessionId: "chat-a",
  startedAt: time,
  status: "suspended",
  summary: null,
  taskId: "task-a",
  trigger: "manual",
  updatedAt: time,
  ...overrides
})

const createDb = async () => {
  const client = createClient({ url: "file::memory:" })
  clients.push(client)
  const db = drizzle(client, { schema })
  const root = process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : path.join(process.cwd(), "apps/desktop")
  await migrate(db, { migrationsFolder: path.join(root, "drizzle") })
  await db.insert(chatSessions).values({
    createdAt: time,
    id: "chat-a",
    lastOpenedAt: time,
    projectPath: "/tmp/automation-runtime-test",
    title: "Automation chat",
    updatedAt: time
  })
  return db
}

const seedApproval = async (
  db: Awaited<ReturnType<typeof createDb>>,
  runId: string,
  callId: string
) => {
  await db.insert(agentRuns).values({
    chatSessionId: "chat-a",
    id: runId,
    profileId: "coder",
    startedAt: time,
    status: "suspended"
  })
  await db.insert(agentToolCalls).values({
    approvalState: "pending",
    id: `${runId}:${callId}`,
    inputJson: "{}",
    runId,
    startedAt: time,
    state: "approval_requested",
    toolName: "bash"
  })
  await db.insert(agentApprovals).values({
    createdAt: time,
    id: `approval-${runId}`,
    runId,
    state: "pending",
    toolCallId: callId,
    toolCallRowId: `${runId}:${callId}`
  })
  await db.insert(chatMessages).values({
    agentProjectionRunId: runId,
    createdAt: time,
    messageId: `assistant-${runId}`,
    partsJson: JSON.stringify([
      {
        approval: { id: `approval-${runId}` },
        input: { command: "echo test" },
        state: "approval-requested",
        toolCallId: callId,
        type: "tool-bash"
      }
    ]),
    role: "assistant",
    sequence: runId === "agent-a" ? 1 : 2,
    sessionId: "chat-a",
    updatedAt: time
  })
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close()
  }
})

describe("headless automation runner", () => {
  it("uses authenticated /api/chat and waits for the full stream before reading durable results", async () => {
    let finishStream: (() => void) | undefined
    let request: Request | undefined
    const readResult = vi.fn((): Promise<AutomationExecutionResult> =>
      Promise.resolve({
        agentRunId: "agent-a",
        status: "suspended"
      })
    )
    const started = vi.fn(async () => {
      /* fake durable run association */
    })
    const runner = createHeadlessAutomationRunner({
      awaitSessionSettled: vi.fn(async () => {
        /* fake lease */
      }),
      fetchRequest: (value) => {
        request = value
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: {}\n\n"))
                finishStream = () => controller.close()
              }
            }),
            { headers: { "x-etyon-agent-run-id": "agent-a" } }
          )
        )
      },
      getConnectionToken: () => "test-only-token",
      getServerUrl: () => "http://127.0.0.1:12345",
      onRunStarted: started,
      readResult
    })
    const controller = new AbortController()
    const execution = runner(task(), automationRun(), controller.signal)
    await vi.waitFor(() =>
      expect(started).toHaveBeenCalledWith("automation-a", "agent-a")
    )
    expect(readResult).not.toHaveBeenCalled()
    expect(request?.url).toBe("http://127.0.0.1:12345/api/chat")
    expect(request?.headers.get("authorization")).toBe("Bearer test-only-token")
    expect(await request?.json()).toEqual({
      agentMode: "agent",
      automationPrompt: "Read project status",
      automationRunId: "automation-a",
      model: "openai/test",
      permissionMode: "default",
      profileId: "coder",
      sessionId: "chat-a"
    })
    finishStream?.()
    const result = await execution
    expect(result.status).toBe("suspended")
  })

  it("treats a chat lease conflict as skipped and never executes approvals", async () => {
    const readResult = vi.fn()
    const runner = createHeadlessAutomationRunner({
      awaitSessionSettled: vi.fn(),
      fetchRequest: () => Promise.resolve(new Response(null, { status: 409 })),
      getConnectionToken: () => "test-only-token",
      getServerUrl: () => "http://127.0.0.1:12345",
      onRunStarted: vi.fn(),
      readResult
    })
    const result = await runner(
      task(),
      automationRun(),
      new AbortController().signal
    )
    expect(result.status).toBe("skipped")
    expect(readResult).not.toHaveBeenCalled()
  })

  it("does not finish an aborted client until the server's session lease settles", async () => {
    const lease = Promise.withResolvers<null>()
    const started = vi.fn(async () => {
      /* fake run association */
    })
    const awaitSessionSettled = vi.fn(async () => {
      await lease.promise
    })
    const runner = createHeadlessAutomationRunner({
      awaitSessionSettled,
      fetchRequest: (request) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(stream) {
                request.signal.addEventListener(
                  "abort",
                  () => stream.error(new Error("Client aborted")),
                  { once: true }
                )
              }
            }),
            { headers: { "x-etyon-agent-run-id": "agent-a" } }
          )
        ),
      getConnectionToken: () => "test-only-token",
      getServerUrl: () => "http://127.0.0.1:12345",
      onRunStarted: started,
      readResult: () =>
        Promise.resolve({ agentRunId: "agent-a", status: "failed" })
    })
    const controller = new AbortController()
    let finished = false
    const execution = runner(task(), automationRun(), controller.signal)
    const completion = (async () => {
      await execution
      finished = true
    })()
    await vi.waitFor(() => expect(started).toHaveBeenCalled())
    controller.abort()
    await vi.waitFor(() =>
      expect(awaitSessionSettled).toHaveBeenCalledWith("chat-a")
    )
    expect(finished).toBe(false)
    lease.resolve(null)
    await completion
    expect(finished).toBe(true)
  })

  it("reads back a settled durable result after an indeterminate stream disconnect", async () => {
    const awaitSessionSettled = vi.fn(() => Promise.resolve())
    const runner = createHeadlessAutomationRunner({
      awaitSessionSettled,
      fetchRequest: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("Connection dropped"))
              }
            }),
            { headers: { "x-etyon-agent-run-id": "agent-a" } }
          )
        ),
      getConnectionToken: () => "test-only-token",
      getServerUrl: () => "http://127.0.0.1:12345",
      onRunStarted: vi.fn(),
      readResult: () =>
        Promise.resolve({ agentRunId: "agent-a", status: "succeeded" })
    })
    const result = await runner(
      task(),
      automationRun(),
      new AbortController().signal
    )
    expect(result.status).toBe("succeeded")
    expect(awaitSessionSettled).toHaveBeenCalledWith("chat-a")
  })
})

describe("automation agent-state adapter", () => {
  it("detects a human approval that appeared after preflight when checking again inside the route lease", async () => {
    const db = await createDb()
    expect(await getAutomationSessionConflict(db, "chat-a")).toBeNull()
    await seedApproval(db, "agent-a", "call-a")
    const response = await runWithChatSessionExecution("chat-a", async () => {
      const conflict = await getAutomationSessionConflict(db, "chat-a")
      return conflict
        ? Response.json({ error: "chat_session_busy" }, { status: 409 })
        : new Response(null, { status: 204 })
    })
    expect(response?.status).toBe(409)
    const [approval] = await db.select().from(agentApprovals)
    expect(approval?.state).toBe("pending")
    expect(
      await createAutomationAgentState(db).isSessionAvailable("chat-a")
    ).toBe(false)
  })

  it("blocks a pending child approval even after its root has closed", async () => {
    const db = await createDb()
    await seedApproval(db, "agent-a", "call-a")
    await db
      .update(agentRuns)
      .set({ parentRunId: "closed-parent", status: "failed" })
      .where(eq(agentRuns.id, "agent-a"))
    expect(await getAutomationSessionConflict(db, "chat-a")).toBe(
      "pending_response"
    )
    await db
      .update(agentApprovals)
      .set({ state: "denied" })
      .where(eq(agentApprovals.runId, "agent-a"))
    expect(await getAutomationSessionConflict(db, "chat-a")).toBeNull()
  })

  it("cancels only the selected paused run's approvals and canonical tool parts", async () => {
    const db = await createDb()
    await seedApproval(db, "agent-a", "call-a")
    await seedApproval(db, "agent-unrelated", "call-unrelated")
    const state = createAutomationAgentState(db)
    await state.cancelSuspended(automationRun())
    const approvals = await db.select().from(agentApprovals)
    expect(
      approvals.find((approval) => approval.runId === "agent-a")?.state
    ).toBe("denied")
    expect(
      approvals.find((approval) => approval.runId === "agent-unrelated")?.state
    ).toBe("pending")
    const messages = await db.select().from(chatMessages)
    const selectedParts: unknown = JSON.parse(
      messages.find((message) => message.agentProjectionRunId === "agent-a")
        ?.partsJson ?? "null"
    )
    expect(selectedParts).toEqual([
      expect.objectContaining({
        approval: expect.objectContaining({ approved: false }),
        state: "output-denied"
      })
    ])
    const [unrelated] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, "agent-unrelated"))
    expect(unrelated?.status).toBe("suspended")
    const [cancelledMessage] = await listChatMessages({
      db,
      sessionId: "chat-a"
    })
    if (!cancelledMessage) {
      throw new Error("The cancelled message was not persisted.")
    }
    expect(shouldSendChatAutomatically({ messages: [cancelledMessage] })).toBe(
      false
    )
    expect(cancelledMessage.metadata).toMatchObject({ exitReason: "aborted" })
    const result = await state.readResult(automationRun(), "agent-a")
    expect(result.status).toBe("failed")
  })

  it("refuses cancellation while a human continuation owns the session lease", async () => {
    const db = await createDb()
    await seedApproval(db, "agent-a", "call-a")
    let close: (() => void) | undefined
    const response = await runWithChatSessionExecution("chat-a", () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              close = () => controller.close()
            }
          })
        )
      )
    )
    try {
      await expect(
        createAutomationAgentState(db).cancelSuspended(automationRun())
      ).rejects.toThrow("This chat is running")
      const [approval] = await db.select().from(agentApprovals)
      expect(approval?.state).toBe("pending")
    } finally {
      close?.()
      await response?.arrayBuffer()
    }
  })

  it("follows the durable approval continuation instead of reporting the superseded run as completed", async () => {
    const db = await createDb()
    await db.insert(agentRuns).values([
      {
        chatSessionId: "chat-a",
        id: "agent-a",
        profileId: "coder",
        startedAt: time,
        status: "superseded"
      },
      {
        chatSessionId: "chat-a",
        errorMessage: "Provider failed",
        id: "continued-a",
        profileId: "coder",
        startedAt: time,
        status: "failed"
      }
    ])
    await db.insert(agentEvents).values({
      createdAt: time,
      id: "superseded-event",
      payloadJson: JSON.stringify({ supersededByRunId: "continued-a" }),
      runId: "agent-a",
      sequence: 1,
      type: "run.superseded"
    })
    expect(
      await createAutomationAgentState(db).readResult(
        automationRun(),
        "agent-a"
      )
    ).toMatchObject({
      agentRunId: "continued-a",
      error: "Provider failed",
      status: "failed"
    })
  })
})

describe("automation result completeness", () => {
  it("does not report completion when a stream setup failure persisted no assistant response", async () => {
    const db = await createDb()
    await db.insert(agentRuns).values({
      chatSessionId: "chat-a",
      finishedAt: time,
      id: "agent-a",
      profileId: "coder",
      startedAt: time,
      status: "succeeded"
    })
    const result = await createAutomationAgentState(db).readResult(
      automationRun(),
      "agent-a"
    )
    expect(result.status).toBe("failed")
    expect(result.error).toContain("no persisted response")
  })
})

describe("automation notifications", () => {
  it("notifies only explicit allowed Telegram chats and opens the correct app chat", async () => {
    const settings = AppSettingsSchema.parse({
      telegram: {
        allowedChatIds: "123, -456",
        botToken: "test-only-token",
        enabled: true
      }
    })
    const openSession = vi.fn()
    let click: (() => void) | undefined
    const showDesktop = vi.fn(
      (_title: string, _body: string, handler: () => void) => {
        click = handler
      }
    )
    const telegram = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ok: true }))
    )
    await createAutomationNotifier({
      fetchTelegram: telegram,
      openSession,
      settings: () => settings,
      showDesktop
    })(task({ notifyTelegram: true }), automationRun())
    expect(showDesktop).toHaveBeenCalledTimes(1)
    expect(telegram).toHaveBeenCalledTimes(2)
    const firstPayload: unknown = JSON.parse(
      String(telegram.mock.calls[0]?.[1]?.body)
    )
    expect(firstPayload).toMatchObject({ chat_id: "123" })
    click?.()
    expect(openSession).toHaveBeenCalledWith("chat-a")
  })

  it("does not broadcast when Telegram has no allowed recipients", async () => {
    const settings = AppSettingsSchema.parse({
      telegram: { botToken: "test-only-token", enabled: true }
    })
    const telegram = vi.fn<typeof fetch>()
    await expect(
      createAutomationNotifier({
        fetchTelegram: telegram,
        openSession: vi.fn(),
        settings: () => settings,
        showDesktop: vi.fn()
      })(task({ notifyDesktop: false, notifyTelegram: true }), automationRun())
    ).rejects.toThrow("allowed chat IDs")
    expect(telegram).not.toHaveBeenCalled()
  })
})
