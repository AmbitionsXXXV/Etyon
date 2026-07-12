import fs from "node:fs"

import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { listAgentEditedPathsBySession } from "@/main/agents/agent-edited-paths"
import {
  recordDelegatedRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-edited-paths-test-${Date.now()}-${Math.random()
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

const profileId = "file-agent"

describe("agent edited paths", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("collects unique finished edit/write paths across runs in each session", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const otherSession = await createChatSession({ db })
    const firstRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })

    await recordDelegatedRunOutcome({
      db,
      runId: firstRunId,
      status: "succeeded",
      toolCalls: [
        {
          input: { path: "src/new-name.ts" },
          output: { path: "src/new-name.ts" },
          toolCallId: "rename-target",
          toolName: "edit"
        },
        {
          input: { path: "src/new-name.ts" },
          output: { path: "src/new-name.ts" },
          toolCallId: "duplicate-edit",
          toolName: "edit"
        },
        {
          input: {},
          output: { path: "src/output-only.ts" },
          toolCallId: "output-fallback",
          toolName: "write"
        },
        {
          input: { path: "src/read-only.ts" },
          output: { path: "src/read-only.ts" },
          toolCallId: "read-only",
          toolName: "read"
        }
      ]
    })

    const secondRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })

    await recordDelegatedRunOutcome({
      db,
      runId: secondRunId,
      status: "succeeded",
      toolCalls: [
        {
          input: { path: "docs/guide.md" },
          output: { path: "docs/guide.md" },
          toolCallId: "second-run-write",
          toolName: "write"
        }
      ]
    })

    const otherRunId = await startAgentRun({
      chatSessionId: otherSession.id,
      db,
      modelId: null,
      profileId
    })

    await recordDelegatedRunOutcome({
      db,
      runId: otherRunId,
      status: "succeeded",
      toolCalls: [
        {
          input: { path: "other-session.ts" },
          output: { path: "other-session.ts" },
          toolCallId: "other-session-write",
          toolName: "write"
        }
      ]
    })

    const pathsBySession = await listAgentEditedPathsBySession({
      db,
      sessionIds: [session.id, otherSession.id]
    })

    expect(pathsBySession.get(session.id)).toEqual([
      "docs/guide.md",
      "src/new-name.ts",
      "src/output-only.ts"
    ])
    expect(pathsBySession.get(otherSession.id)).toEqual(["other-session.ts"])
  })
})
