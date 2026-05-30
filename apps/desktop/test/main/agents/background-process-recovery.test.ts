import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { createAgentRun } from "@/main/agents/agent-event-store"
import type {
  AgentWorkspace,
  AgentWorkspaceEvent
} from "@/main/agents/agent-workspace"
import {
  createAgentBackgroundProcessStore,
  createAgentExecutionEnv
} from "@/main/agents/execution-env"
import { executeAgentTool } from "@/main/agents/tool-registry"
import type { WorkspaceSandbox } from "@/main/agents/workspace-sandbox"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-background-process-recovery-${Date.now()}-${Math.random()
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

const testProjectPath = path.join(mockedHomeDir, "project")

const createWorkspace = (events: AgentWorkspaceEvent[]): AgentWorkspace => {
  const sandbox: WorkspaceSandbox = {
    cleanup: () => Promise.resolve(),
    enabled: true,
    prepareShellCommand: (input) =>
      Promise.resolve({
        ok: true,
        value: {
          args: ["-fc", input.command],
          cleanup: () => Promise.resolve(),
          command: "/bin/zsh",
          cwd: input.cwd,
          env: input.env,
          sandboxed: true
        }
      })
  }
  const executionEnv = createAgentExecutionEnv({
    backgroundProcessStore: createAgentBackgroundProcessStore(),
    projectPath: testProjectPath,
    sandbox
  })

  return {
    eventSink: (event) => {
      events.push(event)
    },
    executionEnv,
    fileSystem: executionEnv.fileSystem,
    lsp: null,
    projectPath: executionEnv.projectPath,
    sandbox
  }
}

const getTextOutput = (output: Awaited<ReturnType<typeof executeAgentTool>>) =>
  "content" in output && Array.isArray(output.content)
    ? output.content
        .map((part) =>
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof part.text === "string"
            ? part.text
            : ""
        )
        .join("")
    : ""

describe("background process recovery", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("recovers process output from persisted run events", async () => {
    await ensureDatabaseReady()
    fs.mkdirSync(testProjectPath, { recursive: true })

    const db = getDb()
    const session = await createChatSession({
      db,
      projectPath: testProjectPath
    })
    const otherSession = await createChatSession({
      db,
      projectPath: path.join(mockedHomeDir, "other-project")
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await run.appendEvent({
      payload: {
        command: "start-dev-server",
        cwd: testProjectPath,
        pid: null,
        processId: "process-recovered",
        sandboxed: true,
        startedAt: "2026-05-30T00:00:00.000Z"
      },
      type: "background_process_started"
    })
    await run.appendEvent({
      payload: {
        channel: "stdout",
        chunk: "ready",
        processId: "process-recovered",
        sequence: 0
      },
      type: "background_process_output"
    })

    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const events: AgentWorkspaceEvent[] = []
    const workspace = createWorkspace(events)
    const output = await executeAgentTool({
      chatSessionId: session.id,
      db,
      input: {
        processId: "process-recovered"
      },
      name: "processOutput",
      projectPath: testProjectPath,
      settings,
      workspace
    })

    expect(getTextOutput(output)).toContain("ready")
    expect(getTextOutput(output)).toContain("status: exited")
    await expect(
      executeAgentTool({
        chatSessionId: otherSession.id,
        db,
        input: {
          processId: "process-recovered"
        },
        name: "processOutput",
        projectPath: testProjectPath,
        settings,
        workspace: createWorkspace([])
      })
    ).rejects.toThrow("Background process process-recovered was not found.")
  })
})
