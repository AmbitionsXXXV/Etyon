import fs from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

import { afterAll, describe, expect, it, vi } from "vitest"

import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

import {
  createChatSession,
  listChatSessions,
  openChatSession,
  setChatSessionModel,
  setChatSessionPinned
} from "./chat-sessions"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-chat-sessions-test-${Date.now()}-${Math.random()
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

describe("chat sessions", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("falls back to the app config directory for the first session", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })

    expect(session.projectPath).toBe(`${mockedHomeDir}/.config/etyon`)
    expect(fs.existsSync(session.projectPath)).toBe(true)
  })

  it("inherits the current session project path when creating a new session", async () => {
    await ensureDatabaseReady()

    const firstSession = await createChatSession({ db: getDb() })
    const secondSession = await createChatSession({
      currentSessionId: firstSession.id,
      db: getDb()
    })

    expect(secondSession.projectPath).toBe(firstSession.projectPath)
  })

  it("creates a session for an explicitly selected project path", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-explicit-project"
    })

    expect(session.projectPath).toBe("/tmp/etyon-explicit-project")
    expect(fs.existsSync(session.projectPath)).toBe(true)
  })

  it("sorts by last opened at and updates the order when a session is reopened", async () => {
    await ensureDatabaseReady()

    const firstSession = await createChatSession({ db: getDb() })
    const secondSession = await createChatSession({ db: getDb() })

    await delay(10)
    const reopenedSession = await openChatSession({
      db: getDb(),
      sessionId: firstSession.id
    })

    const sessions = await listChatSessions(getDb())

    expect(reopenedSession.lastOpenedAt > firstSession.lastOpenedAt).toBe(true)
    expect(secondSession.id).not.toBe(firstSession.id)
    expect(sessions[0]?.id).toBe(firstSession.id)
  })

  it("persists pinned state for a chat session", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const pinnedSession = await setChatSessionPinned({
      db: getDb(),
      pinned: true,
      sessionId: session.id
    })
    const unpinnedSession = await setChatSessionPinned({
      db: getDb(),
      pinned: false,
      sessionId: session.id
    })

    expect(pinnedSession.pinnedAt).toBeTruthy()
    expect(unpinnedSession.pinnedAt).toBeNull()
  })

  it("persists a selected model for a chat session", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })
    const updatedSession = await setChatSessionModel({
      db: getDb(),
      modelId: "moonshot/kimi-k2.5",
      sessionId: session.id
    })
    const listedSessions = await listChatSessions(getDb())
    const listedSession = listedSessions.find((item) => item.id === session.id)

    expect(session.modelId).toBeNull()
    expect(updatedSession.modelId).toBe("moonshot/kimi-k2.5")
    expect(listedSession?.modelId).toBe("moonshot/kimi-k2.5")
  })
})
