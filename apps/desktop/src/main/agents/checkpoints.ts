import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import { gunzip, gzip } from "node:zlib"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { app } from "electron"

import { isSecretWorkspacePath } from "@/main/agents/minimal/workspace-core"
import { getDb } from "@/main/db"
import { getAppConfigDir } from "@/main/db/libsql-paths"
import { agentCheckpoints } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"

export const CHECKPOINT_MAX_AGE_DAYS = 14
export const CHECKPOINT_MAX_TOTAL_MB = 512

const CHECKPOINT_FILE_MAX_BYTES = 5 * 1024 * 1024
const CHECKPOINT_LIST_DEFAULT_LIMIT = 100
const CHECKPOINT_LIST_MAX_LIMIT = 1000
const GIT_COMMAND_MAX_BUFFER = 1024 * 1024
const GIT_COMMAND_TIMEOUT_MS = 5000
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const SHA256_PATTERN = /^[a-f\d]{64}$/u

const execFileAsync = promisify(execFile)
const gunzipAsync = promisify(gunzip)
const gzipAsync = promisify(gzip)
const projectOperationQueues = new Map<string, Promise<void>>()

export type CheckpointOrigin = "bash" | "edit" | "write"

export interface CheckpointFile {
  mode?: number
  overCap?: true
  path: string
  preSha: string | null
}

export interface AgentCheckpoint {
  createdAt: string
  files: CheckpointFile[]
  gitSnapshotRef: string | null
  id: string
  origin: CheckpointOrigin
  parentId: string | null
  projectHash: string
  runId: string
  toolCallId: string
}

export interface RestoreFileCheckpointResult {
  missingBlobs: string[]
  restored: string[]
  skipped: string[]
}

interface ResolvedProject {
  normalizedPath: string
  projectHash: string
  realPath: string
}

interface ResolvedWorkspacePath {
  absolutePath: string
  relativePath: string
  stats: fsSync.Stats | null
}

const getNodeErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }

  const { code } = error as { code?: unknown }

  return typeof code === "string" ? code : undefined
}

const normalizeWorkspacePath = (filePath: string): string =>
  filePath.split(path.sep).join("/")

const isPathInsideRoot = (rootPath: string, targetPath: string): boolean => {
  const relativePath = path.relative(rootPath, targetPath)

  return !(relativePath.startsWith("..") || path.isAbsolute(relativePath))
}

const getProjectHash = (normalizedProjectPath: string): string =>
  createHash("sha256").update(normalizedProjectPath).digest("hex").slice(0, 16)

const resolveProject = async (
  projectPath: string
): Promise<ResolvedProject> => {
  const normalizedPath = path.normalize(path.resolve(projectPath))
  const realPath = await fs.realpath(normalizedPath)

  return {
    normalizedPath,
    projectHash: getProjectHash(normalizedPath),
    realPath
  }
}

const findExistingAncestor = async (
  absolutePath: string
): Promise<{ path: string; stats: fsSync.Stats }> => {
  let currentPath = absolutePath

  while (true) {
    try {
      return {
        path: currentPath,
        stats: await fs.lstat(currentPath)
      }
    } catch (error) {
      if (getNodeErrorCode(error) !== "ENOENT") {
        throw error
      }

      const parentPath = path.dirname(currentPath)

      if (parentPath === currentPath) {
        throw error
      }

      currentPath = parentPath
    }
  }
}

const resolveWorkspacePath = async ({
  project,
  requestedPath
}: {
  project: ResolvedProject
  requestedPath: string
}): Promise<ResolvedWorkspacePath | null> => {
  const absolutePath = path.resolve(project.normalizedPath, requestedPath)
  const relativePath = path.relative(project.normalizedPath, absolutePath)

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null
  }

  const normalizedRelativePath = normalizeWorkspacePath(relativePath) || "."

  if (isSecretWorkspacePath(normalizedRelativePath)) {
    return null
  }

  const existingAncestor = await findExistingAncestor(absolutePath)
  const realAncestorPath = await fs.realpath(existingAncestor.path)

  if (!isPathInsideRoot(project.realPath, realAncestorPath)) {
    return null
  }

  if (existingAncestor.path === absolutePath) {
    if (existingAncestor.stats.isSymbolicLink()) {
      return null
    }

    return {
      absolutePath,
      relativePath: normalizedRelativePath,
      stats: existingAncestor.stats
    }
  }

  return {
    absolutePath,
    relativePath: normalizedRelativePath,
    stats: null
  }
}

const getCheckpointRoot = (projectHash: string): string =>
  path.join(getAppConfigDir(app.getPath("home")), "checkpoints", projectHash)

const getObjectsRoot = (projectHash: string): string =>
  path.join(getCheckpointRoot(projectHash), "objects")

const getObjectPath = ({
  projectHash,
  sha
}: {
  projectHash: string
  sha: string
}): string => path.join(getObjectsRoot(projectHash), sha.slice(0, 2), sha)

const hashFile = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256")

  await pipeline(fsSync.createReadStream(filePath), hash)

  return hash.digest("hex")
}

const writeBlob = async ({
  content,
  projectHash,
  sha
}: {
  content: Buffer
  projectHash: string
  sha: string
}): Promise<void> => {
  const objectPath = getObjectPath({ projectHash, sha })

  try {
    await fs.access(objectPath)
    return
  } catch (error) {
    if (getNodeErrorCode(error) !== "ENOENT") {
      throw error
    }
  }

  await fs.mkdir(path.dirname(objectPath), { recursive: true })
  const compressedContent = await gzipAsync(content)

  try {
    await fs.writeFile(objectPath, compressedContent, { flag: "wx" })
  } catch (error) {
    if (getNodeErrorCode(error) !== "EEXIST") {
      throw error
    }
  }
}

const captureCheckpointFile = async ({
  project,
  requestedPath
}: {
  project: ResolvedProject
  requestedPath: string
}): Promise<CheckpointFile | null> => {
  const resolvedPath = await resolveWorkspacePath({ project, requestedPath })

  if (!resolvedPath) {
    return null
  }

  if (!resolvedPath.stats) {
    return {
      path: resolvedPath.relativePath,
      preSha: null
    }
  }

  if (!resolvedPath.stats.isFile()) {
    throw new Error(`Checkpoint path is not a regular file: ${requestedPath}`)
  }

  const mode = resolvedPath.stats.mode % 512

  if (resolvedPath.stats.size > CHECKPOINT_FILE_MAX_BYTES) {
    return {
      mode,
      overCap: true,
      path: resolvedPath.relativePath,
      preSha: await hashFile(resolvedPath.absolutePath)
    }
  }

  const content = await fs.readFile(resolvedPath.absolutePath)
  const preSha = createHash("sha256").update(content).digest("hex")

  await writeBlob({
    content,
    projectHash: project.projectHash,
    sha: preSha
  })

  return {
    mode,
    path: resolvedPath.relativePath,
    preSha
  }
}

const isCheckpointFile = (value: unknown): value is CheckpointFile => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const file = value as Record<string, unknown>
  const hasValidMode = file.mode === undefined || Number.isInteger(file.mode)
  const hasValidOverCap = file.overCap === undefined || file.overCap === true

  return (
    hasValidMode &&
    hasValidOverCap &&
    typeof file.path === "string" &&
    (file.preSha === null || typeof file.preSha === "string")
  )
}

const parseFilesJson = (filesJson: string): CheckpointFile[] => {
  const parsed: unknown = JSON.parse(filesJson)

  if (!Array.isArray(parsed) || !parsed.every(isCheckpointFile)) {
    throw new Error("Invalid checkpoint files manifest.")
  }

  return parsed
}

const toCheckpoint = (
  row: typeof agentCheckpoints.$inferSelect
): AgentCheckpoint => ({
  createdAt: row.createdAt,
  files: parseFilesJson(row.filesJson),
  gitSnapshotRef: row.gitSnapshotRef,
  id: row.id,
  origin: row.origin,
  parentId: row.parentId,
  projectHash: row.projectHash,
  runId: row.runId,
  toolCallId: row.toolCallId
})

const waitForProjectQueue = async (queue: Promise<void>): Promise<void> => {
  try {
    await queue
  } catch (error) {
    void error
  }
}

const withProjectOperationLock = async <TValue>(
  projectHash: string,
  task: () => Promise<TValue>
): Promise<TValue> => {
  const previousQueue =
    projectOperationQueues.get(projectHash) ?? Promise.resolve()
  const currentQueue = Promise.withResolvers<null>()
  const queuedOperation = (async () => {
    await waitForProjectQueue(previousQueue)
    await currentQueue.promise
  })()

  projectOperationQueues.set(projectHash, queuedOperation)
  await waitForProjectQueue(previousQueue)

  try {
    return await task()
  } finally {
    currentQueue.resolve(null)

    if (projectOperationQueues.get(projectHash) === queuedOperation) {
      projectOperationQueues.delete(projectHash)
    }
  }
}

const insertCheckpoint = ({
  files,
  gitSnapshotRef,
  origin,
  projectHash,
  runId,
  toolCallId
}: {
  files: CheckpointFile[]
  gitSnapshotRef: string | null
  origin: CheckpointOrigin
  projectHash: string
  runId: string
  toolCallId: string
}): Promise<AgentCheckpoint> => {
  const checkpointId = randomUUID()
  const createdAt = new Date().toISOString()

  return runExclusiveDbWrite(() =>
    getDb().transaction(async (tx) => {
      const [parent] = await tx
        .select({ id: agentCheckpoints.id })
        .from(agentCheckpoints)
        .where(eq(agentCheckpoints.projectHash, projectHash))
        .orderBy(desc(agentCheckpoints.createdAt), sql`rowid desc`)
        .limit(1)
      const checkpoint: AgentCheckpoint = {
        createdAt,
        files,
        gitSnapshotRef,
        id: checkpointId,
        origin,
        parentId: parent?.id ?? null,
        projectHash,
        runId,
        toolCallId
      }

      await tx.insert(agentCheckpoints).values({
        createdAt,
        filesJson: JSON.stringify(files),
        gitSnapshotRef,
        id: checkpointId,
        origin,
        parentId: checkpoint.parentId,
        projectHash,
        runId,
        toolCallId
      })

      return checkpoint
    })
  )
}

const runScheduledPrune = async (projectPath: string): Promise<void> => {
  try {
    await pruneCheckpoints({ projectPath })
  } catch (error) {
    logger.error("checkpoint_prune_failed", {
      error,
      project_path: projectPath
    })
  }
}

const schedulePrune = (projectPath: string): void => {
  void runScheduledPrune(projectPath)
}

export const captureFileCheckpoint = async ({
  origin,
  paths,
  projectPath,
  runId,
  toolCallId
}: {
  origin: Exclude<CheckpointOrigin, "bash">
  paths: readonly string[]
  projectPath: string
  runId: string
  toolCallId: string
}): Promise<AgentCheckpoint | null> => {
  try {
    const project = await resolveProject(projectPath)
    const checkpoint = await withProjectOperationLock(
      project.projectHash,
      async () => {
        const capturedByPath = new Map<string, CheckpointFile>()

        for (const requestedPath of paths) {
          const file = await captureCheckpointFile({ project, requestedPath })

          if (file) {
            capturedByPath.set(file.path, file)
          }
        }

        return insertCheckpoint({
          files: [...capturedByPath.values()],
          gitSnapshotRef: null,
          origin,
          projectHash: project.projectHash,
          runId,
          toolCallId
        })
      }
    )

    schedulePrune(projectPath)

    return checkpoint
  } catch (error) {
    logger.error("checkpoint_file_capture_failed", {
      error,
      origin,
      project_path: projectPath,
      run_id: runId,
      tool_call_id: toolCallId
    })

    return null
  }
}

const hasGitMetadata = async (projectPath: string): Promise<boolean> => {
  try {
    await fs.lstat(path.join(projectPath, ".git"))
    return true
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      return false
    }

    throw error
  }
}

const createGitSnapshot = async (
  projectPath: string
): Promise<string | null> => {
  if (!(await hasGitMetadata(projectPath))) {
    return null
  }

  // `git stash create` leaves the worktree, index, and refs untouched. Its
  // unreferenced objects are normally garbage-collected after roughly two
  // weeks, so bash snapshots are deliberately best-effort.
  const { stdout } = await execFileAsync("git", ["stash", "create"], {
    cwd: projectPath,
    encoding: "utf-8",
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true
  })
  const snapshotRef = String(stdout).trim()

  return snapshotRef || null
}

export const captureBashCheckpoint = async ({
  projectPath,
  runId,
  toolCallId
}: {
  projectPath: string
  runId: string
  toolCallId: string
}): Promise<AgentCheckpoint | null> => {
  try {
    const project = await resolveProject(projectPath)
    const checkpoint = await withProjectOperationLock(
      project.projectHash,
      async () => {
        const gitSnapshotRef = await createGitSnapshot(project.normalizedPath)

        return insertCheckpoint({
          files: [],
          gitSnapshotRef,
          origin: "bash",
          projectHash: project.projectHash,
          runId,
          toolCallId
        })
      }
    )

    schedulePrune(projectPath)

    return checkpoint
  } catch (error) {
    logger.error("checkpoint_bash_capture_failed", {
      error,
      project_path: projectPath,
      run_id: runId,
      tool_call_id: toolCallId
    })

    return null
  }
}

export const listCheckpoints = async ({
  limit = CHECKPOINT_LIST_DEFAULT_LIMIT,
  projectPath
}: {
  limit?: number
  projectPath: string
}): Promise<AgentCheckpoint[]> => {
  const project = await resolveProject(projectPath)
  const boundedLimit = Math.min(
    CHECKPOINT_LIST_MAX_LIMIT,
    Math.max(1, Math.trunc(limit))
  )
  const rows = await getDb()
    .select()
    .from(agentCheckpoints)
    .where(eq(agentCheckpoints.projectHash, project.projectHash))
    .orderBy(desc(agentCheckpoints.createdAt), sql`rowid desc`)
    .limit(boundedLimit)

  return rows.map(toCheckpoint)
}

export const getCheckpoint = async (
  id: string
): Promise<AgentCheckpoint | null> => {
  const [row] = await getDb()
    .select()
    .from(agentCheckpoints)
    .where(eq(agentCheckpoints.id, id))
    .limit(1)

  return row ? toCheckpoint(row) : null
}

export const restoreFileCheckpoint = async ({
  checkpointId,
  projectPath
}: {
  checkpointId: string
  projectPath: string
}): Promise<RestoreFileCheckpointResult> => {
  const project = await resolveProject(projectPath)
  const checkpoint = await getCheckpoint(checkpointId)

  if (!checkpoint || checkpoint.projectHash !== project.projectHash) {
    throw new Error("Checkpoint does not exist for this project.")
  }

  const safetyCheckpoint = await captureFileCheckpoint({
    origin: "write",
    paths: checkpoint.files.map((file) => file.path),
    projectPath,
    runId: checkpoint.runId,
    toolCallId: checkpoint.toolCallId
  })

  if (!safetyCheckpoint) {
    throw new Error("Failed to capture the pre-restore safety checkpoint.")
  }

  const result: RestoreFileCheckpointResult = {
    missingBlobs: [],
    restored: [],
    skipped: []
  }

  for (const file of checkpoint.files) {
    const resolvedPath = await resolveWorkspacePath({
      project,
      requestedPath: file.path
    })

    if (!resolvedPath || file.overCap) {
      result.skipped.push(file.path)
      continue
    }

    if (file.preSha === null) {
      await fs.rm(resolvedPath.absolutePath, { force: true })
      result.restored.push(file.path)
      continue
    }

    if (!SHA256_PATTERN.test(file.preSha)) {
      result.missingBlobs.push(file.path)
      continue
    }

    const objectPath = getObjectPath({
      projectHash: project.projectHash,
      sha: file.preSha
    })
    let compressedContent: Buffer

    try {
      compressedContent = await fs.readFile(objectPath)
    } catch (error) {
      if (getNodeErrorCode(error) === "ENOENT") {
        result.missingBlobs.push(file.path)
        continue
      }

      throw error
    }

    const content = await gunzipAsync(compressedContent)

    await fs.mkdir(path.dirname(resolvedPath.absolutePath), { recursive: true })
    await fs.writeFile(resolvedPath.absolutePath, content)

    if (file.mode !== undefined) {
      await fs.chmod(resolvedPath.absolutePath, file.mode)
    }

    result.restored.push(file.path)
  }

  return result
}

const getReferencedShas = (files: readonly CheckpointFile[]): string[] =>
  files.flatMap((file) =>
    file.preSha && !file.overCap && SHA256_PATTERN.test(file.preSha)
      ? [file.preSha]
      : []
  )

const getBlobSize = async ({
  projectHash,
  sha
}: {
  projectHash: string
  sha: string
}): Promise<number> => {
  try {
    const stats = await fs.stat(getObjectPath({ projectHash, sha }))

    return stats.size
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      return 0
    }

    throw error
  }
}

const listObjectFiles = async (rootPath: string): Promise<string[]> => {
  let entries: fsSync.Dirent[]

  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      return []
    }

    throw error
  }

  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listObjectFiles(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

const removeOrphanedBlobs = async ({
  projectHash,
  referencedShas
}: {
  projectHash: string
  referencedShas: ReadonlySet<string>
}): Promise<void> => {
  const objectFiles = await listObjectFiles(getObjectsRoot(projectHash))

  for (const objectPath of objectFiles) {
    if (!referencedShas.has(path.basename(objectPath))) {
      await fs.rm(objectPath, { force: true })
    }
  }
}

export const pruneCheckpoints = async ({
  projectPath
}: {
  projectPath: string
}): Promise<void> => {
  const project = await resolveProject(projectPath)

  await withProjectOperationLock(project.projectHash, async () => {
    const rows = await getDb()
      .select()
      .from(agentCheckpoints)
      .where(eq(agentCheckpoints.projectHash, project.projectHash))
      .orderBy(agentCheckpoints.createdAt, sql`rowid`)
    const checkpoints = rows.map(toCheckpoint)
    const cutoffMs = Date.now() - CHECKPOINT_MAX_AGE_DAYS * MILLISECONDS_PER_DAY
    const evictedIds = new Set(
      checkpoints
        .filter((checkpoint) => Date.parse(checkpoint.createdAt) < cutoffMs)
        .map((checkpoint) => checkpoint.id)
    )
    const activeCheckpoints = checkpoints.filter(
      (checkpoint) => !evictedIds.has(checkpoint.id)
    )
    const referenceCounts = new Map<string, number>()

    for (const checkpoint of activeCheckpoints) {
      for (const sha of new Set(getReferencedShas(checkpoint.files))) {
        referenceCounts.set(sha, (referenceCounts.get(sha) ?? 0) + 1)
      }
    }

    const blobSizes = new Map<string, number>()
    let totalBytes = 0

    for (const sha of referenceCounts.keys()) {
      const size = await getBlobSize({
        projectHash: project.projectHash,
        sha
      })
      blobSizes.set(sha, size)
      totalBytes += size
    }

    const maxTotalBytes = CHECKPOINT_MAX_TOTAL_MB * 1024 * 1024

    for (const checkpoint of activeCheckpoints) {
      if (totalBytes <= maxTotalBytes) {
        break
      }

      evictedIds.add(checkpoint.id)

      for (const sha of new Set(getReferencedShas(checkpoint.files))) {
        const nextReferenceCount = (referenceCounts.get(sha) ?? 0) - 1

        if (nextReferenceCount <= 0) {
          referenceCounts.delete(sha)
          totalBytes -= blobSizes.get(sha) ?? 0
        } else {
          referenceCounts.set(sha, nextReferenceCount)
        }
      }
    }

    const remainingRows = await runExclusiveDbWrite(() =>
      getDb().transaction(async (tx) => {
        if (evictedIds.size > 0) {
          await tx
            .delete(agentCheckpoints)
            .where(
              and(
                eq(agentCheckpoints.projectHash, project.projectHash),
                inArray(agentCheckpoints.id, [...evictedIds])
              )
            )
        }

        return tx
          .select({ filesJson: agentCheckpoints.filesJson })
          .from(agentCheckpoints)
          .where(eq(agentCheckpoints.projectHash, project.projectHash))
      })
    )
    const referencedShas = new Set(
      remainingRows.flatMap((row) =>
        getReferencedShas(parseFilesJson(row.filesJson))
      )
    )

    await removeOrphanedBlobs({
      projectHash: project.projectHash,
      referencedShas
    })
  })
}
