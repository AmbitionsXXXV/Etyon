import fs from "node:fs"

import { RespondToChildApprovalInputSchema } from "@etyon/rpc"
import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildChildApprovalId,
  recordChildApprovalRequest,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { registerApproval } from "@/main/agents/approval-broker"
import { respondToChildApproval } from "@/main/agents/child-approval"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentApprovals } from "@/main/db/schema"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-child-approval-test-${Date.now()}-${Math.random()
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

const seedPendingApproval = async ({
  command,
  toolCallId,
  toolName
}: {
  command?: string
  toolCallId: string
  toolName: string
}) => {
  await ensureDatabaseReady()
  const db = getDb()
  const session = await createChatSession({ db })
  const parentRunId = await startAgentRun({
    chatSessionId: session.id,
    db,
    modelId: null,
    profileId: "general-purpose"
  })
  const childRunId = await startAgentRun({
    chatSessionId: session.id,
    db,
    modelId: null,
    parentRunId,
    profileId: "coder"
  })
  const approvalId = await recordChildApprovalRequest({
    db,
    input: command === undefined ? { path: "src/a.ts" } : { command },
    runId: childRunId,
    toolCallId,
    toolName
  })
  // Register the broker waiter the responder resolves; hold the promise so it is
  // awaited (it settles, never rejects).
  const pending = registerApproval({ approvalId })

  return { approvalId, childRunId, db, pending, session }
}

describe("respondToChildApproval", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("settles the durable approval and unblocks the child on approve", async () => {
    const { approvalId, db, pending } = await seedPendingApproval({
      command: "vp test",
      toolCallId: "tc-approve",
      toolName: "bash"
    })

    const result = await respondToChildApproval({
      approved: true,
      approvalId,
      db,
      rememberCommand: false
    })

    expect(result.ok).toBe(true)
    expect(await pending).toEqual({ approved: true, reason: "responded" })

    const [row] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, approvalId))
      .limit(1)

    expect(row?.state).toBe("approved")
    expect(row?.respondedAt).not.toBeNull()
  })

  it("returns ok:false when the approval id is unknown", async () => {
    const { db } = await seedPendingApproval({
      command: "vp test",
      toolCallId: "tc-unknown",
      toolName: "bash"
    })

    const result = await respondToChildApproval({
      approved: true,
      approvalId: buildChildApprovalId("no-such-run", "no-such-tc"),
      db,
      rememberCommand: true
    })

    expect(result).toEqual({ ok: false })
  })

  it("remembers a safe bash command but refuses a destructive one", async () => {
    const safe = await seedPendingApproval({
      command: "vp test",
      toolCallId: "tc-safe",
      toolName: "bash"
    })
    const safeResult = await respondToChildApproval({
      approved: true,
      approvalId: safe.approvalId,
      db: safe.db,
      rememberCommand: true
    })
    await safe.pending

    expect(safeResult.rememberableCommand).toEqual({
      command: "vp test",
      projectPath: safe.session.projectPath
    })

    const danger = await seedPendingApproval({
      command: "rm -rf build",
      toolCallId: "tc-danger",
      toolName: "bash"
    })
    const dangerResult = await respondToChildApproval({
      approved: true,
      approvalId: danger.approvalId,
      db: danger.db,
      rememberCommand: true
    })
    await danger.pending

    // Server-side guard: a destructive command is never rememberable, even when
    // the client asks for it.
    expect(dangerResult.ok).toBe(true)
    expect(dangerResult.rememberableCommand).toBeUndefined()
  })

  it("remembers the derived CLI+subcommand pattern, not the full command", async () => {
    const remembered = await seedPendingApproval({
      command: "vp test run apps/desktop",
      toolCallId: "tc-pattern",
      toolName: "bash"
    })
    const result = await respondToChildApproval({
      approved: true,
      approvalId: remembered.approvalId,
      db: remembered.db,
      rememberCommand: true
    })
    await remembered.pending

    expect(result.rememberableCommand).toEqual({
      command: "vp test",
      projectPath: remembered.session.projectPath
    })
  })

  it("does not offer a remember for a file edit", async () => {
    const { approvalId, db, pending } = await seedPendingApproval({
      toolCallId: "tc-edit",
      toolName: "edit"
    })

    const result = await respondToChildApproval({
      approved: true,
      approvalId,
      db,
      rememberCommand: true
    })
    await pending

    expect(result.ok).toBe(true)
    expect(result.rememberableCommand).toBeUndefined()
  })
})

describe("RespondToChildApprovalInputSchema", () => {
  it("accepts a well-formed decision", () => {
    expect(
      RespondToChildApprovalInputSchema.parse({
        approvalId: "run:tc",
        approved: true,
        rememberCommand: true
      })
    ).toEqual({ approvalId: "run:tc", approved: true, rememberCommand: true })
  })

  it("rejects an empty approval id and a missing verdict", () => {
    expect(
      RespondToChildApprovalInputSchema.safeParse({
        approvalId: "",
        approved: true
      }).success
    ).toBe(false)
    expect(
      RespondToChildApprovalInputSchema.safeParse({ approvalId: "run:tc" })
        .success
    ).toBe(false)
  })
})
