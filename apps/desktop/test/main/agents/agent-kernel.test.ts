import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  appendAgentEvent,
  listAgentEvents,
  updateAgentRun
} from "@/main/agents/agent-event-store"
import { createAgentKernel } from "@/main/agents/agent-kernel"
import type { AgentLoopModel } from "@/main/agents/agent-loop"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

import {
  createFauxGenerateTextResponse,
  createMockLanguageModel
} from "./faux-provider"

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
        activeToolNames: ["read", "grep", "find", "ls", "stat"],
        id: "plan",
        stage: 0,
        status: "pending",
        toolScope: "read-only"
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls", "stat"],
        id: "explore-code",
        parallelGroup: "explore",
        stage: 1
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls", "stat"],
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
          "stat",
          "bash",
          "processOutput",
          "stopProcess",
          "mkdir",
          "delete",
          "edit",
          "smartEdit",
          "write",
          "requestAccess",
          "agentExplore",
          "agentPlan",
          "agentReview"
        ],
        id: "coder",
        stage: 2,
        toolScope: "approval-gated"
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls", "stat"],
        id: "review",
        stage: 3
      }),
      expect.objectContaining({
        activeToolNames: ["read", "grep", "find", "ls", "stat"],
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

  it("starts chat runs through the kernel lifecycle boundary", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel()
    const session = await createChatSession({
      db
    })
    const run = await kernel.startRun({
      chatSessionId: session.id,
      db,
      metadata: {
        toolNames: ["read"]
      },
      modelId: "mock-model",
      profileId: "general-purpose",
      source: "chat"
    })
    const events = await listAgentEvents({
      db,
      runId: run.id
    })

    expect(run).toMatchObject({
      chatSessionId: session.id,
      modelId: "mock-model",
      parentRunId: null,
      profileId: "general-purpose",
      status: "running"
    })
    expect(events).toEqual([
      expect.objectContaining({
        payload: {
          profileId: "general-purpose",
          source: "chat",
          toolNames: ["read"]
        },
        runId: run.id,
        sequence: 1,
        type: "agent_run_started"
      })
    ])
  })

  it("routes graph child runs through profile preferred models", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel({
      profiles: [
        {
          id: "plan",
          name: "Plan",
          preferredModel: "openai/planner",
          readonly: true
        }
      ]
    })
    const session = await createChatSession({
      db
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db,
      modelId: "openai/user",
      templateId: "investigation"
    })
    const firstStage = await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })
    const [childRun] = firstStage.startedRuns

    if (!childRun) {
      throw new Error("Expected graph plan child run to start.")
    }

    const events = await listAgentEvents({
      db,
      runId: instance.rootRun.id
    })

    expect(childRun).toMatchObject({
      modelId: "openai/planner",
      profileId: "plan"
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            modelId: "openai/planner",
            modelRoute: expect.objectContaining({
              fallbackChain: ["openai/user"],
              modelId: "openai/planner",
              reason: "profile",
              stepKind: "plan"
            }),
            nodeId: "plan",
            profileId: "plan"
          }),
          type: "agent_run_graph_node_started"
        })
      ])
    )
  })

  it("falls back to the user model when a graph node profile model errors", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel({
      profiles: [
        {
          id: "plan",
          name: "Plan",
          preferredModel: "openai/planner",
          readonly: true
        }
      ]
    })
    const primaryProvider = createMockLanguageModel({
      modelId: "openai/planner"
    })
    const fallbackProvider = createMockLanguageModel({
      generateResponses: [
        createFauxGenerateTextResponse("fallback plan"),
        createFauxGenerateTextResponse("fallback summary")
      ],
      modelId: "openai/user"
    })
    const resolveModel = vi.fn((modelId?: string) => {
      if (modelId === "openai/planner") {
        return primaryProvider.model
      }

      if (modelId === "openai/user") {
        return fallbackProvider.model
      }

      throw new Error(`Unexpected model id: ${modelId}`)
    })
    const session = await createChatSession({
      db
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db,
      modelId: "openai/user",
      templateId: "investigation"
    })

    await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })

    const executed = await kernel.executeRunGraphNodeWithAiSdk({
      chatSessionId: session.id,
      db,
      model: fallbackProvider.model,
      projectPath: session.projectPath,
      resolveModel,
      rootRunId: instance.rootRun.id
    })
    const childEvents = await listAgentEvents({
      db,
      runId: executed.childRun.id
    })

    expect(primaryProvider.model.doGenerateCalls).toHaveLength(1)
    expect(fallbackProvider.model.doGenerateCalls.length).toBeGreaterThan(0)
    expect(executed).toMatchObject({
      nodeId: "plan",
      startedNodeIds: ["explore"],
      stopReason: "final"
    })
    expect(childEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            error: "Mock language model generate response queue is empty.",
            fallbackModelId: "openai/user",
            fromModelId: "openai/planner",
            graphNodeId: "plan",
            modelRoute: expect.objectContaining({
              fallbackChain: ["openai/user"],
              modelId: "openai/planner",
              reason: "profile"
            })
          }),
          type: "agent_model_fallback_used"
        })
      ])
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

  it("uses run graph retry policy overrides for automatic retries", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel({
      retry: {
        maxAutomaticRetries: 1,
        retryTransientFailures: true
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
    const policyUpdate = await kernel.updateRunGraphRetryPolicy({
      chatSessionId: session.id,
      db,
      retryPolicy: {
        maxAutomaticRetries: 1,
        retryTransientFailures: false
      },
      rootRunId: instance.rootRun.id
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
    const events = await listAgentEvents({
      db,
      runId: instance.rootRun.id
    })

    expect(policyUpdate.retryPolicy).toEqual({
      maxAutomaticRetries: 1,
      retryTransientFailures: false
    })
    expect(policyUpdate.plan.retryPolicy).toEqual(policyUpdate.retryPolicy)
    expect(
      advanced.plan.nodes.find((node) => node.id === "plan")
    ).toMatchObject({
      errorMessage: "provider timeout while generating plan",
      status: "failed"
    })
    expect(
      events.some((event) => event.type === "agent_run_graph_node_retrying")
    ).toBe(false)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            retryPolicy: {
              maxAutomaticRetries: 1,
              retryTransientFailures: false
            }
          },
          type: "agent_run_graph_retry_policy_updated"
        })
      ])
    )
  })

  it("skips failed graph nodes and starts dependent nodes", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel()
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
      errorMessage: "non-retryable assertion mismatch",
      id: planChildRunId,
      status: "failed"
    })

    await kernel.advanceRunGraph({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })

    const skipped = await kernel.skipRunGraphNode({
      chatSessionId: session.id,
      db,
      nodeId: "plan",
      reason: "Continue with available context.",
      rootRunId: instance.rootRun.id
    })
    const events = await listAgentEvents({
      db,
      runId: instance.rootRun.id
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
      attempt: 1,
      status: "running"
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            nodeId: "plan",
            reason: "Continue with available context."
          }),
          type: "agent_run_graph_node_skipped"
        }),
        expect.objectContaining({
          type: "agent_run_graph_checkpoint_created"
        })
      ])
    )
  })

  it("uses a summary processor for large dependency output prompts", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel()
    const session = await createChatSession({
      db
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db,
      templateId: "investigation"
    })
    const largePlanOutput = "plan output ".repeat(600)

    await appendAgentEvent({
      db,
      payload: {
        nodeId: "plan",
        output: largePlanOutput
      },
      runId: instance.rootRun.id,
      type: "agent_run_graph_node_succeeded"
    })

    await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })

    let prompt = ""

    await kernel.executeRunGraphNode({
      chatSessionId: session.id,
      db,
      model: ({ messages }) => {
        prompt = messages[0]?.role === "user" ? messages[0].content : ""

        return {
          content: "Explore summary.",
          toolCalls: []
        }
      },
      nodeId: "explore",
      rootRunId: instance.rootRun.id,
      toolResultSummaryProcessor: ({ deterministicSummary }) =>
        `model summary from ${deterministicSummary.totalChars} chars`
    })

    expect(prompt).toContain("Dependency plan output:")
    expect(prompt).toContain(
      `model summary from ${largePlanOutput.length} chars`
    )
    expect(prompt).toContain("model summary used")
    expect(prompt).not.toContain(largePlanOutput)
  })

  it("caches dependency output summaries across sibling graph nodes", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const kernel = createTestKernel()
    const session = await createChatSession({
      db
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: session.id,
      db,
      templateId: "plan-execute-review"
    })
    const largePlanOutput = "shared plan output ".repeat(600)

    await appendAgentEvent({
      db,
      payload: {
        nodeId: "plan",
        output: largePlanOutput
      },
      runId: instance.rootRun.id,
      type: "agent_run_graph_node_succeeded"
    })

    await kernel.startNextRunGraphStage({
      chatSessionId: session.id,
      db,
      rootRunId: instance.rootRun.id
    })

    const processor = vi.fn(
      ({
        deterministicSummary
      }: {
        deterministicSummary: { totalChars: number }
      }) => `cached summary from ${deterministicSummary.totalChars} chars`
    )
    const prompts: string[] = []
    const model: AgentLoopModel = ({ messages }) => {
      prompts.push(messages[0]?.role === "user" ? messages[0].content : "")

      return {
        content: "Explore summary.",
        toolCalls: []
      }
    }

    await kernel.executeRunGraphNode({
      chatSessionId: session.id,
      db,
      model,
      nodeId: "explore-code",
      rootRunId: instance.rootRun.id,
      toolResultSummaryProcessor: processor
    })
    await kernel.executeRunGraphNode({
      chatSessionId: session.id,
      db,
      model,
      nodeId: "explore-tests",
      rootRunId: instance.rootRun.id,
      toolResultSummaryProcessor: processor
    })

    const events = await listAgentEvents({
      db,
      runId: instance.rootRun.id
    })
    const cachedEvents = events.filter(
      (event) => event.type === "agent_tool_result_summary_cached"
    )

    expect(processor).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain(
      `cached summary from ${largePlanOutput.length} chars`
    )
    expect(prompts[1]).toContain(
      `cached summary from ${largePlanOutput.length} chars`
    )
    expect(cachedEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          dependencyNodeId: "plan",
          graphNodeId: "explore-code",
          summary: expect.objectContaining({
            content: `cached summary from ${largePlanOutput.length} chars`,
            processor: "model"
          }),
          summaryCacheId: expect.stringContaining(
            `${instance.rootRun.id}:plan:`
          )
        })
      })
    ])
  })
})
