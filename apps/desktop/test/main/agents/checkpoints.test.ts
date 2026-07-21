import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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
  restoreBashCheckpoint,
  restoreFileCheckpoint,
  restoreSingleFileFromCheckpoints
} from "@/main/agents/checkpoints"
import { getAppConfigDir } from "@/main/app-paths"
import { getDb } from "@/main/db"
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

const RESTORE_MAX_BYTES = 2 * 1024 * 1024

const initGitRepo = (projectPath: string): void => {
  execFileSync("git", ["init"], { cwd: projectPath })
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: projectPath
  })
  execFileSync("git", ["config", "user.name", "Checkpoint Test"], {
    cwd: projectPath
  })
}

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

  it("restores a captured dirty bash snapshot and creates a safety checkpoint", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "tracked.txt")
    execFileSync("git", ["init"], { cwd: projectPath })
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectPath
    })
    execFileSync("git", ["config", "user.name", "Checkpoint Test"], {
      cwd: projectPath
    })
    fs.writeFileSync(filePath, "clean\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectPath })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectPath })
    fs.writeFileSync(filePath, "captured dirty state\n")
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-restore",
      toolCallId: "tool-restore"
    })
    fs.writeFileSync(filePath, "changed after capture\n")

    const result = await restoreBashCheckpoint({
      checkpointId: checkpoint?.id ?? "missing",
      projectPath
    })
    const safetyCheckpointId = result.ok ? result.safetyCheckpointId : null
    const checkpoints = await listCheckpoints({ projectPath })
    const safetyCheckpoint = checkpoints.find(
      (candidate) => candidate.id === safetyCheckpointId
    )

    expect(result.ok).toBe(true)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("captured dirty state\n")
    expect(safetyCheckpoint).toMatchObject({
      origin: "bash",
      runId: "run-restore",
      toolCallId: "tool-restore"
    })
  })

  it("returns no-snapshot for a bash checkpoint without a git snapshot", async () => {
    const projectPath = createProject()
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-no-snapshot",
      toolCallId: "tool-no-snapshot"
    })

    await expect(
      restoreBashCheckpoint({
        checkpointId: checkpoint?.id ?? "missing",
        projectPath
      })
    ).resolves.toEqual({ ok: false, reason: "no-snapshot" })
  })

  it("rejects non-bash and unknown checkpoint ids", async () => {
    const projectPath = createProject()
    const checkpoint = await captureFile({ paths: [], projectPath })

    await expect(
      restoreBashCheckpoint({
        checkpointId: checkpoint?.id ?? "missing",
        projectPath
      })
    ).resolves.toEqual({ ok: false, reason: "not-bash" })
    await expect(
      restoreBashCheckpoint({
        checkpointId: "unknown-checkpoint",
        projectPath
      })
    ).resolves.toEqual({ ok: false, reason: "not-found" })
  })

  it("returns snapshot-missing when the captured git object was pruned", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "tracked.txt")
    execFileSync("git", ["init"], { cwd: projectPath })
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectPath
    })
    execFileSync("git", ["config", "user.name", "Checkpoint Test"], {
      cwd: projectPath
    })
    fs.writeFileSync(filePath, "clean\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectPath })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectPath })
    fs.writeFileSync(filePath, "dirty\n")
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-pruned",
      toolCallId: "tool-pruned"
    })

    if (!checkpoint?.gitSnapshotRef) {
      throw new Error("Expected a Git snapshot fixture.")
    }

    const snapshotObjectPath = path.join(
      projectPath,
      ".git",
      "objects",
      checkpoint.gitSnapshotRef.slice(0, 2),
      checkpoint.gitSnapshotRef.slice(2)
    )
    fs.rmSync(snapshotObjectPath)

    await expect(
      restoreBashCheckpoint({
        checkpointId: checkpoint.id,
        projectPath
      })
    ).resolves.toEqual({ ok: false, reason: "snapshot-missing" })
  })

  it("returns merge-in-progress when MERGE_HEAD exists", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "tracked.txt")
    execFileSync("git", ["init"], { cwd: projectPath })
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectPath
    })
    execFileSync("git", ["config", "user.name", "Checkpoint Test"], {
      cwd: projectPath
    })
    fs.writeFileSync(filePath, "clean\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: projectPath })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectPath })
    fs.writeFileSync(filePath, "dirty\n")
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-merge",
      toolCallId: "tool-merge"
    })
    fs.writeFileSync(path.join(projectPath, ".git", "MERGE_HEAD"), "")

    await expect(
      restoreBashCheckpoint({
        checkpointId: checkpoint?.id ?? "missing",
        projectPath
      })
    ).resolves.toEqual({ ok: false, reason: "merge-in-progress" })
  })

  it("returns not-a-repo when the checkpoint project has no git repository", async () => {
    const projectPath = createProject()
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-not-repo",
      toolCallId: "tool-not-repo"
    })

    if (!checkpoint) {
      throw new Error("Expected a bash checkpoint fixture.")
    }

    await runExclusiveDbWrite(() =>
      getDb().transaction((tx) =>
        tx
          .update(agentCheckpoints)
          .set({ gitSnapshotRef: "a".repeat(40) })
          .where(eq(agentCheckpoints.id, checkpoint.id))
      )
    )

    await expect(
      restoreBashCheckpoint({
        checkpointId: checkpoint.id,
        projectPath
      })
    ).resolves.toEqual({ ok: false, reason: "not-a-repo" })
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

describe("restoreSingleFileFromCheckpoints", () => {
  it("restores the newest blob pre-image for a deleted file", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "report.html")
    fs.writeFileSync(filePath, "v1\n")
    await captureFile({
      paths: ["report.html"],
      projectPath,
      toolCallId: "tool-v1"
    })
    fs.writeFileSync(filePath, "v2\n")
    const newest = await captureFile({
      paths: ["report.html"],
      projectPath,
      toolCallId: "tool-v2"
    })

    if (!newest) {
      throw new Error("expected a newest checkpoint fixture")
    }

    fs.rmSync(filePath)

    const result = await restoreSingleFileFromCheckpoints({
      maxBytes: RESTORE_MAX_BYTES,
      projectPath,
      relativePath: "report.html"
    })

    expect(result).toEqual({
      checkpointId: newest.id,
      ok: true,
      source: "checkpoint-blob"
    })
    expect(fs.readFileSync(filePath, "utf-8")).toBe("v2\n")
  })

  it("extracts one file from a git snapshot without touching siblings", async () => {
    const projectPath = createProject()
    initGitRepo(projectPath)
    const fileA = path.join(projectPath, "a.txt")
    const fileB = path.join(projectPath, "b.txt")
    fs.writeFileSync(fileA, "committed a\n")
    fs.writeFileSync(fileB, "committed b\n")
    execFileSync("git", ["add", "."], { cwd: projectPath })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectPath })
    fs.writeFileSync(fileA, "dirty a\n")
    const checkpoint = await captureBashCheckpoint({
      projectPath,
      runId: "run-git",
      toolCallId: "tool-git"
    })

    if (!checkpoint?.gitSnapshotRef) {
      throw new Error("expected a git snapshot fixture")
    }

    fs.rmSync(fileA)
    fs.writeFileSync(fileB, "current b\n")

    const result = await restoreSingleFileFromCheckpoints({
      maxBytes: RESTORE_MAX_BYTES,
      projectPath,
      relativePath: "a.txt"
    })

    expect(result).toEqual({
      checkpointId: checkpoint.id,
      ok: true,
      source: "git-snapshot"
    })
    expect(fs.readFileSync(fileA, "utf-8")).toBe("dirty a\n")
    expect(fs.readFileSync(fileB, "utf-8")).toBe("current b\n")
  })

  it("prefixes the repo-relative path for a git subdirectory project", async () => {
    // A bash checkpoint only captures a git snapshot when `.git` sits directly
    // in its project path, so a subdirectory project never gets one through the
    // normal flow. Capture at the repo root to obtain a real stash ref, then key
    // a synthesized checkpoint row to the subdirectory's project hash so the
    // restore query (scoped by hash) finds it and must apply `--show-prefix`.
    const repoRoot = createProject()
    initGitRepo(repoRoot)
    const pkgDir = path.join(repoRoot, "pkg")
    fs.mkdirSync(pkgDir)
    const note = path.join(pkgDir, "note.txt")
    fs.writeFileSync(note, "committed\n")
    execFileSync("git", ["add", "."], { cwd: repoRoot })
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: repoRoot })
    fs.writeFileSync(note, "dirty\n")
    const rootCheckpoint = await captureBashCheckpoint({
      projectPath: repoRoot,
      runId: "run-sub",
      toolCallId: "tool-sub"
    })

    if (!rootCheckpoint?.gitSnapshotRef) {
      throw new Error("expected a git snapshot fixture")
    }

    const pkgProjectHash = createHash("sha256")
      .update(path.normalize(path.resolve(pkgDir)))
      .digest("hex")
      .slice(0, 16)
    const subCheckpointId = "sub-git-checkpoint"
    await runExclusiveDbWrite(() =>
      getDb().insert(agentCheckpoints).values({
        createdAt: new Date().toISOString(),
        filesJson: "[]",
        gitSnapshotRef: rootCheckpoint.gitSnapshotRef,
        id: subCheckpointId,
        origin: "bash",
        parentId: null,
        projectHash: pkgProjectHash,
        runId: "run-sub",
        toolCallId: "tool-sub"
      })
    )

    fs.rmSync(note)

    const result = await restoreSingleFileFromCheckpoints({
      maxBytes: RESTORE_MAX_BYTES,
      projectPath: pkgDir,
      relativePath: "note.txt"
    })

    expect(result).toEqual({
      checkpointId: subCheckpointId,
      ok: true,
      source: "git-snapshot"
    })
    expect(fs.readFileSync(note, "utf-8")).toBe("dirty\n")
  })

  it("reports file-exists when the target already exists", async () => {
    const projectPath = createProject()
    fs.writeFileSync(path.join(projectPath, "present.html"), "here\n")

    await expect(
      restoreSingleFileFromCheckpoints({
        maxBytes: RESTORE_MAX_BYTES,
        projectPath,
        relativePath: "present.html"
      })
    ).resolves.toEqual({ ok: false, reason: "file-exists" })
  })

  it("rejects escaping and secret paths as invalid", async () => {
    const projectPath = createProject()

    await expect(
      restoreSingleFileFromCheckpoints({
        maxBytes: RESTORE_MAX_BYTES,
        projectPath,
        relativePath: "../escape.html"
      })
    ).resolves.toEqual({ ok: false, reason: "invalid-path" })
    await expect(
      restoreSingleFileFromCheckpoints({
        maxBytes: RESTORE_MAX_BYTES,
        projectPath,
        relativePath: ".env"
      })
    ).resolves.toEqual({ ok: false, reason: "invalid-path" })
  })

  it("returns no-source when no checkpoint holds the file", async () => {
    const projectPath = createProject()
    fs.writeFileSync(path.join(projectPath, "other.txt"), "x\n")
    await captureFile({
      paths: ["other.txt"],
      projectPath,
      toolCallId: "tool-other"
    })

    await expect(
      restoreSingleFileFromCheckpoints({
        maxBytes: RESTORE_MAX_BYTES,
        projectPath,
        relativePath: "never-seen.html"
      })
    ).resolves.toEqual({ ok: false, reason: "no-source" })
  })

  it("skips over-cap candidates to older ones then reports too-large", async () => {
    const projectPath = createProject()
    const filePath = path.join(projectPath, "big.html")
    fs.writeFileSync(filePath, "AAAA\n")
    await captureFile({
      paths: ["big.html"],
      projectPath,
      toolCallId: "tool-old"
    })
    fs.writeFileSync(filePath, "BBBBBB\n")
    await captureFile({
      paths: ["big.html"],
      projectPath,
      toolCallId: "tool-new"
    })
    fs.rmSync(filePath)

    const result = await restoreSingleFileFromCheckpoints({
      maxBytes: 4,
      projectPath,
      relativePath: "big.html"
    })

    expect(result).toEqual({ ok: false, reason: "too-large" })
    expect(fs.existsSync(filePath)).toBe(false)
  })
})
