import fs from "node:fs"

import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  getRunAssistantStartIndex,
  recordAgentRunOutcome,
  recoverInterruptedAgentRuns,
  startAgentRun
} from "@/main/agents/agent-event-store"
import {
  inspectAgentRun,
  listAgentRuns,
  listPendingAgentApprovals
} from "@/main/agents/agent-run-inspection"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-run-inspection-test-${Date.now()}-${Math.random()
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

const recordFinishedToolRun = async (
  db: ReturnType<typeof getDb>,
  runId: string
): Promise<void> => {
  const messages = toMessages([
    userMessage("read the file"),
    assistantMessage([
      {
        input: { path: "a.ts" },
        output: { ok: true },
        state: "output-available",
        toolCallId: "tc-read",
        type: "tool-read"
      }
    ])
  ])

  await recordAgentRunOutcome({
    assistantStartIndex: getRunAssistantStartIndex(messages),
    db,
    messages,
    runId
  })
}

describe("agent run inspection", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("reopens a run with ordered events, tool calls, and empty artifacts", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-test",
      profileId: "general-purpose"
    })
    await recordFinishedToolRun(db, runId)

    const inspected = await inspectAgentRun({ db, runId })

    expect(inspected?.run.id).toBe(runId)
    expect(inspected?.run.profileId).toBe("general-purpose")
    expect(inspected?.artifacts).toEqual([])
    expect(inspected?.toolCalls).toHaveLength(1)
    expect(inspected?.toolCalls[0]?.toolName).toBe("read")
    expect(inspected?.toolCalls[0]?.input).toEqual({ path: "a.ts" })

    const sequences = inspected?.events.map((event) => event.sequence) ?? []

    expect(sequences).toEqual([...sequences].toSorted((a, b) => a - b))
    expect(inspected?.events[0]?.type).toBe("run.started")
  })

  it("returns null for an unknown run", async () => {
    await ensureDatabaseReady()
    const db = getDb()

    expect(await inspectAgentRun({ db, runId: "does-not-exist" })).toBeNull()
  })

  it("lists runs newest first and scoped to a session", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const olderRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId: "general-purpose"
    })
    const newerRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId: "coder"
    })

    const { runs } = await listAgentRuns({ db, sessionId: session.id })
    const ids = runs.map((run) => run.id)

    expect(ids).toContain(olderRunId)
    expect(ids).toContain(newerRunId)
    expect(runs.every((run) => run.chatSessionId === session.id)).toBe(true)
  })

  it("surfaces pending approvals that survive a simulated restart", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId: "coder"
    })
    const messages = toMessages([
      userMessage("write a file"),
      assistantMessage([
        {
          approval: { id: "ap-1" },
          input: { content: "x", path: "b.ts" },
          state: "approval-requested",
          toolCallId: "tc-write",
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

    // Startup recovery must leave the suspended run (and its approval) intact.
    await recoverInterruptedAgentRuns({ db })

    const { approvals } = await listPendingAgentApprovals({
      db,
      sessionId: session.id
    })
    const pending = approvals.find((approval) => approval.runId === runId)

    expect(pending?.toolName).toBe("write")
    expect(pending?.runStatus).toBe("suspended")
    expect(pending?.input).toEqual({ content: "x", path: "b.ts" })
  })
})
