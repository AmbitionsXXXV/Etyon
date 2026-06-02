import fs from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  archiveChatSession,
  archiveProjectChatSessions,
  createChatSession,
  listChatSessions,
  openChatSession,
  removeProjectChatSessions,
  setChatSessionModel,
  setChatSessionPinned
} from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { chatSessions } from "@/main/db/schema"

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

  it("keeps session list order when a session is opened without new messages", async () => {
    await ensureDatabaseReady()

    const firstSession = await createChatSession({ db: getDb() })
    await delay(10)
    const secondSession = await createChatSession({ db: getDb() })

    await delay(10)
    const reopenedSession = await openChatSession({
      db: getDb(),
      sessionId: firstSession.id
    })

    const sessions = await listChatSessions(getDb())

    expect(reopenedSession.lastOpenedAt > firstSession.lastOpenedAt).toBe(true)
    expect(secondSession.id).not.toBe(firstSession.id)
    expect(sessions[0]?.id).toBe(secondSession.id)
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

  it("archives chat sessions by hiding them from the active list", async () => {
    await ensureDatabaseReady()

    const fallbackSession = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-active-project-context"
    })

    await delay(10)

    const session = await createChatSession({
      db: getDb(),
      projectPath: "/tmp/etyon-archived-project-context"
    })
    const archivedSession = await archiveChatSession({
      db: getDb(),
      sessionId: session.id
    })
    const nextSession = await createChatSession({
      currentSessionId: session.id,
      db: getDb()
    })
    const sessions = await listChatSessions(getDb())

    expect(archivedSession.archivedAt).toBeTruthy()
    expect(nextSession.projectPath).toBe(fallbackSession.projectPath)
    expect(sessions.some((item) => item.id === session.id)).toBe(false)
  })

  it("archives all active chat sessions for a project", async () => {
    await ensureDatabaseReady()

    const projectPath = "/tmp/etyon-project-archive"
    const firstSession = await createChatSession({
      db: getDb(),
      projectPath
    })
    const secondSession = await createChatSession({
      db: getDb(),
      projectPath
    })

    await archiveProjectChatSessions({
      db: getDb(),
      projectPath
    })

    const sessions = await listChatSessions(getDb())

    expect(sessions.some((item) => item.id === firstSession.id)).toBe(false)
    expect(sessions.some((item) => item.id === secondSession.id)).toBe(false)
  })

  it("removes all chat session rows for a project", async () => {
    await ensureDatabaseReady()

    const projectPath = "/tmp/etyon-project-remove"
    const session = await createChatSession({
      db: getDb(),
      projectPath
    })

    await archiveChatSession({
      db: getDb(),
      sessionId: session.id
    })
    await removeProjectChatSessions({
      db: getDb(),
      projectPath
    })

    const rows = await getDb()
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.projectPath, projectPath))

    expect(rows).toEqual([])
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
