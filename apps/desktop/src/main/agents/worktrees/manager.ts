import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { ManagedWorktreeSchema } from "@etyon/rpc/schemas/worktrees"
import type {
  ApplyWorktreeOutput,
  ManagedWorktree,
  WorktreeDiff
} from "@etyon/rpc/schemas/worktrees"

import { runWorktreeGit } from "@/main/agents/worktrees/git"
import {
  hashWorktreeValue,
  isSafeWorktreePath,
  saveWorktreeSnapshots,
  snapshotWorktreeFile
} from "@/main/agents/worktrees/snapshots"
import type { WorktreeFileSnapshot } from "@/main/agents/worktrees/snapshots"
import { getAppConfigDir } from "@/main/app-paths"

const MAX_CHANGED_PATHS = 100
const ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu
const repositoryQueues = new Map<string, Promise<boolean>>()

export interface WorktreeAudit {
  event:
    | "applied"
    | "apply_failed"
    | "created"
    | "pruned"
    | "ready"
    | "recovered"
  id: string
  paths?: string[]
  runId: string
  sessionId: string
}

export interface WorktreeManager {
  apply: (options: {
    expectedFingerprint: string
    id: string
    sessionId?: string
  }) => Promise<ApplyWorktreeOutput>
  create: (options: {
    label?: string
    projectPath: string
    runId: string
    sessionId: string
    signal?: AbortSignal
  }) => Promise<ManagedWorktree>
  finish: (id: string) => Promise<ManagedWorktree | null>
  get: (id: string, sessionId?: string) => Promise<ManagedWorktree>
  list: (sessionId?: string) => Promise<ManagedWorktree[]>
  preview: (id: string, sessionId?: string) => Promise<WorktreeDiff>
  prune: (options: {
    discardChanges?: boolean
    id: string
    sessionId?: string
  }) => Promise<void>
  recover: () => Promise<{ preserved: string[]; pruned: string[] }>
  storageRoot: string
}

const withRepositoryLock = async <T>(
  repository: string,
  action: () => Promise<T>
): Promise<T> => {
  const previous = repositoryQueues.get(repository) ?? Promise.resolve(true)
  const { promise, resolve } = Promise.withResolvers<boolean>()
  repositoryQueues.set(repository, promise)
  await previous
  try {
    return await action()
  } finally {
    resolve(true)
    if (repositoryQueues.get(repository) === promise) {
      repositoryQueues.delete(repository)
    }
  }
}

const relativeProjectPath = (worktree: ManagedWorktree): string =>
  path.relative(worktree.repositoryRoot, worktree.projectPath)

const verifyWorktreeRegistration = async (
  record: ManagedWorktree
): Promise<void> => {
  const registered = await runWorktreeGit(record.repositoryRoot, [
    "worktree",
    "list",
    "--porcelain",
    "-z"
  ])
  if (!registered.split("\0").includes(`worktree ${record.directory}`)) {
    throw new Error("The directory is no longer a registered managed worktree.")
  }
  const mainCommon = await runWorktreeGit(record.repositoryRoot, [
    "rev-parse",
    "--git-common-dir"
  ])
  const candidateCommon = await runWorktreeGit(record.directory, [
    "rev-parse",
    "--git-common-dir"
  ])
  const [mainIdentity, candidateIdentity] = await Promise.all([
    realpath(path.resolve(record.repositoryRoot, mainCommon.trim())),
    realpath(path.resolve(record.directory, candidateCommon.trim()))
  ])
  if (mainIdentity !== candidateIdentity) {
    throw new Error("Worktree repository identity has changed.")
  }
}

const restoreFailedApply = async (
  repositoryRoot: string,
  before: WorktreeFileSnapshot[],
  after: WorktreeFileSnapshot[]
): Promise<string[]> => {
  const conflicts: string[] = []
  for (const [index, previous] of before.entries()) {
    const current = await snapshotWorktreeFile(repositoryRoot, previous.path)
    const intended = after[index]
    if (
      !intended ||
      current.kind !== intended.kind ||
      current.mode !== intended.mode ||
      (current.content &&
        intended.content &&
        !current.content.equals(intended.content))
    ) {
      conflicts.push(previous.path)
      continue
    }
    const target = path.join(repositoryRoot, previous.path)
    if (previous.kind === "missing") {
      await rm(target, { force: true })
    } else if (previous.content) {
      await writeFile(target, previous.content)
      if (previous.mode !== undefined) {
        await chmod(target, previous.mode)
      }
    }
  }
  return conflicts
}

export const createWorktreeManager = ({
  onAudit,
  storageRoot = path.join(getAppConfigDir(homedir()), "worktrees")
}: {
  onAudit?: (event: WorktreeAudit) => void | Promise<void>
  storageRoot?: string
} = {}): WorktreeManager => {
  const root = path.resolve(storageRoot)
  const recordsDirectory = path.join(root, ".records")
  const recordPath = (id: string): string => {
    if (!ID_PATTERN.test(id)) {
      throw new Error("Invalid worktree identifier.")
    }
    return path.join(recordsDirectory, `${id}.json`)
  }
  const save = async (record: ManagedWorktree): Promise<void> => {
    await mkdir(recordsDirectory, { recursive: true, mode: 0o700 })
    const temporary = `${recordPath(record.id)}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
    await rename(temporary, recordPath(record.id))
  }
  const get = async (
    id: string,
    sessionId?: string
  ): Promise<ManagedWorktree> => {
    const record = ManagedWorktreeSchema.parse(
      JSON.parse(await readFile(recordPath(id), "utf-8"))
    )
    if (
      record.id !== id ||
      record.directory !== path.join(root, id) ||
      (sessionId && record.sessionId !== sessionId)
    ) {
      throw new Error("Worktree ownership check failed.")
    }
    const relative = path.relative(record.repositoryRoot, record.projectPath)
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      record.workspacePath !== path.join(record.directory, relative)
    ) {
      throw new Error("Invalid worktree project path.")
    }
    const directoryInfo = await lstat(record.directory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("Managed worktree directory is unsafe.")
    }
    return record
  }
  const list = async (sessionId?: string): Promise<ManagedWorktree[]> => {
    let names: string[]
    try {
      names = await readdir(recordsDirectory)
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return []
      }
      throw error
    }
    const records: ManagedWorktree[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue
      }
      const id = name.slice(0, -5)
      // Corrupt/missing worktrees remain on disk for manual recovery.
      try {
        const record = await get(id)
        if (!sessionId || record.sessionId === sessionId) {
          records.push(record)
        }
      } catch {
        /* Do not delete unverified directories. */
      }
    }
    return records.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    )
  }
  const create: WorktreeManager["create"] = async ({
    label = "Isolated agent",
    projectPath,
    runId,
    sessionId,
    signal
  }) => {
    const project = await realpath(projectPath)
    let repositoryRoot: string
    let baseCommit: string
    try {
      const repositoryOutput = await runWorktreeGit(
        project,
        ["rev-parse", "--show-toplevel"],
        { signal }
      )
      repositoryRoot = await realpath(repositoryOutput.trim())
      const commitOutput = await runWorktreeGit(
        repositoryRoot,
        ["rev-parse", "--verify", "HEAD"],
        { signal }
      )
      baseCommit = commitOutput.trim()
    } catch {
      throw new Error(
        "Worktree isolation requires a Git repository with a current HEAD commit."
      )
    }
    const id = randomUUID()
    const directory = path.join(root, id)
    const record: ManagedWorktree = {
      baseCommit,
      createdAt: new Date().toISOString(),
      directory,
      id,
      label: label.slice(0, 200),
      projectPath: project,
      repositoryRoot,
      runId,
      sessionId,
      state: "running",
      workspacePath: path.join(
        directory,
        path.relative(repositoryRoot, project)
      )
    }
    await mkdir(root, { recursive: true, mode: 0o700 })
    await withRepositoryLock(repositoryRoot, async () => {
      // Persist ownership before Git registers the worktree so a process exit
      // between checkout and model startup still leaves a recovery record.
      await save(record)
      try {
        await runWorktreeGit(
          repositoryRoot,
          ["worktree", "add", "--detach", "--", directory, baseCommit],
          { signal }
        )
        await onAudit?.({ event: "created", id, runId, sessionId })
      } catch (error) {
        const interrupted: ManagedWorktree = { ...record, state: "orphaned" }
        await save(interrupted)
        try {
          const diff = await buildPatch(interrupted)
          if (diff.paths.length === 0) {
            await runWorktreeGit(repositoryRoot, [
              "worktree",
              "remove",
              "--",
              directory
            ])
            await rm(recordPath(id), { force: true })
          }
        } catch {
          /* Preserve any directory whose state could not be verified. */
        }
        throw error
      }
    })
    return record
  }
  const buildPatch = async (
    record: ManagedWorktree
  ): Promise<{
    additions: number
    deletions: number
    patch: string
    paths: string[]
  }> => {
    const indexDirectory = path.join(root, ".indexes")
    await mkdir(indexDirectory, { recursive: true, mode: 0o700 })
    const indexPath = path.join(indexDirectory, randomUUID())
    const options = { env: { GIT_INDEX_FILE: indexPath } }
    try {
      // A private index captures commits, staged edits, unstaged edits and new
      // files together without altering either the candidate or primary index.
      await runWorktreeGit(
        record.directory,
        ["read-tree", record.baseCommit],
        options
      )
      await runWorktreeGit(
        record.directory,
        ["add", "--all", "--", "."],
        options
      )
      const pathOutput = await runWorktreeGit(
        record.directory,
        [
          "diff",
          "--cached",
          "--name-only",
          "-z",
          "--no-renames",
          record.baseCommit
        ],
        options
      )
      const paths = pathOutput.split("\0").filter(Boolean)
      if (paths.length > MAX_CHANGED_PATHS) {
        throw new Error("Isolated change exceeds 100 files; split this task.")
      }
      const projectRelative = relativeProjectPath(record)
      for (const changedPath of paths) {
        if (
          !isSafeWorktreePath(changedPath) ||
          (projectRelative && !changedPath.startsWith(`${projectRelative}/`))
        ) {
          throw new Error(
            `Change is outside this project's workspace: ${changedPath}`
          )
        }
        const candidate = await snapshotWorktreeFile(
          record.directory,
          changedPath
        )
        if (candidate.kind === "unsafe") {
          throw new Error(
            `Symlink, directory and submodule changes require manual review: ${changedPath}`
          )
        }
      }
      const patch = await runWorktreeGit(
        record.directory,
        [
          "diff",
          "--cached",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          record.baseCommit
        ],
        options
      )
      const stats = await runWorktreeGit(
        record.directory,
        ["diff", "--cached", "--numstat", "--no-renames", record.baseCommit],
        options
      )
      let additions = 0
      let deletions = 0
      for (const line of stats.split("\n")) {
        const [added, deleted] = line.split("\t")
        additions += Number.parseInt(added ?? "0", 10) || 0
        deletions += Number.parseInt(deleted ?? "0", 10) || 0
      }
      return { additions, deletions, patch, paths }
    } finally {
      await rm(indexPath, { force: true })
      await rm(`${indexPath}.lock`, { force: true })
    }
  }
  const preview = async (
    id: string,
    sessionId?: string
  ): Promise<WorktreeDiff> => {
    const record = await get(id, sessionId)
    const diff = await buildPatch(record)
    const headOutput = await runWorktreeGit(record.repositoryRoot, [
      "rev-parse",
      "HEAD"
    ])
    const head = headOutput.trim()
    const snapshots = await Promise.all(
      diff.paths.map((file) =>
        snapshotWorktreeFile(record.repositoryRoot, file)
      )
    )
    const statusOutput =
      diff.paths.length > 0
        ? await runWorktreeGit(record.repositoryRoot, [
            "-c",
            "status.renames=false",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ...diff.paths
          ])
        : ""
    const dirty = statusOutput
      .split("\0")
      .filter(Boolean)
      .map((line) => line.slice(3))
    const dirtySet = new Set(dirty)
    const conflicts = snapshots
      .filter((file) => file.kind === "unsafe" || dirtySet.has(file.path))
      .map((file) => file.path)
    const fingerprint = hashWorktreeValue(
      JSON.stringify({
        baseCommit: record.baseCommit,
        head,
        id,
        patch: diff.patch,
        snapshots: snapshots.map(
          ({ fingerprint: fileFingerprint, path: filePath }) => ({
            fingerprint: fileFingerprint,
            path: filePath
          })
        ),
        state: record.state
      })
    )
    return { ...diff, conflicts, fingerprint, worktree: record }
  }
  const prune: WorktreeManager["prune"] = async ({
    discardChanges = false,
    id,
    sessionId
  }) => {
    const record = await get(id, sessionId)
    await withRepositoryLock(record.repositoryRoot, async () => {
      if (record.state === "running") {
        throw new Error(
          "Wait for the isolated agent to finish before removing its worktree."
        )
      }
      await verifyWorktreeRegistration(record)
      if (!discardChanges) {
        const diff = await buildPatch(record)
        if (diff.paths.length > 0) {
          throw new Error(
            "This worktree contains changes. Preview them before explicitly discarding it."
          )
        }
      }
      await runWorktreeGit(record.repositoryRoot, [
        "worktree",
        "remove",
        ...(discardChanges ? ["--force"] : []),
        "--",
        record.directory
      ])
      await rm(recordPath(id), { force: true })
      await onAudit?.({
        event: "pruned",
        id,
        runId: record.runId,
        sessionId: record.sessionId
      })
    })
  }
  const finish: WorktreeManager["finish"] = async (id) => {
    const record = await get(id)
    let diff
    try {
      diff = await buildPatch(record)
    } catch (error) {
      await save({ ...record, state: "orphaned" })
      throw error
    }
    if (diff.paths.length === 0) {
      await save({ ...record, state: "ready" })
      await prune({ id })
      return null
    }
    const updated = { ...record, state: "ready" as const }
    await save(updated)
    await onAudit?.({
      event: "ready",
      id,
      paths: diff.paths,
      runId: record.runId,
      sessionId: record.sessionId
    })
    return updated
  }
  const apply: WorktreeManager["apply"] = async ({
    expectedFingerprint,
    id,
    sessionId
  }) => {
    const record = await get(id, sessionId)
    return await withRepositoryLock(record.repositoryRoot, async () => {
      if (record.state === "running" || record.state === "applied") {
        return {
          appliedPaths: [],
          conflicts: [],
          error: "Worktree is not awaiting application.",
          ok: false
        }
      }
      await verifyWorktreeRegistration(record)
      const diff = await preview(id, sessionId)
      if (diff.fingerprint !== expectedFingerprint) {
        return {
          appliedPaths: [],
          conflicts: diff.paths,
          error:
            "Files changed since preview. Refresh the diff before applying.",
          ok: false
        }
      }
      if (diff.conflicts.length > 0) {
        return {
          appliedPaths: [],
          conflicts: diff.conflicts,
          error: "The primary workspace already has changes in these paths.",
          ok: false
        }
      }
      if (!diff.patch) {
        return {
          appliedPaths: [],
          conflicts: [],
          error: "This worktree has no changes.",
          ok: false
        }
      }
      try {
        await runWorktreeGit(
          record.repositoryRoot,
          ["apply", "--check", "--binary", "--whitespace=nowarn", "-"],
          { input: diff.patch }
        )
      } catch (error) {
        return {
          appliedPaths: [],
          conflicts: diff.paths,
          error: error instanceof Error ? error.message : String(error),
          ok: false
        }
      }
      const before = await Promise.all(
        diff.paths.map((file) =>
          snapshotWorktreeFile(record.repositoryRoot, file)
        )
      )
      const after = await Promise.all(
        diff.paths.map((file) => snapshotWorktreeFile(record.directory, file))
      )
      const rollbackSnapshotPath = path.join(root, ".snapshots", randomUUID())
      await saveWorktreeSnapshots(rollbackSnapshotPath, before)
      // Recheck both the selected patch and primary paths after snapshot I/O.
      const preparedPreview = await preview(id, sessionId)
      if (preparedPreview.fingerprint !== expectedFingerprint) {
        return {
          appliedPaths: [],
          conflicts: diff.paths,
          error: "Files changed while preparing application.",
          ok: false,
          rollbackSnapshotPath
        }
      }
      try {
        await runWorktreeGit(
          record.repositoryRoot,
          ["apply", "--binary", "--whitespace=nowarn", "-"],
          { input: diff.patch }
        )
      } catch (error) {
        // Roll back only bytes demonstrably written by this patch. Preserve a
        // third party's concurrent content and retain the recovery snapshot.
        const conflicts = await restoreFailedApply(
          record.repositoryRoot,
          before,
          after
        )
        await onAudit?.({
          event: "apply_failed",
          id,
          paths: diff.paths,
          runId: record.runId,
          sessionId: record.sessionId
        })
        return {
          appliedPaths: [],
          conflicts,
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          rollbackSnapshotPath
        }
      }
      await save({ ...record, state: "applied" })
      await onAudit?.({
        event: "applied",
        id,
        paths: diff.paths,
        runId: record.runId,
        sessionId: record.sessionId
      })
      return {
        appliedPaths: diff.paths,
        conflicts: [],
        ok: true,
        rollbackSnapshotPath
      }
    })
  }
  const recover: WorktreeManager["recover"] = async () => {
    const preserved: string[] = []
    const pruned: string[] = []
    // A crash before checkout can leave only the persisted ownership record.
    // Remove only that exact missing path's Git registration and metadata.
    let recordNames: string[] = []
    try {
      recordNames = await readdir(recordsDirectory)
    } catch {
      /* No records yet. */
    }
    for (const name of recordNames) {
      if (!name.endsWith(".json")) {
        continue
      }
      try {
        const record = ManagedWorktreeSchema.parse(
          JSON.parse(await readFile(recordPath(name.slice(0, -5)), "utf-8"))
        )
        if (record.directory !== path.join(root, record.id)) {
          continue
        }
        try {
          await lstat(record.directory)
          continue
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            continue
          }
        }
        const registered = await runWorktreeGit(record.repositoryRoot, [
          "worktree",
          "list",
          "--porcelain",
          "-z"
        ])
        if (registered.split("\0").includes(`worktree ${record.directory}`)) {
          await runWorktreeGit(record.repositoryRoot, [
            "worktree",
            "remove",
            "--force",
            "--",
            record.directory
          ])
        }
        await rm(recordPath(record.id), { force: true })
        pruned.push(record.id)
      } catch {
        /* Corrupt or unverifiable ownership remains for inspection. */
      }
    }
    for (const record of await list()) {
      if (record.state !== "running") {
        continue
      }
      try {
        const diff = await buildPatch(record)
        if (diff.paths.length === 0) {
          await save({ ...record, state: "orphaned" })
          await prune({ id: record.id })
          pruned.push(record.id)
          continue
        }
      } catch {
        /* A failed inspection cannot establish that cleanup is safe. */
      }
      await save({ ...record, state: "orphaned" })
      await onAudit?.({
        event: "recovered",
        id: record.id,
        runId: record.runId,
        sessionId: record.sessionId
      })
      preserved.push(record.id)
    }
    return { preserved, pruned }
  }
  return {
    apply,
    create,
    finish,
    get,
    list,
    preview,
    prune,
    recover,
    storageRoot: root
  }
}
