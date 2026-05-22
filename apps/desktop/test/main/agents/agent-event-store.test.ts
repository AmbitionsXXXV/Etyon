import fs from "node:fs"

import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  createAgentRun,
  listAgentEvents,
  listAgentToolCalls,
  recordAgentToolCall,
  updateAgentRun,
  updateAgentToolCall
} from "@/main/agents/agent-event-store"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-events-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

describe("agent event store", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("creates a run and appends ordered events", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await run.appendEvent({
      payload: {
        profileId: "general-purpose"
      },
      type: "agent_run_started"
    })
    await run.appendEvent({
      payload: {
        toolName: "readFile"
      },
      type: "tool_call_started"
    })

    const events = await listAgentEvents({
      db: getDb(),
      runId: run.id
    })

    expect(run.status).toBe("running")
    expect(events.map((event) => event.sequence)).toEqual([1, 2])
    expect(events.map((event) => event.type)).toEqual([
      "agent_run_started",
      "tool_call_started"
    ])
    expect(events[0]?.payload).toEqual({
      profileId: "general-purpose"
    })
  })

  it("records tool calls separately from model-facing events", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await recordAgentToolCall({
      approvalState: "not_required",
      db: getDb(),
      id: "tool-call-1",
      input: {
        path: "src/main.ts"
      },
      runId: run.id,
      state: "requested",
      toolName: "readFile"
    })
    await updateAgentToolCall({
      db: getDb(),
      id: "tool-call-1",
      output: {
        content: "export const value = 1"
      },
      state: "finished"
    })

    const toolCalls = await listAgentToolCalls({
      db: getDb(),
      runId: run.id
    })

    expect(toolCalls).toEqual([
      expect.objectContaining({
        approvalState: "not_required",
        id: "tool-call-1",
        input: {
          path: "src/main.ts"
        },
        output: {
          content: "export const value = 1"
        },
        state: "finished",
        toolName: "readFile"
      })
    ])
  })

  it("marks agent runs as finished", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    const updatedRun = await updateAgentRun({
      db: getDb(),
      id: run.id,
      status: "succeeded"
    })

    expect(updatedRun.finishedAt).toBeTruthy()
    expect(updatedRun.status).toBe("succeeded")
  })
})
