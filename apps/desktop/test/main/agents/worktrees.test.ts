import { execFileSync } from "node:child_process"
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import * as worktreeGit from "@/main/agents/worktrees/git"
import { createWorktreeManager } from "@/main/agents/worktrees/manager"
import type { WorktreeManager } from "@/main/agents/worktrees/manager"

let root: string
let project: string
let manager: WorktreeManager
const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: project,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim()

beforeEach(async () => {
  root = await mkdtemp("/private/tmp/etyon-worktrees-")
  project = path.join(root, "project")
  await mkdir(project)
  git("init")
  git("config", "user.name", "Worktree Test")
  git("config", "user.email", "worktree@example.com")
  git("config", "commit.gpgsign", "false")
  git("config", "core.hooksPath", "/dev/null")
  await writeFile(path.join(project, "main.txt"), "base\n")
  await writeFile(path.join(project, "other.txt"), "unrelated\n")
  git("add", ".")
  git("commit", "-m", "base")
  manager = createWorktreeManager({ storageRoot: path.join(root, "managed") })
}, 60_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { force: true, recursive: true })
}, 60_000)

const create = () =>
  manager.create({ projectPath: project, runId: "run", sessionId: "session" })

describe("managed worktree isolation", { timeout: 120_000 }, () => {
  it("starts at the current feature HEAD and does not copy primary edits", async () => {
    git("checkout", "-b", "feature")
    await writeFile(path.join(project, "main.txt"), "feature commit\n")
    git("add", ".")
    git("commit", "-m", "feature")
    const head = git("rev-parse", "HEAD")
    await writeFile(path.join(project, "main.txt"), "user working change\n")
    const tree = await create()
    await expect(
      manager.prune({ discardChanges: true, id: tree.id })
    ).rejects.toThrow("Wait for the isolated agent")
    expect(tree.baseCommit).toBe(head)
    expect(
      await readFile(path.join(tree.workspacePath, "main.txt"), "utf-8")
    ).toBe("feature commit\n")
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "user working change\n"
    )
    await manager.finish(tree.id)
    expect(await manager.list()).toHaveLength(0)
  })

  it("applies tracked and new binary files while preserving unrelated primary edits and index", async () => {
    const tree = await create()
    await writeFile(path.join(tree.workspacePath, "main.txt"), "candidate\n")
    await writeFile(
      path.join(tree.workspacePath, "image.bin"),
      Buffer.from([0, 1, 2, 255])
    )
    await writeFile(path.join(tree.workspacePath, "space name.txt"), "new\n")
    await writeFile(path.join(project, "other.txt"), "user edit\n")
    git("add", "other.txt")
    const index = git("diff", "--cached")
    await manager.finish(tree.id)
    const preview = await manager.preview(tree.id, "session")
    expect(preview.paths).toEqual(["image.bin", "main.txt", "space name.txt"])
    expect(preview.patch).toContain("GIT binary patch")
    expect(preview.conflicts).toEqual([])
    const applied = await manager.apply({
      expectedFingerprint: preview.fingerprint,
      id: tree.id,
      sessionId: "session"
    })
    expect(applied.ok).toBe(true)
    expect(applied.rollbackSnapshotPath).toBeDefined()
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "candidate\n"
    )
    expect(await readFile(path.join(project, "image.bin"))).toEqual(
      Buffer.from([0, 1, 2, 255])
    )
    expect(await readFile(path.join(project, "other.txt"), "utf-8")).toBe(
      "user edit\n"
    )
    expect(git("diff", "--cached")).toBe(index)
  })

  it("rejects touched primary paths, new-file collisions and stale previews", async () => {
    const tree = await create()
    await writeFile(path.join(tree.workspacePath, "main.txt"), "candidate\n")
    await writeFile(path.join(tree.workspacePath, "new.txt"), "candidate new\n")
    await manager.finish(tree.id)
    const preview = await manager.preview(tree.id)
    await writeFile(path.join(project, "main.txt"), "user\n")
    await writeFile(path.join(project, "new.txt"), "user new\n")
    const stale = await manager.apply({
      expectedFingerprint: preview.fingerprint,
      id: tree.id
    })
    expect(stale.ok).toBe(false)
    const updated = await manager.preview(tree.id)
    expect(updated.conflicts).toEqual(["main.txt", "new.txt"])
    const conflictingApply = await manager.apply({
      expectedFingerprint: updated.fingerprint,
      id: tree.id
    })
    expect(conflictingApply.ok).toBe(false)
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "user\n"
    )
    expect(await readFile(path.join(project, "new.txt"), "utf-8")).toBe(
      "user new\n"
    )
  })

  it("includes commits created by an isolated candidate", async () => {
    const tree = await create()
    await writeFile(
      path.join(tree.workspacePath, "main.txt"),
      "committed candidate\n"
    )
    execFileSync("git", ["add", "."], { cwd: tree.directory })
    execFileSync("git", ["commit", "-m", "candidate"], {
      cwd: tree.directory,
      stdio: "ignore"
    })
    await manager.finish(tree.id)
    const preview = await manager.preview(tree.id)
    expect(preview.patch).toContain("committed candidate")
    const applied = await manager.apply({
      expectedFingerprint: preview.fingerprint,
      id: tree.id
    })
    expect(applied.ok).toBe(true)
  })

  it("preserves changed orphans and only prunes unchanged interrupted worktrees", async () => {
    const clean = await create()
    const dirty = await create()
    await writeFile(path.join(dirty.workspacePath, "main.txt"), "unfinished\n")
    manager = createWorktreeManager({ storageRoot: manager.storageRoot })
    const recovery = await manager.recover()
    expect(recovery.pruned).toEqual([clean.id])
    expect(recovery.preserved).toEqual([dirty.id])
    const recovered = await manager.get(dirty.id)
    expect(recovered.state).toBe("orphaned")
    await expect(manager.prune({ id: dirty.id })).rejects.toThrow(
      "contains changes"
    )
    await manager.prune({ discardChanges: true, id: dirty.id })
    expect(await manager.list()).toHaveLength(0)
  })

  it("fences session ownership and refuses symlink targets", async () => {
    const tree = await create()
    await expect(manager.preview(tree.id, "another-session")).rejects.toThrow(
      "ownership"
    )
    await mkdir(path.join(tree.workspacePath, "nested"))
    await writeFile(
      path.join(tree.workspacePath, "nested", "new.txt"),
      "candidate\n"
    )
    await manager.finish(tree.id)
    await mkdir(path.join(root, "outside"))
    await symlink(path.join(root, "outside"), path.join(project, "nested"))
    const preview = await manager.preview(tree.id)
    expect(preview.conflicts).toEqual(["nested/new.txt"])
    const applied = await manager.apply({
      expectedFingerprint: preview.fingerprint,
      id: tree.id
    })
    expect(applied.ok).toBe(false)
    await expect(
      readFile(path.join(root, "outside", "new.txt"))
    ).rejects.toThrow()
  })

  it("uses the project's subdirectory as the child workspace and rejects non-Git projects", async () => {
    await mkdir(path.join(project, "app"))
    await writeFile(path.join(project, "app", "entry.txt"), "entry\n")
    git("add", ".")
    git("commit", "-m", "app")
    const tree = await manager.create({
      projectPath: path.join(project, "app"),
      runId: "run",
      sessionId: "session"
    })
    expect(tree.workspacePath).toBe(path.join(tree.directory, "app"))
    await writeFile(
      path.join(tree.directory, "other.txt"),
      "outside scoped project\n"
    )
    await expect(manager.preview(tree.id)).rejects.toThrow(
      "outside this project"
    )
    await expect(manager.finish(tree.id)).rejects.toThrow(
      "outside this project"
    )
    await manager.prune({ discardChanges: true, id: tree.id })
    await mkdir(path.join(root, "not-git"))
    await expect(
      manager.create({
        projectPath: path.join(root, "not-git"),
        runId: "run",
        sessionId: "session"
      })
    ).rejects.toThrow("requires a Git")
  })

  it("rolls back a partial application and preserves concurrent content it cannot identify", async () => {
    const tree = await create()
    await writeFile(path.join(tree.workspacePath, "main.txt"), "candidate\n")
    await manager.finish(tree.id)
    const preview = await manager.preview(tree.id)
    const runGit = worktreeGit.runWorktreeGit
    let thirdPartyWrite = false
    vi.spyOn(worktreeGit, "runWorktreeGit").mockImplementation(
      async (cwd, args, options) => {
        if (args[0] === "apply" && !args.includes("--check")) {
          await writeFile(
            path.join(project, "main.txt"),
            thirdPartyWrite ? "concurrent user\n" : "candidate\n"
          )
          throw new Error("injected apply failure")
        }
        return await runGit(cwd, args, options)
      }
    )
    const restored = await manager.apply({
      expectedFingerprint: preview.fingerprint,
      id: tree.id
    })
    expect(restored.ok).toBe(false)
    expect(restored.conflicts).toEqual([])
    expect(restored.rollbackSnapshotPath).toBeDefined()
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "base\n"
    )
    thirdPartyWrite = true
    const refreshed = await manager.preview(tree.id)
    const conflicted = await manager.apply({
      expectedFingerprint: refreshed.fingerprint,
      id: tree.id
    })
    expect(conflicted.ok).toBe(false)
    expect(conflicted.conflicts).toEqual(["main.txt"])
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "concurrent user\n"
    )
  })
})
