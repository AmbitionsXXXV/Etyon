import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import {
  buildProjectDigestSystemPrompt,
  getProjectMemoryDigest,
  maybeRefreshProjectMemoryDigest,
  shouldRefreshLongTermMemory
} from "@/main/memory/project-digest"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-project-digest-test-${Date.now()}-${Math.random()
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

const createTextMessage = (id: string, text: string): UIMessage => ({
  id,
  parts: [
    {
      text,
      type: "text"
    }
  ],
  role: "user"
})

const buildMessages = (count: number): UIMessage[] =>
  Array.from({ length: count }, (_unused, index) =>
    createTextMessage(`message-${index}`, `Message number ${index + 1}`)
  )

describe("shouldRefreshLongTermMemory", () => {
  it("fires once after the first exchange and then on the configured interval", () => {
    expect(shouldRefreshLongTermMemory(2)).toBe(true)
    expect(shouldRefreshLongTermMemory(6)).toBe(true)
    expect(shouldRefreshLongTermMemory(12)).toBe(true)
  })

  it("skips turns between intervals", () => {
    expect(shouldRefreshLongTermMemory(1)).toBe(false)
    expect(shouldRefreshLongTermMemory(3)).toBe(false)
    expect(shouldRefreshLongTermMemory(5)).toBe(false)
    expect(shouldRefreshLongTermMemory(7)).toBe(false)
  })
})

describe("buildProjectDigestSystemPrompt", () => {
  it("returns an empty string for an empty digest", () => {
    expect(buildProjectDigestSystemPrompt("")).toBe("")
    expect(buildProjectDigestSystemPrompt("   ")).toBe("")
  })

  it("wraps a non-empty digest with framing and a search_memory pointer", () => {
    const prompt = buildProjectDigestSystemPrompt("User prefers dark mode.")

    expect(prompt).toContain("User prefers dark mode.")
    expect(prompt).toContain("search_memory")
  })
})

describe("project memory digest", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("reads back empty when no digest exists yet", async () => {
    await ensureDatabaseReady()

    const digest = await getProjectMemoryDigest(
      getDb(),
      "/tmp/etyon-digest-project-empty"
    )

    expect(digest).toBe("")
  })

  it("does nothing when memory is disabled", async () => {
    await ensureDatabaseReady()

    const projectPath = "/tmp/etyon-digest-project-disabled"
    const settings = AppSettingsSchema.parse({ memory: { enabled: false } })

    await maybeRefreshProjectMemoryDigest({
      db: getDb(),
      messages: buildMessages(2),
      projectPath,
      settings
    })

    expect(await getProjectMemoryDigest(getDb(), projectPath)).toBe("")
  })

  it("creates a digest on the very first call, even below the interval", async () => {
    await ensureDatabaseReady()

    const projectPath = "/tmp/etyon-digest-project-bootstrap"
    const settings = AppSettingsSchema.parse({ memory: { enabled: true } })

    await maybeRefreshProjectMemoryDigest({
      db: getDb(),
      messages: buildMessages(1),
      projectPath,
      settings
    })

    const digest = await getProjectMemoryDigest(getDb(), projectPath)

    expect(digest).toContain("Message number 1")
  })

  it("skips refreshing between intervals, then folds the previous digest forward", async () => {
    await ensureDatabaseReady()

    const projectPath = "/tmp/etyon-digest-project-interval"
    const settings = AppSettingsSchema.parse({ memory: { enabled: true } })
    const db = getDb()

    await maybeRefreshProjectMemoryDigest({
      db,
      messages: buildMessages(2),
      projectPath,
      settings
    })
    const afterFirstRefresh = await getProjectMemoryDigest(db, projectPath)

    // Message count 3 matches neither the bootstrap nor the interval gate.
    await maybeRefreshProjectMemoryDigest({
      db,
      messages: buildMessages(3),
      projectPath,
      settings
    })
    expect(await getProjectMemoryDigest(db, projectPath)).toBe(
      afterFirstRefresh
    )

    // Message count 6 hits the interval gate and should refresh again,
    // carrying the earlier digest forward.
    await maybeRefreshProjectMemoryDigest({
      db,
      messages: buildMessages(6),
      projectPath,
      settings
    })
    const afterSecondRefresh = await getProjectMemoryDigest(db, projectPath)

    expect(afterSecondRefresh).not.toBe(afterFirstRefresh)
    expect(afterSecondRefresh).toContain("Previous digest")
    expect(afterSecondRefresh).toContain("Message number 6")
  })
})
