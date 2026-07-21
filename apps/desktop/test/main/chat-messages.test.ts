import fs from "node:fs"

import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  listChatMessages,
  persistSubmittedChatMessages,
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

  it("checkpoints a submitted prompt without building completed-turn memory", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const messages: UIMessage[] = [
      {
        id: "failed-user-message",
        parts: [{ text: "Keep this prompt when fetch fails", type: "text" }],
        role: "user"
      }
    ]

    await persistSubmittedChatMessages({
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
    expect(updatedSession?.title).toBe("Keep this prompt when fetch fails")
    expect(memory).toBeUndefined()
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
})
