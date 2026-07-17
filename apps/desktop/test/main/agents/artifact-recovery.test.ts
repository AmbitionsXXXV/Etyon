import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test"

import { startAgentRun } from "@/main/agents/agent-event-store"
import { readArtifactFileWithRecovery } from "@/main/agents/artifact-recovery"
import {
  captureBashCheckpoint,
  captureFileCheckpoint
} from "@/main/agents/checkpoints"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentArtifacts } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-artifact-recovery-home-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
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

const projectPaths: string[] = []

const createProject = (): string => {
  const projectPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "etyon-artifact-recovery-project-")
  )
  projectPaths.push(projectPath)

  return projectPath
}

const initGitRepo = (projectPath: string): void => {
  execFileSync("git", ["init"], { cwd: projectPath })
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: projectPath
  })
  execFileSync("git", ["config", "user.name", "Recovery Test"], {
    cwd: projectPath
  })
}

beforeAll(async () => {
  await ensureDatabaseReady()
})

afterAll(() => {
  for (const projectPath of projectPaths) {
    fs.rmSync(projectPath, { force: true, recursive: true })
  }

  fs.rmSync(mockedHomeDir, { force: true, recursive: true })
})

describe("readArtifactFileWithRecovery", () => {
  it("reads a present artifact on the fast path without flags", async () => {
    const db = getDb()
    const projectPath = createProject()
    const session = await createChatSession({ db, projectPath })
    fs.mkdirSync(path.join(projectPath, "artifacts"), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, "artifacts", "report.html"),
      "<h1>hi</h1>\n"
    )

    const result = await readArtifactFileWithRecovery({
      db,
      filePath: "artifacts/report.html",
      sessionId: session.id
    })

    expect(result).toEqual({
      content: "<h1>hi</h1>\n",
      language: "html",
      relativePath: "artifacts/report.html",
      restoredFromSnapshot: false,
      status: "ok",
      workspaceRecreated: false
    })
  })

  it("recreates a deleted project directory and reports a terminal miss", async () => {
    const db = getDb()
    const projectPath = createProject()
    const session = await createChatSession({ db, projectPath })
    fs.rmSync(projectPath, { force: true, recursive: true })

    const result = await readArtifactFileWithRecovery({
      db,
      filePath: "artifacts/report.html",
      sessionId: session.id
    })

    expect(result).toEqual({
      reason: "file-missing",
      status: "error",
      workspaceRecreated: true
    })
    expect(fs.existsSync(session.projectPath)).toBe(true)
  })

  it("restores a deleted file from a blob checkpoint then serves it directly", async () => {
    const db = getDb()
    const projectPath = createProject()
    const session = await createChatSession({ db, projectPath })
    const filePath = path.join(projectPath, "report.html")
    fs.writeFileSync(filePath, "<h1>published</h1>\n")
    await captureFileCheckpoint({
      origin: "write",
      paths: ["report.html"],
      projectPath,
      runId: "run-blob",
      toolCallId: "tc-blob"
    })
    fs.rmSync(filePath)

    const restored = await readArtifactFileWithRecovery({
      db,
      filePath: "report.html",
      sessionId: session.id
    })

    expect(restored).toMatchObject({
      content: "<h1>published</h1>\n",
      restoredFromSnapshot: true,
      status: "ok",
      workspaceRecreated: false
    })

    const reread = await readArtifactFileWithRecovery({
      db,
      filePath: "report.html",
      sessionId: session.id
    })

    expect(reread).toMatchObject({
      content: "<h1>published</h1>\n",
      restoredFromSnapshot: false,
      status: "ok"
    })
  })

  it("restores a deleted file from a git snapshot", async () => {
    const db = getDb()
    const projectPath = createProject()
    initGitRepo(projectPath)
    const filePath = path.join(projectPath, "report.html")
    fs.writeFileSync(filePath, "<h1>committed</h1>\n")
    execFileSync("git", ["add", "."], { cwd: projectPath })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectPath })
    fs.writeFileSync(filePath, "<h1>dirty</h1>\n")
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-git",
      toolCallId: "tc-git"
    })

    if (!checkpoint?.gitSnapshotRef) {
      throw new Error("expected a git snapshot fixture")
    }

    const session = await createChatSession({ db, projectPath })
    fs.rmSync(filePath)

    const result = await readArtifactFileWithRecovery({
      db,
      filePath: "report.html",
      sessionId: session.id
    })

    expect(result).toMatchObject({
      content: "<h1>dirty</h1>\n",
      restoredFromSnapshot: true,
      status: "ok"
    })
  })

  it("re-resolves a stale transcript path through the durable record", async () => {
    const db = getDb()
    const projectPath = createProject()
    const session = await createChatSession({ db, projectPath })
    fs.mkdirSync(path.join(projectPath, "artifacts"), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, "artifacts", "report.html"),
      "<h1>durable</h1>\n"
    )
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId: "general-purpose"
    })
    await runExclusiveDbWrite(() =>
      getDb()
        .insert(agentArtifacts)
        .values({
          byteLength: null,
          createdAt: new Date().toISOString(),
          id: `${runId}:tc-real`,
          kind: "html",
          metadataJson: "{}",
          path: "artifacts/report.html",
          runId,
          toolCallId: "tc-real"
        })
    )

    const result = await readArtifactFileWithRecovery({
      db,
      filePath: "report.html",
      sessionId: session.id,
      toolCallId: "tc-real"
    })

    expect(result).toEqual({
      content: "<h1>durable</h1>\n",
      language: "html",
      relativePath: "artifacts/report.html",
      restoredFromSnapshot: false,
      status: "ok",
      workspaceRecreated: false
    })
  })

  it("returns an outside-project error without attempting recovery", async () => {
    const db = getDb()
    const projectPath = createProject()
    const session = await createChatSession({ db, projectPath })

    const result = await readArtifactFileWithRecovery({
      db,
      filePath: "../escape.html",
      sessionId: session.id
    })

    expect(result).toEqual({
      reason: "outside-project",
      status: "error",
      workspaceRecreated: false
    })
  })

  it("throws for an unknown session", async () => {
    const db = getDb()

    await expect(
      readArtifactFileWithRecovery({
        db,
        filePath: "report.html",
        sessionId: "does-not-exist"
      })
    ).rejects.toThrow("Chat session not found: does-not-exist")
  })
})
