import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test"

import {
  captureBashCheckpoint,
  captureFileCheckpoint,
  CHECKPOINT_MAX_AGE_DAYS,
  CHECKPOINT_MAX_TOTAL_MB,
  getCheckpoint,
  listCheckpoints,
  pruneCheckpoints,
  restoreFileCheckpoint
} from "@/main/agents/checkpoints"
import { getDb } from "@/main/db"
import { getAppConfigDir } from "@/main/db/libsql-paths"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentCheckpoints } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-checkpoints-home-${Date.now()}-${Math.random()
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
    path.join(os.tmpdir(), "etyon-checkpoints-project-")
  )
  projectPaths.push(projectPath)

  return projectPath
}

const getObjectPath = (projectHash: string, sha: string): string =>
  path.join(
    getAppConfigDir(mockedHomeDir),
    "checkpoints",
    projectHash,
    "objects",
    sha.slice(0, 2),
    sha
  )

const captureFile = ({
  origin = "write",
  paths,
  projectPath,
  toolCallId = "tool-1"
}: {
  origin?: "edit" | "write"
  paths: readonly string[]
  projectPath: string
  toolCallId?: string
}) =>
  captureFileCheckpoint({
    origin,
    paths,
    projectPath,
    runId: "run-1",
    toolCallId
  })

beforeAll(async () => {
  await ensureDatabaseReady()
})

afterAll(async () => {
  for (const projectPath of projectPaths) {
    try {
      await pruneCheckpoints({ projectPath })
    } catch (error) {
      void error
    }

    fs.rmSync(projectPath, { force: true, recursive: true })
  }

  fs.rmSync(mockedHomeDir, { force: true, recursive: true })
})

describe("workspace checkpoints", () => {
  it("captures and restores an edited file roundtrip", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "notes.txt")
    fs.writeFileSync(filePath, "before\n")

    const checkpoint = await captureFile({
      origin: "edit",
      paths: ["notes.txt"],
      projectPath
    })
    fs.writeFileSync(filePath, "after\n")

    const result = await restoreFileCheckpoint({
      checkpointId: checkpoint?.id ?? "missing",
      projectPath
    })

    expect(fs.readFileSync(filePath, "utf-8")).toBe("before\n")
    expect(result).toEqual({
      missingBlobs: [],
      restored: ["notes.txt"],
      skipped: []
    })
  })

  it("restores a new-file checkpoint by deleting the created file", async () => {
    const projectPath = createProject()
    const checkpoint = await captureFile({
      paths: ["new.txt"],
      projectPath
    })
    const filePath = path.join(projectPath, "new.txt")
    fs.writeFileSync(filePath, "created later\n")

    const result = await restoreFileCheckpoint({
      checkpointId: checkpoint?.id ?? "missing",
      projectPath
    })

    expect(fs.existsSync(filePath)).toBe(false)
    expect(result.restored).toEqual(["new.txt"])
  })

  it("links sequential captures through the parent chain", async () => {
    const projectPath = createProject()
    fs.writeFileSync(path.join(projectPath, "chain.txt"), "one\n")

    const first = await captureFile({
      paths: ["chain.txt"],
      projectPath,
      toolCallId: "tool-1"
    })
    fs.writeFileSync(path.join(projectPath, "chain.txt"), "two\n")
    const second = await captureFile({
      paths: ["chain.txt"],
      projectPath,
      toolCallId: "tool-2"
    })

    expect(first?.parentId).toBeNull()
    expect(second?.parentId).toBe(first?.id)
  })

  it("silently skips secret paths during capture", async () => {
    const projectPath = createProject()
    fs.writeFileSync(path.join(projectPath, ".env"), "TOKEN=secret\n")

    const checkpoint = await captureFile({
      paths: [".env"],
      projectPath
    })

    expect(checkpoint?.files).toEqual([])
  })

  it("silently skips paths outside the project", async () => {
    const projectPath = createProject()
    const outsidePath = path.join(
      os.tmpdir(),
      `etyon-outside-${Date.now()}.txt`
    )
    fs.writeFileSync(outsidePath, "outside\n")

    try {
      const checkpoint = await captureFile({
        paths: [outsidePath],
        projectPath
      })

      expect(checkpoint?.files).toEqual([])
    } finally {
      fs.rmSync(outsidePath, { force: true })
    }
  })

  it("marks files over 5MB as over-cap and skips them during restore", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "large.bin")
    fs.writeFileSync(filePath, Buffer.alloc(5 * 1024 * 1024 + 1, 1))

    const checkpoint = await captureFile({
      paths: ["large.bin"],
      projectPath
    })
    fs.writeFileSync(filePath, "current\n")
    const result = await restoreFileCheckpoint({
      checkpointId: checkpoint?.id ?? "missing",
      projectPath
    })

    expect(checkpoint?.files).toEqual([
      expect.objectContaining({ overCap: true, path: "large.bin" })
    ])
    expect(fs.readFileSync(filePath, "utf-8")).toBe("current\n")
    expect(result.skipped).toEqual(["large.bin"])
  })

  it("captures dirty and clean git states plus a non-git bash checkpoint", async () => {
    const projectPath = createProject()
    execFileSync("git", ["init"], { cwd: projectPath })
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectPath
    })
    execFileSync("git", ["config", "user.name", "Checkpoint Test"], {
      cwd: projectPath
    })
    fs.writeFileSync(path.join(projectPath, "tracked.txt"), "clean\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectPath })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectPath })

    const clean = await captureBashCheckpoint({
      projectPath,
      runId: "run-git",
      toolCallId: "tool-clean"
    })
    fs.writeFileSync(path.join(projectPath, "tracked.txt"), "dirty\n")
    const dirty = await captureBashCheckpoint({
      projectPath,
      runId: "run-git",
      toolCallId: "tool-dirty"
    })
    const nonGitPath = createProject()
    const nonGit = await captureBashCheckpoint({
      projectPath: nonGitPath,
      runId: "run-non-git",
      toolCallId: "tool-non-git"
    })

    expect(clean?.gitSnapshotRef).toBeNull()
    expect(dirty?.gitSnapshotRef).toMatch(/^[a-f\d]{40,64}$/u)
    expect(nonGit).toMatchObject({ files: [], gitSnapshotRef: null })
  })

  it("prunes expired manifests, orphaned blobs, and oldest checkpoints over budget", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "expired.txt")
    fs.writeFileSync(filePath, "expired content\n")
    const expired = await captureFile({
      paths: ["expired.txt"],
      projectPath,
      toolCallId: "tool-expired"
    })

    if (!expired) {
      throw new Error("Expected expired checkpoint fixture to be captured.")
    }

    const expiredCreatedAt = new Date(
      Date.now() - (CHECKPOINT_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString()
    await runExclusiveDbWrite(() =>
      getDb().transaction((tx) =>
        tx
          .update(agentCheckpoints)
          .set({ createdAt: expiredCreatedAt })
          .where(eq(agentCheckpoints.id, expired.id))
      )
    )

    const orphanSha = "f".repeat(64)
    const orphanPath = getObjectPath(expired.projectHash, orphanSha)
    fs.mkdirSync(path.dirname(orphanPath), { recursive: true })
    fs.writeFileSync(orphanPath, "orphan")

    await pruneCheckpoints({ projectPath })

    expect(await getCheckpoint(expired.id)).toBeNull()
    expect(fs.existsSync(orphanPath)).toBe(false)
    expect(
      fs.existsSync(
        getObjectPath(expired.projectHash, expired.files[0]?.preSha ?? "")
      )
    ).toBe(false)

    const hugeSha = "a".repeat(64)
    const hugeObjectPath = getObjectPath(expired.projectHash, hugeSha)
    fs.mkdirSync(path.dirname(hugeObjectPath), { recursive: true })
    fs.writeFileSync(hugeObjectPath, "")
    fs.truncateSync(hugeObjectPath, (CHECKPOINT_MAX_TOTAL_MB + 1) * 1024 * 1024)
    const oldestId = "budget-oldest"
    const newestId = "budget-newest"
    const nowMs = Date.now()

    await runExclusiveDbWrite(() =>
      getDb().transaction(async (tx) => {
        await tx.insert(agentCheckpoints).values([
          {
            createdAt: new Date(nowMs - 2000).toISOString(),
            filesJson: JSON.stringify([{ path: "huge.bin", preSha: hugeSha }]),
            gitSnapshotRef: null,
            id: oldestId,
            origin: "write",
            parentId: null,
            projectHash: expired.projectHash,
            runId: "run-budget",
            toolCallId: "tool-oldest"
          },
          {
            createdAt: new Date(nowMs - 1000).toISOString(),
            filesJson: "[]",
            gitSnapshotRef: null,
            id: newestId,
            origin: "write",
            parentId: oldestId,
            projectHash: expired.projectHash,
            runId: "run-budget",
            toolCallId: "tool-newest"
          }
        ])
      })
    )

    await pruneCheckpoints({ projectPath })

    expect(await getCheckpoint(oldestId)).toBeNull()
    expect(await getCheckpoint(newestId)).not.toBeNull()
    expect(fs.existsSync(hugeObjectPath)).toBe(false)
  })

  it("restores a restore by using the pre-restore safety checkpoint", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "rewind.txt")
    fs.writeFileSync(filePath, "version one\n")
    const first = await captureFile({
      paths: ["rewind.txt"],
      projectPath,
      toolCallId: "tool-first"
    })
    fs.writeFileSync(filePath, "version two\n")

    await restoreFileCheckpoint({
      checkpointId: first?.id ?? "missing",
      projectPath
    })
    const checkpoints = await listCheckpoints({ projectPath })
    const safetyCheckpoint = checkpoints.find(
      (checkpoint) => checkpoint.id !== first?.id
    )

    await restoreFileCheckpoint({
      checkpointId: safetyCheckpoint?.id ?? "missing",
      projectPath
    })

    expect(fs.readFileSync(filePath, "utf-8")).toBe("version two\n")
  })

  it("returns null without throwing when a file cannot be captured", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "unreadable.txt")
    fs.writeFileSync(filePath, "private\n")
    fs.chmodSync(filePath, 0)

    try {
      await expect(
        captureFile({ paths: ["unreadable.txt"], projectPath })
      ).resolves.toBeNull()
    } finally {
      fs.chmodSync(filePath, 0o600)
    }
  })
})
