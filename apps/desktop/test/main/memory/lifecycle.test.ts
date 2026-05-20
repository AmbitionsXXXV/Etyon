import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import { isNotNull } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { memoryEntries } from "@/main/db/schema"
import {
  archiveDuplicateMemoryEntries,
  buildMemoryLifecycleDiagnostics
} from "@/main/memory/lifecycle"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-memory-lifecycle-test-${Date.now()}-${Math.random()
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

describe("memory lifecycle", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("archives duplicate active memory entries and reports diagnostics", async () => {
    await ensureDatabaseReady()

    const now = new Date().toISOString()

    await getDb()
      .insert(memoryEntries)
      .values([
        {
          accessCount: 0,
          archivedAt: null,
          content: "Duplicate durable memory",
          createdAt: now,
          id: "duplicate-a",
          kind: "semantic",
          lastAccessedAt: null,
          projectPath: null,
          scope: "global",
          sessionId: null,
          source: "chat-session",
          sourceId: "duplicate-a",
          updatedAt: now
        },
        {
          accessCount: 1,
          archivedAt: null,
          content: "Duplicate durable memory",
          createdAt: now,
          id: "duplicate-b",
          kind: "semantic",
          lastAccessedAt: null,
          projectPath: null,
          scope: "global",
          sessionId: null,
          source: "chat-session",
          sourceId: "duplicate-b",
          updatedAt: now
        }
      ])

    await expect(archiveDuplicateMemoryEntries(getDb())).resolves.toBe(1)

    const archivedRows = await getDb()
      .select()
      .from(memoryEntries)
      .where(isNotNull(memoryEntries.archivedAt))
    const diagnostics = await buildMemoryLifecycleDiagnostics({
      db: getDb(),
      settings: AppSettingsSchema.parse({})
    })

    expect(archivedRows).toHaveLength(1)
    expect(diagnostics).toMatchObject({
      activeEntries: 1,
      archivedEntries: 1,
      duplicateEntries: 0,
      missingEmbeddings: 1
    })
  })
})
