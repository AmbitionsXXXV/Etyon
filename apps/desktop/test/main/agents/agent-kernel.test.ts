import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  listAgentEvents,
  updateAgentRun
} from "@/main/agents/agent-event-store"
import { createAgentKernel } from "@/main/agents/agent-kernel"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-kernel-test-${Date.now()}-${Math.random()
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

const createTestKernel = (agents: Record<string, unknown> = {}) =>
  createAgentKernel({
    settings: AppSettingsSchema.parse({
      agents: {
        ...agents,
        enabled: true
      }
    }).agents
  })

describe("agent kernel", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("lists built-in run graph templates through the kernel", () => {
    const kernel = createTestKernel()

    expect(
      kernel.listRunGraphTemplates().map((template) => template.id)
    ).toEqual([
      "solo-coder",
      "plan-execute-review",
      "investigation",
      "harness-debug"
    ])
  })

  it("compiles plan-execute-review into schedulable stages", () => {
    const kernel = createTestKernel()
    const plan = kernel.previewRunGraphTemplate("plan-execute-review")

    expect(plan.stages).toEqual([
      {
        id: "stage-1",
        index: 0,
        nodeIds: ["plan"],
        parallel: false
      },
      {
        id: "stage-2",
        index: 1,
        nodeIds: ["explore-code", "explore-tests"],
        parallel: true
      },
      {
        id: "stage-3",
        index: 2,
        nodeIds: ["coder"],
        parallel: false
      },
      {
        id: "stage-4",
        index: 3,
        nodeIds: ["review"],
        parallel: false
      },
      {
        id: "stage-5",
        index: 4,
        nodeIds: ["final"],
        parallel: false
      }
    ])
    expect(plan.nodes).toEqual([
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls"],
        id: "plan",
        stage: 0,
        status: "pending",
        toolScope: "read-only"
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls"],
        id: "explore-code",
        parallelGroup: "explore",
        stage: 1
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls"],
        id: "explore-tests",
        parallelGroup: "explore",
        stage: 1
      }),
      expect.objectContaining({
        activeToolNames: [
          "read",
          "grep",
          "find",
          "ls",
          "bash",
          "edit",
          "write",
          "agentExplore",
          "agentPlan",
          "agentReview"
        ],
        id: "coder",
        stage: 2,
        toolScope: "approval-gated"
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls"],
        id: "review",
        stage: 3
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls"],
        id: "final",
        stage: 4
      })
    ])
  })

  it("rejects unknown run graph templates", () => {
    const kernel = createTestKernel()

    expect(() => kernel.previewRunGraphTemplate("unknown")).toThrow(
      "Unknown agent graph template: unknown"
    )
  })

  it("honors retry settings when automatic graph retries are disabled", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel({
      retry: {
        maxAutomaticRetries: 0
      }
    })
    const session = await createChatSession({
      db
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db,
      templateId: "investigation"
    })
    const firstStage = await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })
    const planChildRunId = firstStage.startedRuns[0]?.id

    if (!planChildRunId) {
      throw new Error("Expected graph plan child run to start.")
    }

    await updateAgentRun({
      db,
      errorMessage: "provider timeout while generating plan",
      id: planChildRunId,
      status: "failed"
    })

    const advanced = await kernel.advanceRunGraph({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })
    const retryEvents = await listAgentEvents({
      db,
      runId: instance.rootRun.id
    })

    expect(advanced).toMatchObject({
      settledNodeIds: ["plan"],
      stage: null,
      startedNodeIds: [],
      startedRuns: []
    })
    expect(
      advanced.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      attempt: 1,
      errorMessage: "provider timeout while generating plan",
      status: "failed"
    })
    expect(
      retryEvents.some(
        (event) => event.type === "agent_run_graph_node_retrying"
      )
    ).toBe(false)
  })
})
