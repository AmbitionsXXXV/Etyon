import fs from "node:fs"

import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { createAgentRun, updateAgentRun } from "@/main/agents/agent-event-store"
import {
  appendAgentSessionChatBranchEvent,
  appendAgentSessionModelMessageEvents
} from "@/main/agents/agent-session-events"
import {
  listChatMessages,
  listChatMessagesWithAgentProjectionRepair,
  replaceChatMessages
} from "@/main/chat-messages"
import { getChatSessionMemory } from "@/main/chat-session-memory"
import { createChatSession, getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-chat-messages-test-${Date.now()}-${Math.random()
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

describe("chat messages", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("persists UI messages, updates session title, and builds session memory", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const messages: UIMessage[] = [
      {
        id: "user-message-1",
        metadata: {
          mentions: [
            {
              kind: "file",
              path: "/tmp/project-a/src/main.ts",
              relativePath: "src/main.ts",
              snapshotId: "snapshot-1"
            }
          ]
        },
        parts: [
          {
            text: "Please remember this architecture note",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "assistant-message-1",
        parts: [
          {
            text: "Saved as session context.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    await replaceChatMessages({
      db: getDb(),
      messages,
      sessionId: session.id
    })

    const listedMessages = await listChatMessages({
      db: getDb(),
      sessionId: session.id
    })
    const updatedSession = await getChatSessionById(getDb(), session.id)
    const memory = await getChatSessionMemory(getDb(), session.id)

    expect(listedMessages).toEqual(messages)
    expect(updatedSession?.title).toBe("Please remember this architecture note")
    expect(memory).toMatchObject({
      content: expect.stringContaining(
        "Please remember this architecture note"
      ),
      messageCount: 2,
      sessionId: session.id
    })
  })

  it("normalizes blank and duplicate message ids before persistence", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const messages: UIMessage[] = [
      {
        id: "",
        parts: [
          {
            text: "hello",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "",
        parts: [
          {
            text: "Hello! How can I help?",
            type: "text"
          }
        ],
        role: "assistant"
      },
      {
        id: "assistant-message-1",
        parts: [
          {
            text: "who are you",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "assistant-message-1",
        parts: [
          {
            text: "I am an AI assistant.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    await replaceChatMessages({
      db: getDb(),
      messages,
      sessionId: session.id
    })

    const listedMessages = await listChatMessages({
      db: getDb(),
      sessionId: session.id
    })
    const messageIds = listedMessages.map((message) => message.id)

    expect(messageIds.every(Boolean)).toBe(true)
    expect(new Set(messageIds).size).toBe(messageIds.length)
    expect(messageIds).toContain("assistant-message-1")
    expect(
      messageIds.filter((messageId) =>
        messageId.startsWith("etyon-generated-message-")
      )
    ).toHaveLength(3)
    expect(listedMessages.map((message) => message.parts)).toEqual(
      messages.map((message) => message.parts)
    )
  })

  it("repairs missing assistant chat projection from the latest completed agent run", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const userMessage: UIMessage = {
      id: "user-message-1",
      parts: [
        {
          text: "Fix the agent projection",
          type: "text"
        }
      ],
      role: "user"
    }

    await replaceChatMessages({
      db: getDb(),
      messages: [userMessage],
      sessionId: session.id
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
          content: "Fix the agent projection",
          role: "user"
        },
        {
          content: "Projection repaired from agent events.",
          role: "assistant"
        }
      ],
      run
    })
    await updateAgentRun({
      db: getDb(),
      id: run.id,
      status: "succeeded"
    })

    const repairedMessages = await listChatMessagesWithAgentProjectionRepair({
      db: getDb(),
      sessionId: session.id
    })
    const persistedMessages = await listChatMessages({
      db: getDb(),
      sessionId: session.id
    })

    expect(repairedMessages).toEqual([
      userMessage,
      {
        id: `agent-${run.id}-1-assistant`,
        metadata: {
          agentProjection: {
            runId: run.id,
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Projection repaired from agent events.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
    expect(persistedMessages).toEqual(repairedMessages)
  })

  it("temporarily projects active agent stream snapshots without persisting them", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const userMessage: UIMessage = {
      id: "user-message-1",
      parts: [
        {
          text: "Keep showing the active run",
          type: "text"
        }
      ],
      role: "user"
    }

    await replaceChatMessages({
      db: getDb(),
      messages: [userMessage],
      sessionId: session.id
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
          content: "Keep showing the active run",
          role: "user"
        }
      ],
      run
    })
    await run.appendEvent({
      payload: {
        parts: [
          {
            text: "Working from durable stream snapshot.",
            type: "text"
          },
          {
            input: {
              path: "package.json"
            },
            state: "input-available",
            toolCallId: "tool-1",
            toolName: "read",
            type: "dynamic-tool"
          }
        ]
      },
      type: "agent_ui_stream_snapshot_created"
    })

    const repairedMessages = await listChatMessagesWithAgentProjectionRepair({
      db: getDb(),
      sessionId: session.id
    })
    const persistedMessages = await listChatMessages({
      db: getDb(),
      sessionId: session.id
    })

    expect(repairedMessages).toEqual([
      userMessage,
      {
        id: `agent-${run.id}-1-assistant`,
        metadata: {
          agentProjection: {
            runId: run.id,
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Working from durable stream snapshot.",
            type: "text"
          },
          {
            input: {
              path: "package.json"
            },
            state: "input-available",
            toolCallId: "tool-1",
            toolName: "read",
            type: "dynamic-tool"
          }
        ],
        role: "assistant"
      }
    ])
    expect(persistedMessages).toEqual([userMessage])
  })

  it("repairs regenerated branch projections without keeping the old suffix", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const userMessage: UIMessage = {
      id: "user-message-1",
      parts: [
        {
          text: "Regenerate this answer",
          type: "text"
        }
      ],
      role: "user"
    }
    const oldAssistantMessage: UIMessage = {
      id: "assistant-message-1",
      parts: [
        {
          text: "Old projected answer.",
          type: "text"
        }
      ],
      role: "assistant"
    }

    await replaceChatMessages({
      db: getDb(),
      messages: [userMessage, oldAssistantMessage],
      sessionId: session.id
    })

    const run = await createAgentRun({
      chatSessionId: session.id,
      db: getDb(),
      modelId: "openai/gpt-4.1",
      profileId: "coder"
    })

    await appendAgentSessionChatBranchEvent({
      branchKind: "regenerate",
      messageId: oldAssistantMessage.id,
      retainedMessageIds: [userMessage.id],
      run,
      trigger: "regenerate-message"
    })
    await appendAgentSessionModelMessageEvents({
      messages: [
        {
          content: "Regenerate this answer",
          role: "user"
        },
        {
          content: "Regenerated answer from agent events.",
          role: "assistant"
        }
      ],
      run
    })
    await updateAgentRun({
      db: getDb(),
      id: run.id,
      status: "succeeded"
    })

    const repairedMessages = await listChatMessagesWithAgentProjectionRepair({
      db: getDb(),
      sessionId: session.id
    })

    expect(repairedMessages).toEqual([
      userMessage,
      {
        id: `agent-${run.id}-1-assistant`,
        metadata: {
          agentProjection: {
            runId: run.id,
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Regenerated answer from agent events.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })
})
