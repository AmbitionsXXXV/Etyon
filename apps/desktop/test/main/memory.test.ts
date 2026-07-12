import fs from "node:fs"

import type { MemorySettings } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { replaceChatMessages } from "@/main/chat-messages"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { memoryEmbeddings } from "@/main/db/schema"
import {
  buildMemorySystemPrompt,
  deleteMemoryEntry,
  listMemoryEntries,
  saveAgentMemoryNote,
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
  autoRetrieve: true,
  autoSummarize: false,
  embeddingModel: "",
  enabled: true,
  includeChatbot: true,
  maxContextEntries: 6,
  maxRetrievedMemories: 6,
  memoryToolModel: "__auto__",
  queryRewriting: true,
  shareAcrossProjects: true,
  similarityThreshold: 0.1
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

const createAssistantMessage = (id: string, text: string): UIMessage => ({
  id,
  parts: [
    {
      text,
      type: "text"
    }
  ],
  role: "assistant"
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

    const { entries } = await listMemoryEntries(getDb())

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
        ),
        createAssistantMessage("shared-reply", "Noted, I'll keep that in mind.")
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

  it("skips retrieval when auto retrieve is disabled", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-memory-auto-retrieve"
    })

    await replaceChatMessages({
      db: getDb(),
      messages: [
        createUserMessage(
          "auto-retrieve-message",
          "Remember that the autoskip marker should not be injected when automatic retrieval is disabled."
        )
      ],
      sessionId: session.id
    })

    const prompt = await buildMemorySystemPrompt({
      db: getDb(),
      projectPath: session.projectPath,
      query: "autoskip marker",
      settings: {
        ...enabledMemorySettings,
        autoRetrieve: false
      }
    })

    expect(prompt).toBe("")
  })

  it("paginates and case-insensitively filters memory entries by content", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const marker = "PaginateMarker"

    for (let index = 0; index < 5; index += 1) {
      await saveAgentMemoryNote({
        content: `${marker} entry number ${index} with dense desktop notes.`,
        db,
        projectPath: "/tmp/etyon-memory-pagination"
      })
    }

    const firstPage = await listMemoryEntries(db, {
      limit: 2,
      offset: 0,
      query: marker
    })
    const secondPage = await listMemoryEntries(db, {
      limit: 2,
      offset: 2,
      query: marker
    })
    const lowerCaseSearch = await listMemoryEntries(db, {
      query: marker.toLowerCase()
    })

    expect(firstPage.total).toBe(5)
    expect(firstPage.entries).toHaveLength(2)
    expect(secondPage.entries).toHaveLength(2)
    expect(lowerCaseSearch.total).toBe(5)

    const firstPageIds = new Set(firstPage.entries.map((entry) => entry.id))
    const pagesOverlap = secondPage.entries.some((entry) =>
      firstPageIds.has(entry.id)
    )

    expect(pagesOverlap).toBe(false)
  })

  it("hard-deletes a memory entry along with its embeddings", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const marker = "DeleteMarker"
    const entry = await saveAgentMemoryNote({
      content: `${marker} content to be removed permanently.`,
      db,
      projectPath: "/tmp/etyon-memory-delete"
    })

    expect(entry).toBeDefined()

    if (!entry) {
      return
    }

    const now = new Date().toISOString()

    await db.insert(memoryEmbeddings).values({
      contentHash: "hash-delete-marker",
      createdAt: now,
      dimensions: 3,
      memoryId: entry.id,
      model: "test-embedding-model",
      updatedAt: now,
      vectorJson: JSON.stringify([0.1, 0.2, 0.3])
    })

    const embeddingsBeforeDelete = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.memoryId, entry.id))

    expect(embeddingsBeforeDelete).toHaveLength(1)

    const deleted = await deleteMemoryEntry(db, entry.id)
    const afterList = await listMemoryEntries(db, { query: marker })
    const embeddingsAfterDelete = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.memoryId, entry.id))
    const deletedAgain = await deleteMemoryEntry(db, entry.id)

    expect(deleted).toBe(true)
    expect(afterList.total).toBe(0)
    expect(embeddingsAfterDelete).toHaveLength(0)
    expect(deletedAgain).toBe(false)
  })
})
