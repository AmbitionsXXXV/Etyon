import fs from "node:fs"

import type { MemorySettings } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { replaceChatMessages } from "@/main/chat-messages"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import {
  buildMemorySystemPrompt,
  listMemoryEntries,
  upsertChatSessionMemoryEntry
} from "@/main/memory"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-memory-test-${Date.now()}-${Math.random()
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

const enabledMemorySettings: MemorySettings = {
  enabled: true,
  includeChatbot: true,
  maxContextEntries: 6,
  shareAcrossProjects: true
}

const projectOnlyMemorySettings: MemorySettings = {
  ...enabledMemorySettings,
  shareAcrossProjects: false
}

const createUserMessage = (id: string, text: string): UIMessage => ({
  id,
  parts: [
    {
      text,
      type: "text"
    }
  ],
  role: "user"
})

describe("memory", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("upserts one project memory entry for a chat session", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-project-a"
    })

    await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [
        createUserMessage(
          "message-1",
          "Remember that Etyon stores renderer feature helpers under renderer/lib."
        )
      ],
      session
    })
    await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [
        createUserMessage(
          "message-2",
          "Remember that Etyon settings panels should keep dense desktop spacing."
        )
      ],
      session
    })

    const entries = await listMemoryEntries(getDb())

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      content: expect.stringContaining("dense desktop spacing"),
      projectPath: session.projectPath,
      sessionId: session.id,
      source: "chat-session"
    })
  })

  it("retrieves memory across projects only when sharing is enabled", async () => {
    await ensureDatabaseReady()

    const sourceSession = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-project-source"
    })
    const targetSession = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-project-target"
    })

    await replaceChatMessages({
      db: getDb(),
      messages: [
        createUserMessage(
          "shared-message",
          "Remember that Awesome-AI-Memory inspired memory should expose lifecycle retrieval."
        )
      ],
      sessionId: sourceSession.id
    })

    const sharedPrompt = await buildMemorySystemPrompt({
      db: getDb(),
      projectPath: targetSession.projectPath,
      query: "How should lifecycle retrieval work?",
      settings: enabledMemorySettings
    })
    const projectOnlyPrompt = await buildMemorySystemPrompt({
      db: getDb(),
      projectPath: targetSession.projectPath,
      query: "How should lifecycle retrieval work?",
      settings: projectOnlyMemorySettings
    })

    expect(sharedPrompt).toContain("lifecycle retrieval")
    expect(projectOnlyPrompt).not.toContain("lifecycle retrieval")
  })
})
