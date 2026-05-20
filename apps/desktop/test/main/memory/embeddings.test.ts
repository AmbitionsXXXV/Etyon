import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { memoryEmbeddings } from "@/main/db/schema"
import { upsertChatSessionMemoryEntry } from "@/main/memory"
import { listMemoryEmbeddingModels } from "@/main/memory/embedding-models"
import { upsertMemoryEmbedding } from "@/main/memory/embeddings"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-memory-embeddings-test-${Date.now()}-${Math.random()
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

describe("memory embeddings", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("lists default and local embedding model status", () => {
    const { models } = listMemoryEmbeddingModels()

    expect(models[0]).toMatchObject({
      id: "",
      isDefault: true,
      label: "text-embedding-3-small",
      source: "default",
      status: "available"
    })
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local:minilm-l6-v2",
          status: "available"
        }),
        expect.objectContaining({
          id: "local:bge-small-en-v1.5",
          status: "missing"
        })
      ])
    )
  })

  it("persists memory embeddings and skips unchanged content", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-embedding-project"
    })
    const entry = await upsertChatSessionMemoryEntry({
      db: getDb(),
      messages: [
        createUserMessage(
          "embedding-message",
          "Remember that memory embeddings should be persisted locally."
        )
      ],
      session
    })
    const provider = {
      embed: vi.fn(() => Promise.resolve([0.1, 0.2, 0.3])),
      model: "test-embedding-model"
    }

    if (!entry) {
      throw new Error("Expected memory entry")
    }

    await upsertMemoryEmbedding({
      db: getDb(),
      entry,
      provider,
      settings: AppSettingsSchema.parse({})
    })
    await upsertMemoryEmbedding({
      db: getDb(),
      entry,
      provider,
      settings: AppSettingsSchema.parse({})
    })

    const rows = await getDb().select().from(memoryEmbeddings)

    expect(provider.embed).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      dimensions: 3,
      memoryId: entry.id,
      model: "test-embedding-model",
      vectorJson: JSON.stringify([0.1, 0.2, 0.3])
    })
  })
})
