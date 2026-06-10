import fs from "node:fs"

import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildRunProjection,
  deriveAgentRunRecords,
  expireStaleApprovals,
  getRunAssistantStartIndex,
  recordAgentRunOutcome,
  recoverInterruptedAgentRuns,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentApprovals, agentRuns } from "@/main/db/schema"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-event-store-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() }
}))

const userMessage = (text: string): unknown => ({
  id: `user-${Math.random().toString(36).slice(2)}`,
  parts: [{ text, type: "text" }],
  role: "user"
})

const assistantMessage = (parts: unknown[]): unknown => ({
  id: `assistant-${Math.random().toString(36).slice(2)}`,
  parts,
  role: "assistant"
})

const toMessages = (messages: unknown[]): UIMessage[] =>
  messages as unknown as UIMessage[]

const profileId = "file-agent"

describe("agent event store", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("derives a succeeded run from a finished tool call", () => {
    const messages = toMessages([
      userMessage("edit the file"),
      assistantMessage([
        { text: "done", type: "text" },
        {
          input: { path: "a.ts" },
          output: { ok: true },
          state: "output-available",
          toolCallId: "tc1",
          type: "tool-edit"
        }
      ])
    ])

    const derived = deriveAgentRunRecords({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      messages
    })

    expect(derived.runStatus).toBe("succeeded")
    expect(derived.toolCalls).toHaveLength(1)
    expect(derived.toolCalls[0]?.state).toBe("finished")
    expect(derived.toolCalls[0]?.toolName).toBe("edit")
    expect(derived.approvedToolCallIds).toEqual(["tc1"])
  })

  it("derives a suspended run with a pending approval", () => {
    const messages = toMessages([
      userMessage("write a file"),
      assistantMessage([
        {
          approval: { id: "ap1" },
          input: { path: "b.ts" },
          state: "approval-requested",
          toolCallId: "tc2",
          type: "tool-write"
        }
      ])
    ])

    const derived = deriveAgentRunRecords({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      messages
    })

    expect(derived.runStatus).toBe("suspended")
    expect(derived.pendingApprovals).toEqual([
      { approvalId: "ap1", toolCallId: "tc2" }
    ])
  })

  it("records and projects a run from the event log", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("edit"),
      assistantMessage([
        {
          input: {},
          output: {},
          state: "output-available",
          toolCallId: "tc1",
          type: "tool-edit"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
    const projection = await buildRunProjection({ db, runId })

    expect(run?.status).toBe("succeeded")
    expect(projection?.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.result",
      "run.succeeded"
    ])
  })

  it("persists a pending approval for a suspended run", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-suspend" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-suspend",
          type: "tool-write"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
    const approvals = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.runId, runId))

    expect(run?.status).toBe("suspended")
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.state).toBe("pending")
  })

  it("resolves a prior pending approval when the tool later completes", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })

    const suspendRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const suspendMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "apX" },
          input: {},
          state: "approval-requested",
          toolCallId: "tcX",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(suspendMessages),
      db,
      messages: suspendMessages,
      runId: suspendRunId
    })

    const resumeRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const resumeMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          input: {},
          output: { ok: true },
          state: "output-available",
          toolCallId: "tcX",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(resumeMessages),
      db,
      messages: resumeMessages,
      runId: resumeRunId
    })

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.toolCallId, "tcX"))

    expect(approval?.state).toBe("approved")
    expect(approval?.respondedAt).toBeTruthy()
  })

  it("recovers interrupted runs on startup", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })

    const recovered = await recoverInterruptedAgentRuns({ db })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))

    expect(recovered).toBeGreaterThanOrEqual(1)
    expect(run?.status).toBe("failed")
    expect(run?.errorMessage).toBe("Interrupted by app restart")
  })

  it("expires stale pending approvals and fails their suspended runs", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-stale" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-stale",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const expired = await expireStaleApprovals({
      db,
      now: new Date(Date.now() + 60_000).toISOString(),
      ttlMs: 0
    })

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.runId, runId))
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))

    expect(expired).toBeGreaterThanOrEqual(1)
    expect(approval?.state).toBe("denied")
    expect(run?.status).toBe("failed")
  })
})
