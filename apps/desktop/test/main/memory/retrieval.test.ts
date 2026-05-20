import fs from "node:fs"

import type { MemorySettings } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { upsertChatSessionMemoryEntry } from "@/main/memory"
import { upsertMemoryEmbedding } from "@/main/memory/embeddings"
import { retrieveMemoryEntries } from "@/main/memory/retrieval"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-memory-retrieval-test-${Date.now()}-${Math.random()
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
  maxContextEntries: 6,
  maxRetrievedMemories: 6,
  memoryToolModel: "__auto__",
  queryRewriting: false,
  shareAcrossProjects: true,
  similarityThreshold: 0.5
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

describe("memory retrieval", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("uses vector similarity when lexical query terms do not match", async () => {
    await ensureDatabaseReady()

    const firstSession = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-vector-a"
    })
    const secondSession = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-vector-b"
    })
    const firstEntry = await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [createUserMessage("first", "Alpha durable preference.")],
      session: firstSession
    })
    const secondEntry = await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [createUserMessage("second", "Beta durable preference.")],
      session: secondSession
    })

    if (!(firstEntry && secondEntry)) {
      throw new Error("Expected memory entries")
    }

    await upsertMemoryEmbedding({
      db: getDb(),
      entry: firstEntry,
      provider: {
        embed: () => Promise.resolve([1, 0]),
        model: "text-embedding-3-small"
      },
      settings: {} as never
    })
    await upsertMemoryEmbedding({
      db: getDb(),
      entry: secondEntry,
      provider: {
        embed: () => Promise.resolve([0, 1]),
        model: "text-embedding-3-small"
      },
      settings: {} as never
    })

    const entries = await retrieveMemoryEntries({
      db: getDb(),
      embeddingModel: "",
      projectPath: firstSession.projectPath,
      query: "unrelated query",
      queryEmbedding: [1, 0],
      settings: enabledMemorySettings
    })

    expect(entries[0]?.id).toBe(firstEntry.id)
  })
})
