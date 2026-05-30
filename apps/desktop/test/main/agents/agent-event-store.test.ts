import fs from "node:fs"

import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { recordAgentToolOutputArtifacts } from "@/main/agents/agent-artifacts"
import {
  createAgentRun,
  getActiveAgentRunForSession,
  getAgentArtifact,
  getAgentRun,
  getAgentRunForToolApproval,
  getAgentRunForToolCall,
  listAgentArtifacts,
  listAgentEvents,
  listRecoverableAgentRuns,
  listPendingAgentApprovals,
  listAgentToolCalls,
  recordAgentArtifact,
  recordAgentToolCall,
  recoverInterruptedAgentRuns,
  updateAgentRun,
  updateAgentToolCall
} from "@/main/agents/agent-event-store"
import type { AgentLoopMessage, AgentLoopModel } from "@/main/agents/agent-loop"
import { createSessionBoundAgent } from "@/main/agents/agent-session-binding"
import {
  appendAgentSessionCompactionSummaryEvent,
  appendAgentSessionCustomMessageEvent,
  appendAgentSessionModelMessageEvents,
  appendAgentSessionMoveEvent,
  appendAgentSessionPlanModeEvent,
  appendAgentSessionQueuedFollowUpEvent,
  appendAgentSessionQueuedSteeringEvent,
  buildAgentSessionTreeFromEvents,
  createAgentSessionQueuedMessageWriter,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"
import type {
  AgentSessionCustomMessageEntry,
  AgentSessionTreeEntry
} from "@/main/agents/agent-session-tree"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentApprovals, agentRuns } from "@/main/db/schema"

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

const isAgentSessionCustomMessageEntry = (
  entry: AgentSessionTreeEntry
): entry is AgentSessionCustomMessageEntry => entry.type === "custom_message"

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

  it("persists branch movement, compaction, and custom session entries", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
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
    await appendAgentSessionMoveEvent({
      branchSummary: "Forked after start.",
      entryId: "entry-1",
      run
    })
    await appendAgentSessionCustomMessageEvent({
      message: {
        data: {
          message: "Keep this steering note off the model context."
        },
        type: "steering"
      },
      run
    })
    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "New branch.",
          role: "assistant"
        }
      ],
      run
    })
    await appendAgentSessionCompactionSummaryEvent({
      run,
      summary: "The active branch already selected a safer implementation."
    })
    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Continue from compacted state.",
          role: "user"
        }
      ],
      run
    })

    const sessionTree = buildAgentSessionTreeFromEvents(
      await listAgentEvents({
        db,
        runId: run.id
      })
    )

    expect(sessionTree.buildContext()).toEqual([
      {
        content:
          "Compaction summary:\nThe active branch already selected a safer implementation.",
        role: "system",
        type: "model"
      },
      {
        content: "Continue from compacted state.",
        role: "user",
        type: "model"
      }
    ])
    expect(sessionTree.listEntries().map((entry) => entry.type)).toEqual([
      "message",
      "leaf",
      "message",
      "leaf",
      "branch_summary",
      "leaf",
      "custom_message",
      "leaf",
      "message",
      "leaf",
      "compaction_summary",
      "leaf",
      "message",
      "leaf"
    ])
  })

  it("persists queued steering and follow-up messages as custom session entries", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Start.",
          role: "user"
        }
      ],
      run
    })
    await appendAgentSessionQueuedSteeringEvent({
      message: "Prefer concise output.",
      run
    })
    await appendAgentSessionQueuedFollowUpEvent({
      message: "Continue after the final answer.",
      run
    })

    const sessionTree = buildAgentSessionTreeFromEvents(
      await listAgentEvents({
        db,
        runId: run.id
      })
    )
    const customMessages = sessionTree
      .listEntries()
      .filter(isAgentSessionCustomMessageEntry)
      .map((entry) => entry.message)

    expect(sessionTree.buildContext()).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      }
    ])
    expect(customMessages).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          message: "Prefer concise output.",
          queue: "steer"
        }),
        type: "steering"
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          message: "Continue after the final answer.",
          queue: "follow-up"
        }),
        type: "follow-up"
      })
    ])
  })

  it("adapts agent queued message writes to persisted session events", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })
    const writeQueuedMessage = createAgentSessionQueuedMessageWriter({ run })

    await writeQueuedMessage({
      content: "Prefer concise output.",
      queue: "steer"
    })
    await writeQueuedMessage({
      content: "Continue after the final answer.",
      queue: "follow-up"
    })

    expect(
      buildAgentSessionTreeFromEvents(
        await listAgentEvents({
          db,
          runId: run.id
        })
      )
        .listEntries()
        .filter(isAgentSessionCustomMessageEntry)
        .map((entry) => entry.message)
    ).toEqual([
      {
        data: {
          id: expect.any(String),
          message: "Prefer concise output.",
          queue: "steer"
        },
        type: "steering"
      },
      {
        data: {
          id: expect.any(String),
          message: "Continue after the final answer.",
          queue: "follow-up"
        },
        type: "follow-up"
      }
    ])
  })

  it("binds stateful agent turns and queued messages to session events", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await appendAgentSessionQueuedSteeringEvent({
      message: "Recovered steering.",
      run
    })

    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(structuredClone(messages) as AgentLoopMessage[])

      if (modelMessages.length === 1) {
        return {
          content: "I will inspect.",
          toolCalls: [
            {
              input: {},
              toolCallId: "inspect-1",
              toolName: "inspect"
            }
          ]
        }
      }

      return {
        content: "Done.",
        toolCalls: []
      }
    })
    const agent = createSessionBoundAgent({
      events: await listAgentEvents({
        db,
        runId: run.id
      }),
      maxTurns: 3,
      model,
      run,
      tools: {
        inspect: {
          execute: () => "ok"
        }
      }
    })

    await agent.prompt("Start.")
    agent.followUp("Persist this follow-up.")
    await agent.waitForIdle()

    const events = await listAgentEvents({
      db,
      runId: run.id
    })

    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "Recovered steering.",
      role: "user"
    })
    expect(buildAgentSessionTreeFromEvents(events).buildContext()).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      expect.objectContaining({
        role: "assistant",
        type: "model"
      }),
      expect.objectContaining({
        role: "tool",
        type: "model"
      }),
      {
        content: "Recovered steering.",
        role: "user",
        type: "model"
      },
      expect.objectContaining({
        role: "assistant",
        type: "model"
      })
    ])
    expect(listPendingAgentSessionQueuedMessages(events)).toEqual([
      expect.objectContaining({
        message: "Persist this follow-up.",
        queue: "follow-up"
      })
    ])
  })

  it("persists plan mode state as a custom session entry", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "plan"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Create a plan.",
          role: "user"
        }
      ],
      run
    })
    await appendAgentSessionPlanModeEvent({
      completedStepNumbers: [1, 3],
      mode: "execute",
      run
    })

    const sessionTree = buildAgentSessionTreeFromEvents(
      await listAgentEvents({
        db,
        runId: run.id
      })
    )

    expect(sessionTree.buildContext()).toEqual([
      {
        content: "Create a plan.",
        role: "user",
        type: "model"
      }
    ])
    expect(
      sessionTree
        .listEntries()
        .filter(isAgentSessionCustomMessageEntry)
        .map((entry) => entry.message)
    ).toEqual([
      {
        data: {
          completedStepNumbers: [1, 3],
          mode: "execute"
        },
        type: "plan-mode"
      }
    ])
  })

  it("gets a run only inside the requested chat session and project", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const projectPathA = `${mockedHomeDir}/project-a`
    const projectPathB = `${mockedHomeDir}/project-b`

    fs.mkdirSync(projectPathA, { recursive: true })
    fs.mkdirSync(projectPathB, { recursive: true })

    const sessionA = await createChatSession({
      db,
      projectPath: projectPathA
    })
    const sessionB = await createChatSession({
      db,
      projectPath: projectPathB
    })
    const run = await createAgentRun({
      chatSessionId: sessionA.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await expect(
      getAgentRun({
        chatSessionId: sessionA.id,
        db,
        projectPath: projectPathA,
        runId: run.id
      })
    ).resolves.toMatchObject({
      chatSessionId: sessionA.id,
      id: run.id
    })
    await expect(
      getAgentRun({
        chatSessionId: sessionB.id,
        db,
        projectPath: projectPathA,
        runId: run.id
      })
    ).resolves.toBeNull()
    await expect(
      getAgentRun({
        chatSessionId: sessionA.id,
        db,
        projectPath: projectPathB,
        runId: run.id
      })
    ).resolves.toBeNull()
  })

  it("rebuilds session context from persisted run events", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Start from the persisted event log.",
          role: "user"
        },
        {
          content: "Persisted context is available.",
          role: "assistant"
        }
      ],
      run
    })

    const events = await listAgentEvents({
      db: getDb(),
      runId: run.id
    })
    const sessionTree = buildAgentSessionTreeFromEvents(events)

    expect(sessionTree.buildContext()).toEqual([
      {
        content: "Start from the persisted event log.",
        role: "user",
        type: "model"
      },
      {
        content: "Persisted context is available.",
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("allocates unique sequences for concurrent event appends", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        run.appendEvent({
          payload: {
            index
          },
          type: "tool_call_delta"
        })
      )
    )

    const events = await listAgentEvents({
      db: getDb(),
      runId: run.id
    })

    expect(events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8
    ])
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

  it("scopes reused provider tool call ids by run", async () => {
    await ensureDatabaseReady()

    const firstSession = await createChatSession({ db: getDb() })
    const secondSession = await createChatSession({ db: getDb() })
    const firstRun = await createAgentRun({
      chatSessionId: firstSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })
    const secondRun = await createAgentRun({
      chatSessionId: secondSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "general-purpose"
    })

    await recordAgentToolCall({
      approvalState: "not_required",
      db: getDb(),
      id: "reused-tool-call",
      input: {
        path: "src/first.ts"
      },
      runId: firstRun.id,
      state: "running",
      toolName: "readFile"
    })
    await recordAgentToolCall({
      approvalState: "not_required",
      db: getDb(),
      id: "reused-tool-call",
      input: {
        path: "src/second.ts"
      },
      runId: secondRun.id,
      state: "running",
      toolName: "readFile"
    })
    await updateAgentToolCall({
      db: getDb(),
      id: "reused-tool-call",
      output: {
        content: "second"
      },
      runId: secondRun.id,
      state: "finished"
    })

    await expect(
      getAgentRunForToolCall({
        chatSessionId: firstSession.id,
        db: getDb(),
        toolCallId: "reused-tool-call"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: firstRun.id
      })
    )
    await expect(
      getAgentRunForToolCall({
        chatSessionId: secondSession.id,
        db: getDb(),
        toolCallId: "reused-tool-call"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: secondRun.id
      })
    )
    await expect(
      listAgentToolCalls({
        db: getDb(),
        runId: firstRun.id
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "reused-tool-call",
        input: {
          path: "src/first.ts"
        },
        output: undefined,
        state: "running"
      })
    ])
    await expect(
      listAgentToolCalls({
        db: getDb(),
        runId: secondRun.id
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "reused-tool-call",
        input: {
          path: "src/second.ts"
        },
        output: {
          content: "second"
        },
        state: "finished"
      })
    ])
  })

  it("loads the owning agent run for a tool call", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "tool-call-owner-1",
      input: {
        patch: "*** Begin Patch\n*** End Patch"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "applyPatch"
    })

    const ownerRun = await getAgentRunForToolCall({
      db: getDb(),
      toolCallId: "tool-call-owner-1"
    })

    expect(ownerRun).toEqual(
      expect.objectContaining({
        chatSessionId: session.id,
        id: run.id,
        profileId: "coder",
        status: "running"
      })
    )
  })

  it("resolves the active top-level run for a chat session", async () => {
    await ensureDatabaseReady()

    const ownerSession = await createChatSession({ db: getDb() })
    const otherSession = await createChatSession({ db: getDb() })
    const ownerRun = await createAgentRun({
      chatSessionId: ownerSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })
    const childRun = await createAgentRun({
      chatSessionId: ownerSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1-mini",
      parentRunId: ownerRun.id,
      profileId: "explore"
    })
    const otherRun = await createAgentRun({
      chatSessionId: otherSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await updateAgentRun({
      db: getDb(),
      id: otherRun.id,
      status: "suspended"
    })

    await expect(
      getActiveAgentRunForSession({
        chatSessionId: ownerSession.id,
        db: getDb()
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: ownerRun.id,
        parentRunId: null,
        status: "running"
      })
    )
    await expect(
      getActiveAgentRunForSession({
        chatSessionId: childRun.chatSessionId,
        db: getDb()
      })
    ).resolves.not.toEqual(
      expect.objectContaining({
        id: childRun.id
      })
    )
  })

  it("does not resume approval tool calls from a different chat session", async () => {
    await ensureDatabaseReady()

    const ownerSession = await createChatSession({ db: getDb() })
    const otherSession = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: ownerSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "tool-call-session-boundary-1",
      input: {
        patch: "*** Begin Patch\n*** End Patch"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "applyPatch"
    })
    await updateAgentRun({
      db: getDb(),
      id: run.id,
      status: "suspended"
    })

    await expect(
      getAgentRunForToolCall({
        chatSessionId: otherSession.id,
        db: getDb(),
        pendingApprovalOnly: true,
        toolCallId: "tool-call-session-boundary-1"
      })
    ).resolves.toBeNull()
    await expect(
      getAgentRunForToolCall({
        chatSessionId: ownerSession.id,
        db: getDb(),
        pendingApprovalOnly: true,
        toolCallId: "tool-call-session-boundary-1"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        chatSessionId: ownerSession.id,
        id: run.id,
        status: "suspended"
      })
    )
  })

  it("lists pending approval tool calls for suspended runs", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "tool-call-approval-1",
      input: {
        command: "vp install"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "runCheck"
    })
    await run.appendEvent({
      payload: {
        approvalId: "approval-1",
        toolCallId: "tool-call-approval-1"
      },
      type: "tool_call_approval_requested"
    })
    await updateAgentRun({
      db: getDb(),
      id: run.id,
      status: "suspended"
    })

    const approvals = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })

    expect(approvals).toEqual([
      expect.objectContaining({
        approvalId: "approval-1",
        approvalState: "pending",
        chatSessionId: session.id,
        id: "tool-call-approval-1",
        input: {
          command: "vp install"
        },
        runId: run.id,
        runStatus: "suspended",
        state: "approval_requested",
        toolName: "runCheck"
      })
    ])
  })

  it("lists pending approval tool calls for running resumed runs", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "tool-call-running-approval-1",
      input: {
        command: "vp install"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "runCheck"
    })
    await run.appendEvent({
      payload: {
        approvalId: "approval-running-1",
        toolCallId: "tool-call-running-approval-1"
      },
      type: "tool_call_approval_requested"
    })

    const approvals = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })

    expect(approvals).toContainEqual(
      expect.objectContaining({
        approvalId: "approval-running-1",
        id: "tool-call-running-approval-1",
        runId: run.id,
        runStatus: "running",
        state: "approval_requested",
        toolName: "runCheck"
      })
    )
  })

  it("persists approval projection rows from approval events", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db,
      id: "tool-call-projection-1",
      input: {
        command: "vp check"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "runCheck"
    })
    await run.appendEvent({
      payload: {
        approvalId: "approval-projection-1",
        input: {
          command: "vp check"
        },
        toolCallId: "tool-call-projection-1",
        toolName: "runCheck"
      },
      type: "tool_call_approval_requested"
    })

    const [pendingProjection] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, "approval-projection-1"))

    expect(pendingProjection).toEqual(
      expect.objectContaining({
        id: "approval-projection-1",
        respondedAt: null,
        responseJson: null,
        runId: run.id,
        state: "pending",
        toolCallId: "tool-call-projection-1",
        toolCallRowId: `${run.id}:tool-call-projection-1`
      })
    )

    await run.appendEvent({
      payload: {
        approvalId: "approval-projection-1",
        approved: true,
        toolCallId: "tool-call-projection-1",
        toolName: "runCheck"
      },
      type: "tool_call_approved"
    })

    const [approvedProjection] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, "approval-projection-1"))
    const approvals = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db
    })

    expect(approvedProjection).toEqual(
      expect.objectContaining({
        id: "approval-projection-1",
        state: "approved"
      })
    )
    expect(approvedProjection?.respondedAt).toEqual(expect.any(String))
    expect(JSON.parse(approvedProjection?.responseJson ?? "{}")).toEqual({
      approvalId: "approval-projection-1",
      approved: true,
      toolCallId: "tool-call-projection-1",
      toolName: "runCheck"
    })
    expect(
      approvals.some(
        (approval) => approval.approvalId === "approval-projection-1"
      )
    ).toBe(false)
  })

  it("resolves pending approval owners while the run is still running", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "tool-call-running-owner-1",
      input: {
        command: "vp install"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "runCheck"
    })

    await expect(
      getAgentRunForToolCall({
        chatSessionId: session.id,
        db: getDb(),
        pendingApprovalOnly: true,
        toolCallId: "tool-call-running-owner-1"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: run.id,
        status: "running"
      })
    )
  })

  it("keeps approval ids scoped by run when provider tool call ids are reused", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const firstRun = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })
    const secondRun = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    for (const [run, approvalId] of [
      [firstRun, "approval-first"],
      [secondRun, "approval-second"]
    ] as const) {
      await recordAgentToolCall({
        approvalState: "pending",
        db: getDb(),
        id: "reused-approval-tool-call",
        input: {
          command: "vp install"
        },
        runId: run.id,
        state: "approval_requested",
        toolName: "runCheck"
      })
      await run.appendEvent({
        payload: {
          approvalId,
          toolCallId: "reused-approval-tool-call"
        },
        type: "tool_call_approval_requested"
      })
      await updateAgentRun({
        db: getDb(),
        id: run.id,
        status: "suspended"
      })
    }

    const approvals = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })
    const approvalIdsByRunId = new Map(
      approvals
        .filter((approval) => approval.id === "reused-approval-tool-call")
        .map((approval) => [approval.runId, approval.approvalId])
    )

    expect(approvalIdsByRunId.get(firstRun.id)).toBe("approval-first")
    expect(approvalIdsByRunId.get(secondRun.id)).toBe("approval-second")
    await expect(
      getAgentRunForToolApproval({
        approvalId: "approval-second",
        chatSessionId: session.id,
        db: getDb(),
        pendingApprovalOnly: true,
        toolCallId: "reused-approval-tool-call"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: secondRun.id
      })
    )
  })

  it("marks interrupted running runs failed while preserving suspended approvals", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const runningRun = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })
    const suspendedRun = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: getDb(),
      id: "restart-tool-call-1",
      input: {
        path: "src/main.ts"
      },
      runId: suspendedRun.id,
      state: "approval_requested",
      toolName: "writeFile"
    })
    await suspendedRun.appendEvent({
      payload: {
        approvalId: "approval-restart-1",
        toolCallId: "restart-tool-call-1"
      },
      type: "tool_call_approval_requested"
    })
    await updateAgentRun({
      db: getDb(),
      id: suspendedRun.id,
      status: "suspended"
    })

    const result = await recoverInterruptedAgentRuns({
      db: getDb()
    })
    const [runningRow] = await getDb()
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runningRun.id))
    const failedEvents = await listAgentEvents({
      db: getDb(),
      runId: runningRun.id
    })
    const pendingApprovals = await listPendingAgentApprovals({
      chatSessionId: session.id,
      db: getDb()
    })

    expect(result.failedRunIds).toContain(runningRun.id)
    expect(result.suspendedRunIds).toContain(suspendedRun.id)
    expect(runningRow).toMatchObject({
      errorMessage: "Agent run was interrupted before the app could finish it.",
      status: "failed"
    })
    expect(failedEvents).toEqual([
      expect.objectContaining({
        payload: {
          error: "Agent run was interrupted before the app could finish it.",
          reason: "app_startup_recovery"
        },
        type: "agent_run_failed"
      })
    ])
    expect(pendingApprovals).toContainEqual(
      expect.objectContaining({
        id: "restart-tool-call-1",
        runId: suspendedRun.id,
        runStatus: "suspended"
      })
    )
  })

  it("lists failed top-level runs as recoverable for the owning session", async () => {
    await ensureDatabaseReady()

    const ownerSession = await createChatSession({ db: getDb() })
    const otherSession = await createChatSession({ db: getDb() })
    const failedRun = await createAgentRun({
      chatSessionId: ownerSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })
    const childFailedRun = await createAgentRun({
      chatSessionId: ownerSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1-mini",
      parentRunId: failedRun.id,
      profileId: "explore"
    })
    const otherFailedRun = await createAgentRun({
      chatSessionId: otherSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })
    const runningRun = await createAgentRun({
      chatSessionId: ownerSession.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await updateAgentRun({
      db: getDb(),
      errorMessage: "Provider stream failed.",
      id: failedRun.id,
      status: "failed"
    })
    await updateAgentRun({
      db: getDb(),
      errorMessage: "Child failed.",
      id: childFailedRun.id,
      status: "failed"
    })
    await updateAgentRun({
      db: getDb(),
      errorMessage: "Other session failed.",
      id: otherFailedRun.id,
      status: "failed"
    })

    const recoverableRuns = await listRecoverableAgentRuns({
      chatSessionId: ownerSession.id,
      db: getDb()
    })

    expect(recoverableRuns).toEqual([
      expect.objectContaining({
        chatSessionId: ownerSession.id,
        errorMessage: "Provider stream failed.",
        id: failedRun.id,
        parentRunId: null,
        status: "failed"
      })
    ])
    expect(recoverableRuns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: childFailedRun.id
        }),
        expect.objectContaining({
          id: otherFailedRun.id
        }),
        expect.objectContaining({
          id: runningRun.id
        })
      ])
    )
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

  it("persists tool output artifact metadata for a run", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })
    const otherSession = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "not_required",
      db,
      id: "artifact-tool-call-1",
      input: {
        command: "vp test run"
      },
      runId: run.id,
      state: "finished",
      toolName: "bash"
    })

    const artifact = await recordAgentArtifact({
      byteLength: 42,
      db,
      kind: "command-output",
      metadata: {
        toolName: "bash"
      },
      path: "/tmp/etyon-agent-output.json",
      runId: run.id,
      toolCallId: "artifact-tool-call-1"
    })
    const artifacts = await listAgentArtifacts({
      db,
      runId: run.id
    })

    expect(artifacts).toEqual([
      expect.objectContaining({
        byteLength: 42,
        id: artifact.id,
        kind: "command-output",
        metadata: {
          toolName: "bash"
        },
        path: "/tmp/etyon-agent-output.json",
        runId: run.id,
        toolCallId: "artifact-tool-call-1"
      })
    ])
    await expect(
      getAgentArtifact({
        artifactId: artifact.id,
        chatSessionId: otherSession.id,
        db
      })
    ).resolves.toBeNull()
    await expect(
      getAgentArtifact({
        artifactId: artifact.id,
        chatSessionId: session.id,
        db
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: artifact.id,
        runId: run.id
      })
    )
  })

  it("catalogs referenced tool output artifacts from tool results", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const artifactContent = "full stdout"
    const artifactPath = `${mockedHomeDir}/referenced-tool-output.json`
    fs.mkdirSync(mockedHomeDir, { recursive: true })
    fs.writeFileSync(artifactPath, artifactContent)

    const session = await createChatSession({ db })
    const run = await createAgentRun({
      chatSessionId: session.id,
      db,
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "not_required",
      db,
      id: "artifact-tool-call-2",
      input: {
        command: "vp check"
      },
      runId: run.id,
      state: "finished",
      toolName: "bash"
    })

    const artifacts = await recordAgentToolOutputArtifacts({
      db,
      output: {
        details: {
          fullOutputPath: artifactPath
        }
      },
      runId: run.id,
      toolCallId: "artifact-tool-call-2",
      toolName: "bash"
    })

    expect(artifacts).toEqual([
      expect.objectContaining({
        byteLength: Buffer.byteLength(artifactContent),
        kind: "command-output",
        metadata: {
          details: {
            fullOutputPath: artifactPath
          },
          toolName: "bash"
        },
        path: artifactPath,
        runId: run.id,
        toolCallId: "artifact-tool-call-2"
      })
    ])
    await expect(
      listAgentArtifacts({
        db,
        runId: run.id
      })
    ).resolves.toEqual(artifacts)
  })
})
