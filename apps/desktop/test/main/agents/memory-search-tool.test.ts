import fs from "node:fs"

import type { MemorySettings } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { executeAgentTool } from "@/main/agents/tool-registry"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { upsertChatSessionMemoryEntry } from "@/main/memory"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-memory-search-test-${Date.now()}-${Math.random()
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
  autoRetrieve: true,
  autoSummarize: false,
  embeddingModel: "",
  enabled: true,
  includeChatbot: true,
  maxContextEntries: 3,
  maxRetrievedMemories: 3,
  memoryToolModel: "__auto__",
  queryRewriting: false,
  shareAcrossProjects: false,
  similarityThreshold: 0.1
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

describe("agent memorySearch tool", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("retrieves scoped memory entries through the agent tool boundary", async () => {
    await ensureDatabaseReady()

    const currentProjectPath = "/tmp/etyon-agent-memory-search-current"
    const otherProjectPath = "/tmp/etyon-agent-memory-search-other"
    const currentSession = await createChatSession({
      db: getDb(),
      projectPath: currentProjectPath
    })
    const otherSession = await createChatSession({
      db: getDb(),
      projectPath: otherProjectPath
    })

    await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [
        createUserMessage("current", "Alpha agent memory belongs here.")
      ],
      session: currentSession
    })
    await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [
        createUserMessage("other", "Alpha agent memory is elsewhere.")
      ],
      session: otherSession
    })

    const result = await executeAgentTool({
      db: getDb(),
      input: {
        limit: 5,
        query: "Alpha agent memory"
      },
      memorySettings: enabledMemorySettings,
      name: "memorySearch",
      projectPath: currentProjectPath
    })

    expect(result).toMatchObject({
      query: "Alpha agent memory",
      truncated: false
    })

    if (!("entries" in result) || !("query" in result)) {
      throw new Error("Expected memorySearch output.")
    }

    expect(result.entries).toHaveLength(1)
    const [entry] = result.entries

    if (!entry || !("content" in entry)) {
      throw new Error("Expected memorySearch entry output.")
    }

    expect(entry).toMatchObject({
      projectPath: currentProjectPath,
      scope: "project"
    })
    expect(entry.content).toContain("Alpha agent memory belongs here.")
  })
})
