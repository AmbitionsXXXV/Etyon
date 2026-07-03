import fs from "node:fs"

import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { replaceChatMessages } from "@/main/chat-messages"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import type * as ProjectDigest from "@/main/memory/project-digest"

const {
  maybeRefreshProjectMemoryDigestMock,
  mockedAppPath,
  mockedHomeDir,
  upsertChatSessionMemoryEntryMock
} = vi.hoisted(() => ({
  maybeRefreshProjectMemoryDigestMock: vi.fn(() => Promise.resolve()),
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-chat-messages-gating-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`,
  upsertChatSessionMemoryEntryMock: vi.fn(() => Promise.resolve())
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() }
}))

vi.mock("@/main/memory", () => ({
  upsertChatSessionMemoryEntry: upsertChatSessionMemoryEntryMock
}))

vi.mock("@/main/memory/project-digest", async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectDigest>()

  return {
    ...actual,
    maybeRefreshProjectMemoryDigest: maybeRefreshProjectMemoryDigestMock
  }
})

const buildMessages = (count: number): UIMessage[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `message-${index}`,
    parts: [{ text: `Message ${index + 1}`, type: "text" as const }],
    role: (index % 2 === 0 ? "user" : "assistant") as UIMessage["role"]
  }))

describe("replaceChatMessages long-term memory gating", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("skips the long-term memory writes on a turn that doesn't hit the gate", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })

    maybeRefreshProjectMemoryDigestMock.mockClear()
    upsertChatSessionMemoryEntryMock.mockClear()

    // 3 messages hits neither the bootstrap (2) nor the interval (6) gate.
    await replaceChatMessages({
      db: getDb(),
      messages: buildMessages(3),
      sessionId: session.id
    })

    expect(upsertChatSessionMemoryEntryMock).not.toHaveBeenCalled()
    expect(maybeRefreshProjectMemoryDigestMock).not.toHaveBeenCalled()
  })

  it("runs the long-term memory writes once the gate is hit", async () => {
    await ensureDatabaseReady()

    const session = await createChatSession({ db: getDb() })

    maybeRefreshProjectMemoryDigestMock.mockClear()
    upsertChatSessionMemoryEntryMock.mockClear()

    // 2 messages hits the bootstrap gate (first exchange).
    await replaceChatMessages({
      db: getDb(),
      messages: buildMessages(2),
      sessionId: session.id
    })

    expect(upsertChatSessionMemoryEntryMock).toHaveBeenCalledTimes(1)
    expect(maybeRefreshProjectMemoryDigestMock).toHaveBeenCalledTimes(1)
  })
})
