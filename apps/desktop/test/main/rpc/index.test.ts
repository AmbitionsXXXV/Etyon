import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/message-port"
import type { RouterClient } from "@orpc/server"
import { RPCHandler } from "@orpc/server/message-port"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  appendAgentEvent,
  createAgentRun,
  listAgentEvents,
  listPendingAgentApprovals,
  listAgentToolCalls,
  recordAgentArtifact,
  recordAgentToolCall,
  updateAgentRun
} from "@/main/agents/agent-event-store"
import { createAgentKernel } from "@/main/agents/agent-kernel"
import type { AgentLoopModel } from "@/main/agents/agent-loop"
import {
  appendAgentSessionModelMessageEvents,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { createMessagePortRpcContext } from "@/main/rpc/context"
import type { AppRouter } from "@/main/rpc/router"
import { router } from "@/main/rpc/router"
import { updateSettings } from "@/main/settings"

import {
  createFauxGenerateTextResponse,
  createFauxGenerateToolCallResponse,
  createFauxProvider
} from "../agents/faux-provider"

const { mockedAppPath, mockedHomeDir, mockedResolveModel } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-rpc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  mockedResolveModel: vi.fn()
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

vi.mock("electron-store", () => {
  class MockElectronStore {
    readonly store = new Map<string, unknown>()

    get(key: string): unknown {
      return this.store.get(key)
    }

    set(key: string, value: unknown): void {
      this.store.set(key, value)
    }
  }

  return {
    default: MockElectronStore
  }
})

vi.mock("electron", () => {
  const electronMock = {
    BrowserWindow: {
      getAllWindows: () => []
    },
    app: {
      getAppPath: () => mockedAppPath,
      getLocale: () => "en-US",
      getName: () => "Etyon Test",
      getPath: () => mockedHomeDir,
      getVersion: () => "0.1.0-test",
      name: "Etyon Test"
    },
    ipcMain: {
      on: vi.fn()
    }
  }

  return {
    ...electronMock,
    default: electronMock
  }
})

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: mockedResolveModel
}))

describe("message-port rpc", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("keeps ping working over the message-port adapter", async () => {
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.ping({ message: "hello" })

    expect(result.echo).toBe("hello")
    expect(typeof result.pid).toBe("number")
    expect(result.timestamp).toBeTruthy()

    port1.close()
    port2.close()
  })

  it("keeps settings.get working over the message-port adapter", async () => {
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.settings.get()

    expect(result.autoStart).toBe(false)
    expect(result.locale).toBe("system")

    port1.close()
    port2.close()
  })

  it("exposes memory stats and entries over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const stats = await client.memory.stats()
    const entries = await client.memory.list({
      limit: 5
    })

    expect(stats.totalEntries).toBeGreaterThanOrEqual(0)
    expect(entries.entries).toEqual(expect.any(Array))

    port1.close()
    port2.close()
  })

  it("exposes parsed skills over the message-port adapter", async () => {
    const projectPath = path.join(mockedHomeDir, "skills-project")
    const skillDir = path.join(projectPath, ".agents", "skills", "rpc-skill")

    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: rpc-skill",
        "description: Use when testing RPC skill parsing.",
        "---",
        "",
        "Use RPC skill instructions."
      ].join("\n")
    )

    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    await client.chatSessions.create({
      projectPath
    })

    const result = await client.skills.list()

    expect(result.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "rpc-skill",
          projectPath,
          scope: "project"
        })
      ])
    )

    await client.projects.remove({
      projectPath
    })

    port1.close()
    port2.close()
  })

  it("exposes skill prompt templates over the message-port adapter", async () => {
    const projectPath = path.join(mockedHomeDir, "prompt-template-project")
    const promptDir = path.join(
      projectPath,
      ".agents",
      "skills",
      "rpc-template-skill",
      "prompts"
    )

    fs.mkdirSync(promptDir, { recursive: true })
    fs.writeFileSync(
      path.join(path.dirname(promptDir), "SKILL.md"),
      [
        "---",
        "name: rpc-template-skill",
        "description: Use when testing RPC prompt templates.",
        "---",
        "",
        "Use RPC prompt template instructions."
      ].join("\n")
    )
    fs.writeFileSync(
      path.join(promptDir, "review.md"),
      [
        "---",
        "name: review",
        "description: Review selected context",
        "---",
        "Review $1."
      ].join("\n")
    )

    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    await client.chatSessions.create({
      projectPath
    })

    const result = await client.skills.listPromptTemplates()

    expect(result.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: "Review $1.",
          description: "Review selected context",
          name: "review",
          path: path.join(promptDir, "review.md")
        })
      ])
    )

    await client.projects.remove({
      projectPath
    })

    port1.close()
    port2.close()
  })

  it("exposes pending agent approvals over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon")
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "rpc-tool-approval-1",
      input: {
        command: "vp install"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "runCheck"
    })
    await appendAgentEvent({
      db: getDb(),
      payload: {
        approvalId: "approval-1",
        toolCallId: "rpc-tool-approval-1"
      },
      runId: run.id,
      type: "tool_call_approval_requested"
    })
    await updateAgentRun({
      db: getDb(),
      id: run.id,
      status: "suspended"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.listPendingApprovals({
      sessionId: session.id
    })

    expect(result.approvals).toEqual([
      expect.objectContaining({
        approvalId: "approval-1",
        chatSessionId: session.id,
        id: "rpc-tool-approval-1",
        input: {
          command: "vp install"
        },
        runId: run.id,
        runStatus: "suspended",
        state: "approval_requested",
        toolName: "runCheck"
      })
    ])

    port1.close()
    port2.close()
  })

  it("exposes recoverable agent runs over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-recoverable")
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await updateAgentRun({
      db: getDb(),
      errorMessage: "Agent run was interrupted before finishing.",
      id: run.id,
      status: "failed"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.listRecoverableRuns({
      sessionId: session.id
    })

    expect(result.runs).toEqual([
      expect.objectContaining({
        chatSessionId: session.id,
        errorMessage: "Agent run was interrupted before finishing.",
        id: run.id,
        parentRunId: null,
        status: "failed"
      })
    ])

    port1.close()
    port2.close()
  })

  it("lists agent runs for a chat session workbench", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-workbench")
    })
    const otherSession = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-workbench-other")
    })
    const rootRun = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })
    const childRun = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      parentRunId: rootRun.id,
      profileId: "review"
    })
    const otherRun = await createAgentRun({
      chatSessionId: otherSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.listRuns({
      limit: 10,
      sessionId: session.id
    })
    const runIds = result.runs.map((run) => run.id)

    expect(runIds).toContain(rootRun.id)
    expect(runIds).toContain(childRun.id)
    expect(runIds).not.toContain(otherRun.id)
    expect(result.runs).toContainEqual(
      expect.objectContaining({
        chatSessionId: session.id,
        id: childRun.id,
        parentRunId: rootRun.id,
        profileId: "review"
      })
    )

    port1.close()
    port2.close()
  })

  it("lists agent UI stream snapshots by cursor over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-stream-cursor")
    })
    const otherSession = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-stream-cursor-other"
      )
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await appendAgentEvent({
      db: getDb(),
      payload: {
        profileId: "coder"
      },
      runId: run.id,
      type: "agent_run_started"
    })
    const firstSnapshot = await appendAgentEvent({
      db: getDb(),
      payload: {
        parts: [
          {
            text: "first partial",
            type: "text"
          }
        ]
      },
      runId: run.id,
      type: "agent_ui_stream_snapshot_created"
    })
    await appendAgentEvent({
      db: getDb(),
      payload: {
        step: 1
      },
      runId: run.id,
      type: "agent_step_finished"
    })
    const secondSnapshot = await appendAgentEvent({
      db: getDb(),
      payload: {
        parts: [
          {
            text: "second partial",
            type: "text"
          }
        ]
      },
      runId: run.id,
      type: "agent_ui_stream_snapshot_created"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const fullResult = await client.agents.listUiStreamSnapshots({
      sessionId: session.id
    })
    const cursorResult = await client.agents.listUiStreamSnapshots({
      afterSequence: firstSnapshot.sequence,
      runId: run.id,
      sessionId: session.id
    })
    const emptyResult = await client.agents.listUiStreamSnapshots({
      afterSequence: secondSnapshot.sequence,
      runId: run.id,
      sessionId: session.id
    })

    expect(fullResult).toEqual({
      nextSequence: secondSnapshot.sequence,
      run: expect.objectContaining({
        chatSessionId: session.id,
        id: run.id,
        status: "running"
      }),
      snapshots: [
        {
          createdAt: firstSnapshot.createdAt,
          eventId: firstSnapshot.id,
          parts: [
            {
              text: "first partial",
              type: "text"
            }
          ],
          runId: run.id,
          sequence: firstSnapshot.sequence
        },
        {
          createdAt: secondSnapshot.createdAt,
          eventId: secondSnapshot.id,
          parts: [
            {
              text: "second partial",
              type: "text"
            }
          ],
          runId: run.id,
          sequence: secondSnapshot.sequence
        }
      ]
    })
    expect(cursorResult).toEqual({
      nextSequence: secondSnapshot.sequence,
      run: expect.objectContaining({
        chatSessionId: session.id,
        id: run.id,
        status: "running"
      }),
      snapshots: [
        {
          createdAt: secondSnapshot.createdAt,
          eventId: secondSnapshot.id,
          parts: [
            {
              text: "second partial",
              type: "text"
            }
          ],
          runId: run.id,
          sequence: secondSnapshot.sequence
        }
      ]
    })
    expect(emptyResult).toEqual({
      nextSequence: secondSnapshot.sequence,
      run: expect.objectContaining({
        chatSessionId: session.id,
        id: run.id,
        status: "running"
      }),
      snapshots: []
    })
    await expect(
      client.agents.listUiStreamSnapshots({
        runId: run.id,
        sessionId: otherSession.id
      })
    ).rejects.toThrow()

    port1.close()
    port2.close()
  })

  it("exposes agent run graph template previews over the message-port adapter", async () => {
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const templates = await client.agents.listRunGraphTemplates()
    const preview = await client.agents.previewRunGraphTemplate({
      templateId: "plan-execute-review"
    })

    expect(templates.templates.map((template) => template.id)).toEqual([
      "solo-coder",
      "plan-execute-review",
      "investigation",
      "harness-debug"
    ])
    expect(preview.plan.stages).toEqual([
      expect.objectContaining({
        nodeIds: ["plan"],
        parallel: false
      }),
      expect.objectContaining({
        nodeIds: ["explore-code", "explore-tests"],
        parallel: true
      }),
      expect.objectContaining({
        nodeIds: ["coder"],
        parallel: false
      }),
      expect.objectContaining({
        nodeIds: ["review"],
        parallel: false
      }),
      expect.objectContaining({
        nodeIds: ["final"],
        parallel: false
      })
    ])
    expect(
      preview.plan.nodes.find((node) => node.id === "coder")
    ).toMatchObject({
      activeToolNames: expect.arrayContaining([
        "read",
        "bash",
        "edit",
        "write"
      ]),
      status: "pending",
      toolScope: "approval-gated"
    })

    port1.close()
    port2.close()
  })

  it("instantiates agent run graph templates over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-run-graph")
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.instantiateRunGraphTemplate({
      modelId: "openai/gpt-4.1",
      sessionId: session.id,
      templateId: "investigation"
    })
    const events = await listAgentEvents({
      db: getDb(),
      runId: result.run.id
    })

    expect(result.run).toMatchObject({
      chatSessionId: session.id,
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "general-purpose",
      status: "running"
    })
    expect(result.plan).toMatchObject({
      id: "investigation",
      stages: [
        expect.objectContaining({
          nodeIds: ["plan"],
          parallel: false
        }),
        expect.objectContaining({
          nodeIds: ["explore"],
          parallel: false
        }),
        expect.objectContaining({
          nodeIds: ["synthesize"],
          parallel: false
        })
      ]
    })
    expect(events).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          planId: "investigation",
          profileId: "general-purpose",
          source: "run-graph",
          templateId: "investigation"
        }),
        runId: result.run.id,
        sequence: 1,
        type: "agent_run_started"
      }),
      expect.objectContaining({
        payload: {
          plan: result.plan,
          templateId: "investigation"
        },
        runId: result.run.id,
        sequence: 2,
        type: "agent_run_graph_instantiated"
      })
    ])

    port1.close()
    port2.close()
  })

  it("starts ready agent run graph stages over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-run-graph-start")
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      sessionId: session.id,
      templateId: "plan-execute-review"
    })
    const firstStage = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })
    const secondAttempt = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(firstStage.stage).toMatchObject({
      nodeIds: ["plan"],
      parallel: false
    })
    expect(firstStage.startedNodeIds).toEqual(["plan"])
    expect(firstStage.startedRuns).toEqual([
      expect.objectContaining({
        parentRunId: instance.run.id,
        profileId: "plan",
        status: "running"
      })
    ])
    expect(
      firstStage.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      childRunId: firstStage.startedRuns[0]?.id,
      status: "running"
    })
    expect(secondAttempt).toMatchObject({
      stage: null,
      startedNodeIds: [],
      startedRuns: []
    })

    await appendAgentEvent({
      db: getDb(),
      payload: {
        nodeId: "plan"
      },
      runId: instance.run.id,
      type: "agent_run_graph_node_succeeded"
    })

    const exploreStage = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(exploreStage.stage).toMatchObject({
      nodeIds: ["explore-code", "explore-tests"],
      parallel: true
    })
    expect(exploreStage.startedNodeIds).toEqual([
      "explore-code",
      "explore-tests"
    ])
    expect(exploreStage.startedRuns).toEqual([
      expect.objectContaining({
        parentRunId: instance.run.id,
        profileId: "explore",
        status: "running"
      }),
      expect.objectContaining({
        parentRunId: instance.run.id,
        profileId: "explore",
        status: "running"
      })
    ])

    port1.close()
    port2.close()
  })

  it("advances agent run graphs from finished child runs", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-run-graph-advance"
      )
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      sessionId: session.id,
      templateId: "plan-execute-review"
    })
    const firstStage = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })
    const planChildRunId = firstStage.startedRuns[0]?.id

    if (!planChildRunId) {
      throw new Error("Expected graph plan child run to start.")
    }

    await updateAgentRun({
      db: getDb(),
      id: planChildRunId,
      status: "succeeded"
    })

    const advanced = await client.agents.advanceRunGraph({
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(advanced.settledNodeIds).toEqual(["plan"])
    expect(
      advanced.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      childRunId: planChildRunId,
      status: "succeeded"
    })
    expect(advanced.stage).toMatchObject({
      nodeIds: ["explore-code", "explore-tests"],
      parallel: true
    })
    expect(advanced.startedNodeIds).toEqual(["explore-code", "explore-tests"])
    expect(advanced.startedRuns).toEqual([
      expect.objectContaining({
        parentRunId: instance.run.id,
        profileId: "explore",
        status: "running"
      }),
      expect.objectContaining({
        parentRunId: instance.run.id,
        profileId: "explore",
        status: "running"
      })
    ])

    const secondAdvance = await client.agents.advanceRunGraph({
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(secondAdvance).toMatchObject({
      settledNodeIds: [],
      stage: null,
      startedNodeIds: [],
      startedRuns: []
    })

    port1.close()
    port2.close()
  })

  it("executes a running agent graph node with the self-managed loop", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-run-graph-execute"
      )
    })
    const kernel = createAgentKernel({
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      }).agents
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db: getDb(),
      task: "Find the files related to provider settings.",
      templateId: "plan-execute-review"
    })
    const firstStage = await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db: getDb(),
      rootRunId: instance.rootRun.id
    })
    const modelMessages: string[] = []
    const model: AgentLoopModel = ({ availableToolNames, messages }) => {
      const [firstMessage] = messages

      modelMessages.push(
        firstMessage?.role === "user" || firstMessage?.role === "system"
          ? firstMessage.content
          : ""
      )

      return {
        content: `Plan references provider settings with ${availableToolNames.length} executable tools.`,
        toolCalls: []
      }
    }

    expect(firstStage.startedNodeIds).toEqual(["plan"])

    const executed = await kernel.executeRunGraphNode({
      chatSessionId: session.id,
      db: getDb(),
      model,
      rootRunId: instance.rootRun.id
    })
    const events = await listAgentEvents({
      db: getDb(),
      runId: instance.rootRun.id
    })

    expect(modelMessages[0]).toContain(
      "Find the files related to provider settings."
    )
    expect(modelMessages[0]).toContain("Output contract:")
    expect(executed).toMatchObject({
      nodeId: "plan",
      settledNodeIds: ["plan"],
      stopReason: "final",
      turns: 1
    })
    expect(executed.childRun).toMatchObject({
      id: firstStage.startedRuns[0]?.id,
      parentRunId: instance.rootRun.id,
      status: "succeeded"
    })
    expect(
      executed.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      childRunId: firstStage.startedRuns[0]?.id,
      status: "succeeded"
    })
    expect(executed.startedNodeIds).toEqual(["explore-code", "explore-tests"])
    expect(events.map((event) => event.type)).toContain(
      "agent_run_graph_node_succeeded"
    )

    const explorePrompts: string[] = []
    const exploreModel: AgentLoopModel = ({ messages }) => {
      const [firstMessage] = messages

      explorePrompts.push(
        firstMessage?.role === "user" || firstMessage?.role === "system"
          ? firstMessage.content
          : ""
      )

      return {
        content: "Explored provider settings references.",
        toolCalls: []
      }
    }

    await kernel.executeRunGraphNode({
      chatSessionId: session.id,
      db: getDb(),
      model: exploreModel,
      nodeId: "explore-code",
      rootRunId: instance.rootRun.id
    })

    expect(explorePrompts[0]).toContain("Dependency outputs:")
    expect(explorePrompts[0]).toContain("Dependency plan output:")
    expect(explorePrompts[0]).toContain("Plan references provider settings")
  })

  it("retries failed agent graph nodes over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-run-graph-retry")
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      sessionId: session.id,
      templateId: "investigation"
    })
    const firstStage = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })
    const planChildRunId = firstStage.startedRuns[0]?.id

    if (!planChildRunId) {
      throw new Error("Expected graph plan child run to start.")
    }

    await updateAgentRun({
      db: getDb(),
      errorMessage: "non-retryable assertion mismatch",
      id: planChildRunId,
      status: "failed"
    })

    const advanced = await client.agents.advanceRunGraph({
      runId: instance.run.id,
      sessionId: session.id
    })
    const retried = await client.agents.retryRunGraphNode({
      nodeId: "plan",
      runId: instance.run.id,
      sessionId: session.id
    })
    const retryEvents = await listAgentEvents({
      db: getDb(),
      runId: instance.run.id
    })

    expect(
      advanced.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      attempt: 1,
      errorMessage: "non-retryable assertion mismatch",
      status: "failed"
    })
    expect(retried).toMatchObject({
      retriedNodeId: "plan",
      startedNodeIds: ["plan"]
    })
    expect(retried.plan.nodes.find((node) => node.id === "plan")).toMatchObject(
      {
        attempt: 2,
        errorMessage: "non-retryable assertion mismatch",
        status: "running"
      }
    )
    expect(retried.startedRuns[0]?.id).not.toBe(planChildRunId)
    expect(retryEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_run_graph_checkpoint_created",
        "agent_run_graph_node_retrying"
      ])
    )

    port1.close()
    port2.close()
  })

  it("skips failed agent graph nodes over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-run-graph-skip")
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      sessionId: session.id,
      templateId: "investigation"
    })
    const firstStage = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })
    const planChildRunId = firstStage.startedRuns[0]?.id

    if (!planChildRunId) {
      throw new Error("Expected graph plan child run to start.")
    }

    await updateAgentRun({
      db: getDb(),
      errorMessage: "non-retryable assertion mismatch",
      id: planChildRunId,
      status: "failed"
    })

    await client.agents.advanceRunGraph({
      runId: instance.run.id,
      sessionId: session.id
    })

    const skipped = await client.agents.skipRunGraphNode({
      nodeId: "plan",
      reason: "Continue with available context.",
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(skipped).toMatchObject({
      skippedNodeId: "plan",
      startedNodeIds: ["explore"]
    })
    expect(skipped.plan.nodes.find((node) => node.id === "plan")).toMatchObject(
      {
        errorMessage: "non-retryable assertion mismatch",
        status: "skipped"
      }
    )
    expect(
      skipped.plan.nodes.find((node) => node.id === "explore")
    ).toMatchObject({
      status: "running"
    })

    port1.close()
    port2.close()
  })

  it("updates agent graph retry policy over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-run-graph-policy")
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      sessionId: session.id,
      templateId: "investigation"
    })
    const policyUpdate = await client.agents.updateRunGraphRetryPolicy({
      retryPolicy: {
        maxAutomaticRetries: 0,
        retryTransientFailures: false
      },
      runId: instance.run.id,
      sessionId: session.id
    })
    const events = await listAgentEvents({
      db: getDb(),
      runId: instance.run.id
    })

    expect(policyUpdate).toMatchObject({
      retryPolicy: {
        maxAutomaticRetries: 0,
        retryTransientFailures: false
      },
      run: {
        id: instance.run.id
      }
    })
    expect(policyUpdate.plan.retryPolicy).toEqual(policyUpdate.retryPolicy)
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_run_graph_checkpoint_created",
        "agent_run_graph_retry_policy_updated"
      ])
    )

    port1.close()
    port2.close()
  })

  it("automatically retries transient failed agent graph nodes once", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-run-graph-auto-retry"
      )
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      sessionId: session.id,
      templateId: "investigation"
    })
    const firstStage = await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })
    const planChildRunId = firstStage.startedRuns[0]?.id

    if (!planChildRunId) {
      throw new Error("Expected graph plan child run to start.")
    }

    await updateAgentRun({
      db: getDb(),
      errorMessage: "provider timeout while generating plan",
      id: planChildRunId,
      status: "failed"
    })

    const advanced = await client.agents.advanceRunGraph({
      runId: instance.run.id,
      sessionId: session.id
    })
    const retryEvents = await listAgentEvents({
      db: getDb(),
      runId: instance.run.id
    })
    const retryingEvent = retryEvents.find(
      (event) => event.type === "agent_run_graph_node_retrying"
    )

    expect(advanced).toMatchObject({
      settledNodeIds: ["plan"],
      startedNodeIds: ["plan"]
    })
    expect(
      advanced.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      attempt: 2,
      errorMessage: "provider timeout while generating plan",
      status: "running"
    })
    expect(advanced.startedRuns[0]?.id).not.toBe(planChildRunId)
    expect(retryingEvent?.payload).toMatchObject({
      automatic: true,
      nodeId: "plan"
    })

    port1.close()
    port2.close()
  })

  it("executes a running agent graph node over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-run-graph-execute-node"
      )
    })
    const faux = createFauxProvider({
      modelId: "mock-model"
    })

    faux.setGenerateResponses([
      createFauxGenerateTextResponse("Plan finished.", {
        modelId: "mock-model"
      })
    ])
    mockedResolveModel.mockReturnValue(faux.model)

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      modelId: "mock-model",
      sessionId: session.id,
      templateId: "investigation"
    })

    await client.agents.startRunGraphNextStage({
      runId: instance.run.id,
      sessionId: session.id
    })

    const executed = await client.agents.executeRunGraphNode({
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(executed).toMatchObject({
      childRun: {
        status: "succeeded"
      },
      nodeId: "plan",
      settledNodeIds: ["plan"],
      stopReason: "final",
      turns: 1
    })
    expect(executed.startedNodeIds.length).toBeGreaterThan(0)
    expect(
      executed.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      lastOutput: "Plan finished.",
      status: "succeeded"
    })

    port1.close()
    port2.close()
  })

  it("runs an agent graph until no runnable node remains", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-run-graph-until-idle"
      )
    })
    const faux = createFauxProvider({
      modelId: "mock-model"
    })

    faux.setGenerateResponses([
      createFauxGenerateTextResponse("Plan finished.", {
        modelId: "mock-model"
      }),
      createFauxGenerateTextResponse("Evidence collected.", {
        modelId: "mock-model"
      }),
      createFauxGenerateTextResponse("Synthesis complete.", {
        modelId: "mock-model"
      })
    ])
    mockedResolveModel.mockReturnValue(faux.model)

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const instance = await client.agents.instantiateRunGraphTemplate({
      modelId: "mock-model",
      sessionId: session.id,
      templateId: "investigation"
    })
    const completed = await client.agents.runGraphUntilIdle({
      runId: instance.run.id,
      sessionId: session.id
    })

    expect(completed).toMatchObject({
      executedNodeIds: ["plan", "explore", "synthesize"],
      settledNodeIds: ["plan", "explore", "synthesize"],
      startedNodeIds: ["plan", "explore", "synthesize"],
      stopReason: "completed"
    })
    expect(completed.childRuns).toHaveLength(3)
    expect(completed.iterations).toBeGreaterThanOrEqual(3)
    expect(faux.model.doGenerateCalls).toHaveLength(3)
    expect(completed.plan.nodes.map((node) => node.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded"
    ])
    expect(
      completed.plan.nodes.find((node) => node.id === "synthesize")
    ).toMatchObject({
      lastOutput: "Synthesis complete.",
      status: "succeeded"
    })

    port1.close()
    port2.close()
  })

  it("executes a running agent graph node through an AI SDK provider", async () => {
    await ensureDatabaseReady()

    const projectPath = path.join(
      mockedHomeDir,
      ".config",
      "etyon-run-graph-ai-sdk"
    )

    fs.mkdirSync(path.join(projectPath, "src"), {
      recursive: true
    })
    fs.writeFileSync(
      path.join(projectPath, "src", "provider-settings.ts"),
      "export const providerFlag = true\n"
    )

    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    })

    const session = await createChatSession({
      db: getDb(),
      projectPath
    })
    const kernel = createAgentKernel({
      settings: settings.agents
    })
    const faux = createFauxProvider({
      modelId: "mock-model"
    })

    faux.setGenerateResponses([
      createFauxGenerateToolCallResponse({
        input: {
          path: "src/provider-settings.ts"
        },
        modelId: "mock-model",
        toolCallId: "read-call-1",
        toolName: "read"
      }),
      createFauxGenerateTextResponse("Provider settings file inspected.", {
        modelId: "mock-model"
      })
    ])

    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db: getDb(),
      task: "Inspect provider settings.",
      templateId: "investigation"
    })

    await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db: getDb(),
      rootRunId: instance.rootRun.id
    })

    const executed = await kernel.executeRunGraphNodeWithAiSdk({
      chatSessionId: session.id,
      db: getDb(),
      maxTurns: 2,
      memorySettings: settings.memory,
      model: faux.model,
      projectPath,
      rootRunId: instance.rootRun.id
    })
    const childEvents = await listAgentEvents({
      db: getDb(),
      runId: executed.childRun.id
    })
    const childToolCalls = await listAgentToolCalls({
      db: getDb(),
      runId: executed.childRun.id
    })
    const secondProviderPrompt = JSON.stringify(
      faux.model.doGenerateCalls[1]?.prompt
    )

    expect(faux.model.doGenerateCalls).toHaveLength(2)
    expect(
      faux.model.doGenerateCalls[0]?.tools?.map((item) => item.name).toSorted()
    ).toEqual(["find", "grep", "ls", "read"])
    expect(secondProviderPrompt).toContain("providerFlag")
    expect(executed).toMatchObject({
      nodeId: "plan",
      settledNodeIds: ["plan"],
      stopReason: "final",
      turns: 2
    })
    expect(childToolCalls).toEqual([
      expect.objectContaining({
        id: "read-call-1",
        runId: executed.childRun.id,
        state: "finished",
        toolName: "read"
      })
    ])
    expect(childEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_loop_event",
        "agent_run_finished",
        "agent_run_started",
        "agent_step_started",
        "tool_call_finished",
        "tool_call_started"
      ])
    )
  })

  it("suspends and resumes AI SDK agent graph node tool approvals", async () => {
    await ensureDatabaseReady()

    const projectPath = path.join(
      mockedHomeDir,
      ".config",
      "etyon-run-graph-ai-sdk-approval"
    )

    fs.mkdirSync(path.join(projectPath, "src"), {
      recursive: true
    })

    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    })

    const session = await createChatSession({
      db: getDb(),
      projectPath
    })
    const kernel = createAgentKernel({
      settings: settings.agents
    })
    const faux = createFauxProvider({
      modelId: "mock-model"
    })

    faux.setGenerateResponses([
      createFauxGenerateToolCallResponse({
        input: {
          content: "approved write\n",
          path: "src/generated.txt"
        },
        modelId: "mock-model",
        toolCallId: "write-call-1",
        toolName: "write"
      }),
      createFauxGenerateTextResponse("Write completed.", {
        modelId: "mock-model"
      })
    ])

    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db: getDb(),
      task: "Create a generated file.",
      templateId: "solo-coder"
    })

    await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db: getDb(),
      rootRunId: instance.rootRun.id
    })

    const suspended = await kernel.executeRunGraphNodeWithAiSdk({
      chatSessionId: session.id,
      db: getDb(),
      maxTurns: 1,
      memorySettings: settings.memory,
      model: faux.model,
      projectPath,
      rootRunId: instance.rootRun.id
    })
    const approvals = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })
    const [approval] = approvals

    expect(suspended).toMatchObject({
      nodeId: "coder",
      settledNodeIds: [],
      stopReason: "suspended",
      turns: 1
    })
    expect(suspended.childRun).toMatchObject({
      parentRunId: instance.rootRun.id,
      status: "suspended"
    })
    expect(
      suspended.plan.nodes.find((node) => node.id === "coder")
    ).toMatchObject({
      childRunId: suspended.childRun.id,
      status: "suspended"
    })
    expect(fs.existsSync(path.join(projectPath, "src", "generated.txt"))).toBe(
      false
    )
    expect(approval).toMatchObject({
      approvalId: expect.stringMatching(/^graph-tool-approval-/u),
      id: "write-call-1",
      runId: suspended.childRun.id,
      runStatus: "suspended",
      state: "approval_requested",
      toolName: "write"
    })

    const resumed = await kernel.resumeRunGraphNodeApprovalWithAiSdk({
      approvalId: approval?.approvalId ?? "",
      approved: true,
      chatSessionId: session.id,
      db: getDb(),
      maxTurns: 1,
      memorySettings: settings.memory,
      model: faux.model,
      projectPath,
      rootRunId: instance.rootRun.id,
      toolCallId: "write-call-1"
    })
    const childToolCalls = await listAgentToolCalls({
      db: getDb(),
      runId: suspended.childRun.id
    })
    const childEvents = await listAgentEvents({
      db: getDb(),
      runId: suspended.childRun.id
    })
    const rootEvents = await listAgentEvents({
      db: getDb(),
      runId: instance.rootRun.id
    })
    const pendingAfterResume = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })

    expect(
      fs.readFileSync(path.join(projectPath, "src", "generated.txt"), "utf-8")
    ).toBe("approved write\n")
    expect(faux.model.doGenerateCalls).toHaveLength(2)
    expect(resumed).toMatchObject({
      nodeId: "coder",
      settledNodeIds: ["coder"],
      startedNodeIds: ["review"],
      stopReason: "final",
      turns: 1
    })
    expect(
      resumed.plan.nodes.find((node) => node.id === "coder")
    ).toMatchObject({
      status: "succeeded"
    })
    expect(childToolCalls).toEqual([
      expect.objectContaining({
        approvalState: "approved",
        id: "write-call-1",
        runId: suspended.childRun.id,
        state: "finished",
        toolName: "write"
      })
    ])
    expect(childEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_run_finished",
        "tool_call_approval_requested",
        "tool_call_approved",
        "tool_call_finished"
      ])
    )
    expect(rootEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_run_graph_node_resumed",
        "agent_run_graph_node_succeeded",
        "agent_run_graph_node_suspended"
      ])
    )
    expect(pendingAfterResume).toEqual([])
  })

  it("responds to suspended run graph approvals over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const projectPath = path.join(
      mockedHomeDir,
      ".config",
      "etyon-run-graph-rpc-approval"
    )

    fs.mkdirSync(path.join(projectPath, "src"), {
      recursive: true
    })

    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    })

    updateSettings({
      agents: settings.agents
    })

    const session = await createChatSession({
      db: getDb(),
      projectPath
    })
    const kernel = createAgentKernel({
      settings: settings.agents
    })
    const faux = createFauxProvider({
      modelId: "mock-model"
    })

    faux.setGenerateResponses([
      createFauxGenerateToolCallResponse({
        input: {
          content: "rpc approved write\n",
          path: "src/rpc-generated.txt"
        },
        modelId: "mock-model",
        toolCallId: "write-call-rpc",
        toolName: "write"
      }),
      createFauxGenerateTextResponse("RPC write completed.", {
        modelId: "mock-model"
      }),
      createFauxGenerateTextResponse("RPC review completed.", {
        modelId: "mock-model"
      })
    ])
    mockedResolveModel.mockReturnValue(faux.model)

    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db: getDb(),
      task: "Create a generated file through RPC approval.",
      templateId: "solo-coder"
    })

    await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db: getDb(),
      rootRunId: instance.rootRun.id
    })
    const suspended = await kernel.executeRunGraphNodeWithAiSdk({
      chatSessionId: session.id,
      db: getDb(),
      maxTurns: 1,
      memorySettings: settings.memory,
      model: faux.model,
      projectPath,
      rootRunId: instance.rootRun.id
    })
    const [approval] = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.respondToRunGraphApproval({
      approvalId: approval?.approvalId ?? "",
      approved: true,
      continueUntilIdle: true,
      rootRunId: instance.rootRun.id,
      sessionId: session.id,
      toolCallId: approval?.id ?? ""
    })
    const pendingAfterResume = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })

    expect(suspended.stopReason).toBe("suspended")
    expect(result).toMatchObject({
      childRun: {
        id: suspended.childRun.id,
        status: "succeeded"
      },
      nodeId: "coder",
      run: {
        id: instance.rootRun.id
      },
      settledNodeIds: ["coder"],
      continuedGraph: {
        executedNodeIds: ["review"],
        settledNodeIds: ["review"],
        stopReason: "completed"
      }
    })
    expect(result.continuedGraph?.childRuns).toHaveLength(1)
    expect(
      result.continuedGraph?.plan.nodes.map((node) => node.status)
    ).toEqual(["succeeded", "succeeded"])
    expect(
      fs.readFileSync(
        path.join(projectPath, "src", "rpc-generated.txt"),
        "utf-8"
      )
    ).toBe("rpc approved write\n")
    expect(pendingAfterResume).toEqual([])

    port1.close()
    port2.close()
  })

  it("queues agent steering over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-queue")
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.queueMessage({
      content: "Prefer the existing helper.",
      queue: "steer",
      sessionId: session.id
    })
    const events = await listAgentEvents({
      db: getDb(),
      runId: run.id
    })

    expect(result.message).toEqual({
      chatSessionId: session.id,
      content: "Prefer the existing helper.",
      createdAt: expect.any(String),
      id: expect.any(String),
      queue: "steer",
      runId: run.id
    })
    expect(listPendingAgentSessionQueuedMessages(events)).toEqual([
      {
        createdAt: expect.any(String),
        id: result.message.id,
        message: "Prefer the existing helper.",
        queue: "steer",
        runId: run.id,
        sequence: expect.any(Number)
      }
    ])

    port1.close()
    port2.close()
  })

  it("manages queued agent messages over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-queue-control")
    })
    await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const first = await client.agents.queueMessage({
      content: "Prefer the existing helper.",
      queue: "steer",
      sessionId: session.id
    })
    const second = await client.agents.queueMessage({
      content: "Add a follow-up summary.",
      queue: "follow-up",
      sessionId: session.id
    })
    const third = await client.agents.queueMessage({
      content: "Check tests before finishing.",
      queue: "steer",
      sessionId: session.id
    })

    await client.agents.updateQueuedMessage({
      content: "Prefer the shared helper.",
      id: first.message.id,
      queue: "follow-up",
      sessionId: session.id
    })
    await client.agents.reorderQueuedMessages({
      ids: [third.message.id, first.message.id, second.message.id],
      sessionId: session.id
    })
    const afterRemove = await client.agents.removeQueuedMessage({
      id: second.message.id,
      sessionId: session.id
    })

    expect(afterRemove.messages).toEqual([
      expect.objectContaining({
        chatSessionId: session.id,
        content: "Check tests before finishing.",
        id: third.message.id,
        queue: "steer"
      }),
      expect.objectContaining({
        chatSessionId: session.id,
        content: "Prefer the shared helper.",
        id: first.message.id,
        queue: "follow-up"
      })
    ])
    expect(
      await client.agents.listQueuedMessages({
        sessionId: session.id
      })
    ).toEqual(afterRemove)

    port1.close()
    port2.close()
  })

  it("manages agent session tree navigation over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon-session-tree")
    })
    const otherSession = await createChatSession({
      db: getDb(),
      projectPath: path.join(
        mockedHomeDir,
        ".config",
        "etyon-session-tree-other"
      )
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Start.",
          role: "user"
        },
        {
          content: "Old branch.",
          role: "assistant"
        }
      ],
      run
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const afterMove = await client.agents.moveSessionLeaf({
      branchSummary: "Forked after start.",
      entryId: "entry-1",
      runId: run.id,
      sessionId: session.id
    })

    expect(afterMove.context).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      {
        content: "Branch summary:\nForked after start.",
        role: "system",
        type: "model"
      }
    ])
    expect(afterMove.entries.map((entry) => entry.type)).toEqual([
      "message",
      "leaf",
      "message",
      "leaf",
      "branch_summary",
      "leaf"
    ])
    expect(afterMove.run).toEqual(
      expect.objectContaining({
        chatSessionId: session.id,
        id: run.id
      })
    )

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "New branch.",
          role: "assistant"
        }
      ],
      run
    })

    const afterCompaction = await client.agents.appendSessionCompactionSummary({
      runId: run.id,
      sessionId: session.id,
      summary: "The new branch has enough context to continue."
    })

    expect(afterCompaction.context).toEqual([
      {
        content:
          "Compaction summary:\nThe new branch has enough context to continue.",
        role: "system",
        type: "model"
      }
    ])
    expect(afterCompaction.entries.map((entry) => entry.type)).toContain(
      "compaction_summary"
    )
    expect(
      await client.agents.inspectSession({
        runId: run.id,
        sessionId: session.id
      })
    ).toEqual(afterCompaction)
    await expect(
      client.agents.moveSessionLeaf({
        entryId: "missing-entry",
        runId: run.id,
        sessionId: session.id
      })
    ).rejects.toThrow()
    await expect(
      client.agents.inspectSession({
        runId: run.id,
        sessionId: otherSession.id
      })
    ).rejects.toThrow()
    expect(
      await client.agents.inspectSession({
        runId: run.id,
        sessionId: session.id
      })
    ).toEqual(afterCompaction)

    port1.close()
    port2.close()
  })

  it("inspects an agent run trace over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: path.join(mockedHomeDir, ".config", "etyon")
    })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await appendAgentEvent({
      db: getDb(),
      payload: {
        profileId: "coder",
        toolNames: ["readFile"]
      },
      runId: run.id,
      type: "agent_run_started"
    })
    await recordAgentToolCall({
      approvalState: "not_required",
      db: getDb(),
      id: "rpc-tool-call-1",
      input: {
        path: "README.md"
      },
      runId: run.id,
      state: "finished",
      toolName: "readFile"
    })
    const artifactPath = path.join(mockedHomeDir, "rpc-tool-output.json")
    const artifactContent = "abcdef"
    fs.mkdirSync(mockedHomeDir, { recursive: true })
    fs.writeFileSync(artifactPath, artifactContent)
    const artifact = await recordAgentArtifact({
      byteLength: Buffer.byteLength(artifactContent),
      db: getDb(),
      kind: "command-output",
      metadata: {
        toolName: "readFile"
      },
      path: artifactPath,
      runId: run.id,
      toolCallId: "rpc-tool-call-1"
    })

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.agents.inspectRun({
      runId: run.id,
      sessionId: session.id
    })

    expect(result.run).toMatchObject({
      chatSessionId: session.id,
      id: run.id,
      profileId: "coder",
      status: "running"
    })
    expect(result.events).toEqual([
      expect.objectContaining({
        payload: {
          profileId: "coder",
          toolNames: ["readFile"]
        },
        runId: run.id,
        sequence: 1,
        type: "agent_run_started"
      })
    ])
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        id: "rpc-tool-call-1",
        input: {
          path: "README.md"
        },
        runId: run.id,
        state: "finished",
        toolName: "readFile"
      })
    ])
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        byteLength: Buffer.byteLength(artifactContent),
        kind: "command-output",
        metadata: {
          toolName: "readFile"
        },
        path: artifactPath,
        runId: run.id,
        toolCallId: "rpc-tool-call-1"
      })
    ])
    await expect(
      client.agents.readArtifact({
        artifactId: artifact.id,
        maxChars: 4,
        sessionId: session.id
      })
    ).resolves.toMatchObject({
      artifact: expect.objectContaining({
        id: artifact.id,
        path: artifactPath,
        runId: run.id
      }),
      content: "abcd",
      omittedChars: 2,
      totalChars: 6,
      truncated: true
    })

    port1.close()
    port2.close()
  })

  it("creates, lists, opens, and pins chat sessions over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const createdSession = await client.chatSessions.create({})
    const sessionsAfterCreate = await client.chatSessions.list()
    const openedSession = await client.chatSessions.open({
      sessionId: createdSession.id
    })
    const pinnedSession = await client.chatSessions.setPinned({
      pinned: true,
      sessionId: createdSession.id
    })
    const unpinnedSession = await client.chatSessions.setPinned({
      pinned: false,
      sessionId: createdSession.id
    })

    expect(createdSession.projectPath).toBe(`${mockedHomeDir}/.config/etyon`)
    expect(
      sessionsAfterCreate.some((session) => session.id === createdSession.id)
    ).toBe(true)
    expect(openedSession.id).toBe(createdSession.id)
    expect(openedSession.lastOpenedAt >= createdSession.lastOpenedAt).toBe(true)
    expect(pinnedSession.pinnedAt).toBeTruthy()
    expect(unpinnedSession.pinnedAt).toBeNull()

    port1.close()
    port2.close()
  })

  it("creates a chat session for an explicit project path over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const createdSession = await client.chatSessions.create({
      projectPath: "/tmp/etyon-rpc-explicit-project"
    })

    expect(createdSession.projectPath).toBe("/tmp/etyon-rpc-explicit-project")
    expect(fs.existsSync(createdSession.projectPath)).toBe(true)

    port1.close()
    port2.close()
  })

  it("archives chat sessions over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const createdSession = await client.chatSessions.create({})
    const archivedSession = await (
      client.chatSessions as typeof client.chatSessions & {
        archive: (input: { sessionId: string }) => Promise<{
          archivedAt: string | null
          id: string
        }>
      }
    ).archive({
      sessionId: createdSession.id
    })
    const sessionsAfterArchive = await client.chatSessions.list()

    expect(archivedSession.id).toBe(createdSession.id)
    expect(archivedSession.archivedAt).toBeTruthy()
    expect(
      sessionsAfterArchive.some((session) => session.id === createdSession.id)
    ).toBe(false)

    port1.close()
    port2.close()
  })

  it("persists collapsed project paths over the message-port adapter", async () => {
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const initialState = await client.sidebarState.get()
    const updatedState = await client.sidebarState.setCollapsedProjects({
      collapsedProjectPaths: [
        "/tmp/b-project",
        "/tmp/a-project",
        "/tmp/a-project"
      ]
    })
    const resizedState = await client.sidebarState.setWidth({
      sidebarWidthPx: 320
    })

    expect(initialState).toEqual({
      collapsedProjectPaths: [],
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 272
    })
    expect(updatedState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 272
    })
    expect(resizedState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 320
    })
    expect(await client.sidebarState.get()).toEqual(resizedState)

    port1.close()
    port2.close()
  })

  it("runs project sidebar actions over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const projectPath = "/tmp/etyon-rpc-project-actions"
    const createdSession = await client.chatSessions.create({
      projectPath
    })
    const renamedState = await client.projects.rename({
      displayName: "Project Actions",
      projectPath
    })
    const pinnedState = await client.projects.setPinned({
      pinned: true,
      projectPath
    })
    const orderedState = await client.sidebarState.setProjectOrder({
      projectOrder: [projectPath]
    })
    const sessionsAfterArchive = await client.projects.archiveChats({
      projectPath
    })
    const recreatedSession = await client.chatSessions.create({
      projectPath
    })
    const sessionsAfterRemove = await client.projects.remove({
      projectPath
    })

    expect(renamedState.projectDisplayNames[projectPath]).toBe(
      "Project Actions"
    )
    expect(pinnedState.projectPins[projectPath]).toBeTruthy()
    expect(orderedState.projectOrder).toEqual([projectPath])
    expect(
      sessionsAfterArchive.some((session) => session.id === createdSession.id)
    ).toBe(false)
    expect(
      sessionsAfterRemove.some((session) => session.id === recreatedSession.id)
    ).toBe(false)
    expect(await client.sidebarState.get()).toMatchObject({
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {}
    })

    port1.close()
    port2.close()
  })

  it("updates the session model and exposes project snapshot procedures over the message-port adapter", async () => {
    await ensureDatabaseReady()

    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const createdSession = await client.chatSessions.create({})
    const sourceFilePath = path.join(
      createdSession.projectPath,
      "src",
      "rpc.ts"
    )

    fs.mkdirSync(path.dirname(sourceFilePath), { recursive: true })
    fs.writeFileSync(sourceFilePath, "export const rpcValue = 1\n")

    const updatedSession = await client.chatSessions.setModel({
      modelId: "openai/gpt-4o-mini",
      sessionId: createdSession.id
    })
    const snapshotState = await client.projectSnapshots.ensure({
      sessionId: createdSession.id
    })
    const listFilesResult = await client.projectSnapshots.listFiles({
      query: "rpc",
      sessionId: createdSession.id
    })

    expect(updatedSession.modelId).toBe("openai/gpt-4o-mini")
    expect(snapshotState.projectPath).toBe(createdSession.projectPath)
    expect(snapshotState.snapshotId).toBeTruthy()
    expect(listFilesResult.snapshotId).toBe(snapshotState.snapshotId)
    expect(listFilesResult.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "src/rpc.ts",
          snapshotId: snapshotState.snapshotId
        })
      ])
    )

    port1.close()
    port2.close()
  })
})
