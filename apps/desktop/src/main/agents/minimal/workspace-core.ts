import { execFile } from "node:child_process"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { resolveRipgrep } from "@/main/agents/minimal/ripgrep-binary"
import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"

export type WorkspaceResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: WorkspaceFileError }

export type WorkspaceFileErrorCode =
  | "aborted"
  | "io-error"
  | "not-directory"
  | "not-file"
  | "not-found"
  | "outside-project"
  | "secret-path"
  | "stale-write"

export interface WorkspaceFileError {
  causeCode?: string
  code: WorkspaceFileErrorCode
  message: string
  path: string
}

export interface WorkspaceFileInfo {
  isSymlink: boolean
  kind: "file" | "folder" | "other" | "symlink"
  mtimeMs: number
  path: string
  size: number
}

export interface WorkspaceFileView {
  content: string
  info: WorkspaceFileInfo
}

export interface WorkspaceRules {
  content: string
  relativePath: string
}

export interface WorkspaceWriteFileOptions {
  createParentDirectories?: boolean
  expectedMtimeMs?: number
  requireReadSnapshot?: boolean
  signal?: AbortSignal
}

export interface WorkspaceWriteFileResult {
  bytesWritten: number
  info: WorkspaceFileInfo
}

export interface WorkspaceSearchOptions {
  context?: number
  glob?: string
  ignoreCase?: boolean
  limit: number
  literal?: boolean
  pattern: string
  requestedPath?: string
  signal?: AbortSignal
}

export interface WorkspaceCore {
  fileStat: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<WorkspaceResult<WorkspaceFileInfo>>
  listDir: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<WorkspaceResult<WorkspaceFileInfo[]>>
  projectPath: string
  readWorkspaceRules: () => Promise<WorkspaceRules | null>
  searchContent: (
    options: WorkspaceSearchOptions
  ) => Promise<WorkspaceResult<string>>
  view: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<WorkspaceResult<WorkspaceFileView>>
  writeBinaryFile: (
    requestedPath: string,
    content: Uint8Array,
    options?: WorkspaceWriteBinaryFileOptions
  ) => Promise<WorkspaceResult<WorkspaceWriteFileResult>>
  writeFile: (
    requestedPath: string,
    content: string,
    options?: WorkspaceWriteFileOptions
  ) => Promise<WorkspaceResult<WorkspaceWriteFileResult>>
}

export interface WorkspaceWriteBinaryFileOptions {
  signal?: AbortSignal
}

const SECRET_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".npmrc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
  "credentials.json"
])
const SECRET_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"])
const SECRET_SEGMENTS = new Set([".ssh", "secrets"])
const SEARCH_COMMAND_TIMEOUT_MS = 120_000
const SEARCH_OUTPUT_MAX_BYTES = 10 * 1024 * 1024
const WORKSPACE_RULES_CANDIDATES = ["AGENTS.md", "CLAUDE.md"] as const
const WORKSPACE_RULES_MAX_CHARS = 24 * 1024
const WORKSPACE_RULES_TRUNCATION_MARKER =
  "\n\n[workspace rules truncated at 24KB]"

const execFileAsync = promisify(execFile)
const workspaceWriteQueues = new Map<string, Promise<void>>()
const workspaceCores = new Map<string, WorkspaceCore>()

export const isSecretWorkspacePath = (requestedPath: string): boolean => {
  const normalizedPath = requestedPath.replaceAll("\\", "/").toLowerCase()
  const basename = path.posix.basename(normalizedPath)
  const extension = path.posix.extname(normalizedPath)
  const segments = normalizedPath.split("/")

  return (
    SECRET_BASENAMES.has(basename) ||
    SECRET_EXTENSIONS.has(extension) ||
    segments.some((segment) => SECRET_SEGMENTS.has(segment))
  )
}

const createFileError = ({
  causeCode,
  code,
  message,
  requestedPath
}: {
  causeCode?: string
  code: WorkspaceFileErrorCode
  message: string
  requestedPath: string
}): WorkspaceResult<never> => ({
  error: {
    ...(causeCode ? { causeCode } : {}),
    code,
    message,
    path: requestedPath
  },
  ok: false
})

const getNodeErrorCode = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown }

    return typeof code === "string" ? code : undefined
  }

  return undefined
}

const toFileSystemError = ({
  error,
  requestedPath
}: {
  error: unknown
  requestedPath: string
}): WorkspaceResult<never> => {
  const causeCode = getNodeErrorCode(error)

  if (causeCode === "ENOENT") {
    return createFileError({
      causeCode,
      code: "not-found",
      message: "Path does not exist.",
      requestedPath
    })
  }

  return createFileError({
    ...(causeCode ? { causeCode } : {}),
    code: "io-error",
    message: error instanceof Error ? error.message : "File operation failed.",
    requestedPath
  })
}

const getPreAbortedResult = ({
  requestedPath,
  signal
}: {
  requestedPath: string
  signal?: AbortSignal
}): WorkspaceResult<never> | null => {
  if (signal?.aborted) {
    return createFileError({
      code: "aborted",
      message: "File operation was aborted.",
      requestedPath
    })
  }

  return null
}

const normalizeWorkspacePath = (filePath: string): string =>
  filePath.split(path.sep).join("/")

const isPathInsideRoot = (rootPath: string, targetPath: string): boolean => {
  const relativePath = path.relative(rootPath, targetPath)

  return !(relativePath.startsWith("..") || path.isAbsolute(relativePath))
}

const realpathIfExists = (targetPath: string): string => {
  try {
    return fsSync.realpathSync.native(targetPath)
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      return path.resolve(targetPath)
    }

    throw error
  }
}

const getFileInfoKind = (stats: fsSync.Stats): WorkspaceFileInfo["kind"] => {
  if (stats.isSymbolicLink()) {
    return "symlink"
  }

  if (stats.isDirectory()) {
    return "folder"
  }

  if (stats.isFile()) {
    return "file"
  }

  return "other"
}

const waitForWriteQueue = async (queue: Promise<void>): Promise<void> => {
  try {
    await queue
  } catch (error) {
    void error
  }
}

const withWorkspaceWriteLock = async <TValue>(
  lockKey: string,
  task: () => Promise<TValue>
): Promise<TValue> => {
  const previousQueue = workspaceWriteQueues.get(lockKey) ?? Promise.resolve()
  const currentQueue = Promise.withResolvers<null>()
  const queuedOperation = (async () => {
    await waitForWriteQueue(previousQueue)
    await currentQueue.promise
  })()

  workspaceWriteQueues.set(lockKey, queuedOperation)
  await waitForWriteQueue(previousQueue)

  try {
    return await task()
  } finally {
    currentQueue.resolve(null)

    if (workspaceWriteQueues.get(lockKey) === queuedOperation) {
      workspaceWriteQueues.delete(lockKey)
    }
  }
}

const checkStaleWriteGuards = ({
  currentInfo,
  expectedReadMtimeMs,
  options,
  requestedPath
}: {
  currentInfo: WorkspaceResult<WorkspaceFileInfo>
  expectedReadMtimeMs: number | undefined
  options: WorkspaceWriteFileOptions | undefined
  requestedPath: string
}): WorkspaceResult<void> => {
  const fileExists = currentInfo.ok
  const changedError = createFileError({
    code: "stale-write",
    message: `${requestedPath} changed since it was read; read it again before writing.`,
    requestedPath
  })

  if (options?.requireReadSnapshot && fileExists) {
    if (expectedReadMtimeMs === undefined) {
      return createFileError({
        code: "stale-write",
        message: `${requestedPath} must be read before overwriting; read it before writing.`,
        requestedPath
      })
    }

    if (currentInfo.value.mtimeMs !== expectedReadMtimeMs) {
      return changedError
    }
  }

  if (options?.expectedMtimeMs !== undefined) {
    if (!fileExists) {
      return createFileError({
        code: "stale-write",
        message: `${requestedPath} no longer exists; read it again before writing.`,
        requestedPath
      })
    }

    if (currentInfo.value.mtimeMs !== options.expectedMtimeMs) {
      return changedError
    }
  }

  return { ok: true, value: undefined }
}

const runRipgrep = async ({
  args,
  cwd,
  searchRoot,
  signal
}: {
  args: readonly string[]
  cwd: string
  searchRoot: string
  signal?: AbortSignal
}): Promise<WorkspaceResult<string>> => {
  const ripgrep = await resolveRipgrep()

  if (!ripgrep.command) {
    return createFileError({
      code: "io-error",
      message:
        "ripgrep is unavailable: neither the system installation nor the bundled fallback could be found.",
      requestedPath: searchRoot
    })
  }

  try {
    const { stdout } = await execFileAsync(ripgrep.command, [...args], {
      cwd,
      env: getShellSpawnEnv(),
      maxBuffer: SEARCH_OUTPUT_MAX_BYTES,
      signal,
      timeout: SEARCH_COMMAND_TIMEOUT_MS
    })

    return { ok: true, value: stdout }
  } catch (error) {
    const execError = error as {
      code?: number | string
      stderr?: string
      stdout?: string
    }

    // rg exits 1 when the search completes with no matches.
    if (execError.code === 1 && !execError.stderr) {
      return { ok: true, value: execError.stdout ?? "" }
    }

    if (execError.code === "ENOENT") {
      return createFileError({
        code: "io-error",
        message: "The selected ripgrep binary could not be executed.",
        requestedPath: searchRoot
      })
    }

    return createFileError({
      code: signal?.aborted ? "aborted" : "io-error",
      message: execError.stderr?.trim() || "Failed to execute ripgrep.",
      requestedPath: searchRoot
    })
  }
}

const createWorkspaceCore = (projectPath: string): WorkspaceCore => {
  const normalizedProjectPath = path.resolve(projectPath)
  const realProjectPath = realpathIfExists(normalizedProjectPath)
  const readSnapshots = new Map<string, number>()

  const resolveProjectPath = (
    requestedPath: string
  ): WorkspaceResult<{ absolutePath: string; relativePath: string }> => {
    const absolutePath = path.resolve(
      normalizedProjectPath,
      requestedPath || "."
    )
    const relativePath = path.relative(normalizedProjectPath, absolutePath)

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return createFileError({
        code: "outside-project",
        message: "Path is outside project root.",
        requestedPath
      })
    }

    return {
      ok: true,
      value: {
        absolutePath,
        relativePath: normalizeWorkspacePath(relativePath) || "."
      }
    }
  }

  const assertNonSecretPath = (
    requestedPath: string
  ): WorkspaceResult<void> => {
    if (isSecretWorkspacePath(requestedPath)) {
      return createFileError({
        code: "secret-path",
        message: "Path looks like a secret file and cannot be accessed.",
        requestedPath
      })
    }

    return { ok: true, value: undefined }
  }

  const findExistingAncestorPath = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<WorkspaceResult<string>> => {
    let currentPath = absolutePath

    while (true) {
      try {
        await fs.lstat(currentPath)

        return { ok: true, value: currentPath }
      } catch (error) {
        if (getNodeErrorCode(error) !== "ENOENT") {
          return toFileSystemError({ error, requestedPath })
        }

        const parentPath = path.dirname(currentPath)

        if (parentPath === currentPath) {
          return toFileSystemError({ error, requestedPath })
        }

        currentPath = parentPath
      }
    }
  }

  const ensureExistingAncestorInsideProject = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<WorkspaceResult<void>> => {
    const existingAncestorPath = await findExistingAncestorPath({
      absolutePath,
      requestedPath
    })

    if (!existingAncestorPath.ok) {
      return existingAncestorPath
    }

    try {
      const realAncestorPath = await fs.realpath(existingAncestorPath.value)

      if (!isPathInsideRoot(realProjectPath, realAncestorPath)) {
        return createFileError({
          code: "outside-project",
          message: "Path is outside project root.",
          requestedPath
        })
      }
    } catch (error) {
      return toFileSystemError({ error, requestedPath })
    }

    return { ok: true, value: undefined }
  }

  const ensureResolvedParentInsideProject = ({
    requestedPath,
    resolvedPath
  }: {
    requestedPath: string
    resolvedPath: { absolutePath: string; relativePath: string }
  }): Promise<WorkspaceResult<void>> => {
    if (resolvedPath.relativePath === ".") {
      return Promise.resolve({ ok: true, value: undefined })
    }

    return ensureExistingAncestorInsideProject({
      absolutePath: path.dirname(resolvedPath.absolutePath),
      requestedPath
    })
  }

  const ensureWritableFileTarget = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<WorkspaceResult<void>> => {
    try {
      const stats = await fs.lstat(absolutePath)

      if (!stats.isFile()) {
        return createFileError({
          code: "not-file",
          message: "Path is not a file.",
          requestedPath
        })
      }
    } catch (error) {
      if (getNodeErrorCode(error) !== "ENOENT") {
        return toFileSystemError({ error, requestedPath })
      }
    }

    return { ok: true, value: undefined }
  }

  const fileStat = async (
    requestedPath: string,
    signal?: AbortSignal
  ): Promise<WorkspaceResult<WorkspaceFileInfo>> => {
    const aborted = getPreAbortedResult({ requestedPath, signal })

    if (aborted) {
      return aborted
    }

    const resolvedPath = resolveProjectPath(requestedPath)

    if (!resolvedPath.ok) {
      return resolvedPath
    }

    const parentCheck = await ensureResolvedParentInsideProject({
      requestedPath,
      resolvedPath: resolvedPath.value
    })

    if (!parentCheck.ok) {
      return parentCheck
    }

    try {
      const stats = await fs.lstat(resolvedPath.value.absolutePath)

      return {
        ok: true,
        value: {
          isSymlink: stats.isSymbolicLink(),
          kind: getFileInfoKind(stats),
          mtimeMs: stats.mtimeMs,
          path: resolvedPath.value.relativePath,
          size: stats.size
        }
      }
    } catch (error) {
      return toFileSystemError({ error, requestedPath })
    }
  }

  const getWriteLockKey = (absolutePath: string): string =>
    `${normalizedProjectPath}\0${path.resolve(absolutePath)}`

  const readWorkspaceRules = async (): Promise<WorkspaceRules | null> => {
    for (const requestedPath of WORKSPACE_RULES_CANDIDATES) {
      const secretCheck = assertNonSecretPath(requestedPath)

      if (!secretCheck.ok) {
        return null
      }

      const resolvedPath = resolveProjectPath(requestedPath)

      if (!resolvedPath.ok) {
        return null
      }

      let stats: fsSync.Stats

      try {
        stats = await fs.lstat(resolvedPath.value.absolutePath)
      } catch (error) {
        if (getNodeErrorCode(error) === "ENOENT") {
          continue
        }

        return null
      }

      const containmentCheck = await ensureExistingAncestorInsideProject({
        absolutePath: resolvedPath.value.absolutePath,
        requestedPath
      })

      if (!containmentCheck.ok || !stats.isFile()) {
        return null
      }

      try {
        const content = await fs.readFile(
          resolvedPath.value.absolutePath,
          "utf-8"
        )

        return {
          content:
            content.length > WORKSPACE_RULES_MAX_CHARS
              ? `${content.slice(0, WORKSPACE_RULES_MAX_CHARS)}${WORKSPACE_RULES_TRUNCATION_MARKER}`
              : content,
          relativePath: resolvedPath.value.relativePath
        }
      } catch {
        return null
      }
    }

    return null
  }

  return {
    fileStat,
    listDir: async (requestedPath, signal) => {
      const aborted = getPreAbortedResult({ requestedPath, signal })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectPath(requestedPath)

      if (!resolvedPath.ok) {
        return resolvedPath
      }

      const parentCheck = await ensureResolvedParentInsideProject({
        requestedPath,
        resolvedPath: resolvedPath.value
      })

      if (!parentCheck.ok) {
        return parentCheck
      }

      try {
        const stats = await fs.lstat(resolvedPath.value.absolutePath)

        if (!stats.isDirectory()) {
          return createFileError({
            code: "not-directory",
            message: "Path is not a directory.",
            requestedPath
          })
        }

        const rawDirectoryEntries = await fs.readdir(
          resolvedPath.value.absolutePath
        )
        const directoryEntries = rawDirectoryEntries.toSorted()
        const fileInfos: WorkspaceFileInfo[] = []

        for (const entryName of directoryEntries) {
          const entryPath =
            resolvedPath.value.relativePath === "."
              ? entryName
              : `${resolvedPath.value.relativePath}/${entryName}`
          const entryInfo = await fileStat(entryPath, signal)

          if (entryInfo.ok) {
            fileInfos.push(entryInfo.value)
          }
        }

        return { ok: true, value: fileInfos }
      } catch (error) {
        return toFileSystemError({ error, requestedPath })
      }
    },
    projectPath: normalizedProjectPath,
    readWorkspaceRules,
    searchContent: ({
      context,
      glob,
      ignoreCase,
      limit,
      literal,
      pattern,
      requestedPath,
      signal
    }) => {
      const searchRoot = requestedPath ?? "."
      const aborted = getPreAbortedResult({ requestedPath: searchRoot, signal })

      if (aborted) {
        return Promise.resolve(aborted)
      }

      const secretCheck = assertNonSecretPath(searchRoot)

      if (!secretCheck.ok) {
        return Promise.resolve(secretCheck)
      }

      const resolvedPath = resolveProjectPath(searchRoot)

      if (!resolvedPath.ok) {
        return Promise.resolve(resolvedPath)
      }

      const args = [
        "--line-number",
        "--color",
        "never",
        "--no-heading",
        "--with-filename",
        "--max-count",
        String(limit),
        ...(ignoreCase ? ["--ignore-case"] : []),
        ...(literal ? ["--fixed-strings"] : []),
        ...(context ? ["--context", String(context)] : []),
        ...(glob ? ["--glob", glob] : []),
        "--",
        pattern,
        resolvedPath.value.relativePath
      ]

      return runRipgrep({
        args,
        cwd: normalizedProjectPath,
        searchRoot,
        signal
      })
    },
    view: async (requestedPath, signal) => {
      const aborted = getPreAbortedResult({ requestedPath, signal })

      if (aborted) {
        return aborted
      }

      const secretCheck = assertNonSecretPath(requestedPath)

      if (!secretCheck.ok) {
        return secretCheck
      }

      const resolvedPath = resolveProjectPath(requestedPath)

      if (!resolvedPath.ok) {
        return resolvedPath
      }

      const parentCheck = await ensureResolvedParentInsideProject({
        requestedPath,
        resolvedPath: resolvedPath.value
      })

      if (!parentCheck.ok) {
        return parentCheck
      }

      try {
        const stats = await fs.lstat(resolvedPath.value.absolutePath)

        if (!stats.isFile()) {
          return createFileError({
            code: "not-file",
            message: "Path is not a file.",
            requestedPath
          })
        }

        const content = await fs.readFile(
          resolvedPath.value.absolutePath,
          "utf-8"
        )

        readSnapshots.set(
          getWriteLockKey(resolvedPath.value.absolutePath),
          stats.mtimeMs
        )

        return {
          ok: true,
          value: {
            content,
            info: {
              isSymlink: stats.isSymbolicLink(),
              kind: getFileInfoKind(stats),
              mtimeMs: stats.mtimeMs,
              path: resolvedPath.value.relativePath,
              size: stats.size
            }
          }
        }
      } catch (error) {
        return toFileSystemError({ error, requestedPath })
      }
    },
    writeFile: async (requestedPath, content, options) => {
      const aborted = getPreAbortedResult({
        requestedPath,
        signal: options?.signal
      })

      if (aborted) {
        return aborted
      }

      const secretCheck = assertNonSecretPath(requestedPath)

      if (!secretCheck.ok) {
        return secretCheck
      }

      const resolvedPath = resolveProjectPath(requestedPath)

      if (!resolvedPath.ok) {
        return resolvedPath
      }

      const lockKey = getWriteLockKey(resolvedPath.value.absolutePath)

      return await withWorkspaceWriteLock(lockKey, async () => {
        if (options?.createParentDirectories) {
          const parentCheck = await ensureExistingAncestorInsideProject({
            absolutePath: path.dirname(resolvedPath.value.absolutePath),
            requestedPath
          })

          if (!parentCheck.ok) {
            return parentCheck
          }

          try {
            await fs.mkdir(path.dirname(resolvedPath.value.absolutePath), {
              recursive: true
            })
          } catch (error) {
            return toFileSystemError({ error, requestedPath })
          }
        }

        const currentInfo = await fileStat(requestedPath, options?.signal)
        const missingIsFatal =
          !currentInfo.ok && currentInfo.error.code !== "not-found"

        if (missingIsFatal) {
          return currentInfo
        }

        const staleCheck = checkStaleWriteGuards({
          currentInfo,
          expectedReadMtimeMs: readSnapshots.get(lockKey),
          options,
          requestedPath
        })

        if (!staleCheck.ok) {
          return staleCheck
        }

        const ancestorCheck = await ensureExistingAncestorInsideProject({
          absolutePath: path.dirname(resolvedPath.value.absolutePath),
          requestedPath
        })

        if (!ancestorCheck.ok) {
          return ancestorCheck
        }

        const writableTarget = await ensureWritableFileTarget({
          absolutePath: resolvedPath.value.absolutePath,
          requestedPath
        })

        if (!writableTarget.ok) {
          return writableTarget
        }

        try {
          await fs.writeFile(resolvedPath.value.absolutePath, content, "utf-8")
        } catch (error) {
          return toFileSystemError({ error, requestedPath })
        }

        const writtenInfo = await fileStat(requestedPath, options?.signal)

        if (!writtenInfo.ok) {
          return writtenInfo
        }

        readSnapshots.delete(lockKey)

        return {
          ok: true,
          value: {
            bytesWritten: Buffer.byteLength(content, "utf-8"),
            info: writtenInfo.value
          }
        }
      })
    },
    // Writes generated binary artifacts (e.g. images) under the same path
    // sandbox as text writes. Parent directories are created, and since these
    // are always fresh files there is no stale-write snapshot guard.
    writeBinaryFile: async (requestedPath, content, options) => {
      const aborted = getPreAbortedResult({
        requestedPath,
        signal: options?.signal
      })

      if (aborted) {
        return aborted
      }

      const secretCheck = assertNonSecretPath(requestedPath)

      if (!secretCheck.ok) {
        return secretCheck
      }

      const resolvedPath = resolveProjectPath(requestedPath)

      if (!resolvedPath.ok) {
        return resolvedPath
      }

      const lockKey = getWriteLockKey(resolvedPath.value.absolutePath)

      return await withWorkspaceWriteLock(lockKey, async () => {
        const parentCheck = await ensureExistingAncestorInsideProject({
          absolutePath: path.dirname(resolvedPath.value.absolutePath),
          requestedPath
        })

        if (!parentCheck.ok) {
          return parentCheck
        }

        try {
          await fs.mkdir(path.dirname(resolvedPath.value.absolutePath), {
            recursive: true
          })
          await fs.writeFile(resolvedPath.value.absolutePath, content)
        } catch (error) {
          return toFileSystemError({ error, requestedPath })
        }

        const writtenInfo = await fileStat(requestedPath, options?.signal)

        if (!writtenInfo.ok) {
          return writtenInfo
        }

        return {
          ok: true,
          value: {
            bytesWritten: content.byteLength,
            info: writtenInfo.value
          }
        }
      })
    }
  }
}

export const getWorkspaceCore = (projectPath: string): WorkspaceCore => {
  const key = path.resolve(projectPath)
  const existing = workspaceCores.get(key)

  if (existing) {
    return existing
  }

  const core = createWorkspaceCore(key)

  workspaceCores.set(key, core)

  return core
}

/**
 * Drops the memoized {@link WorkspaceCore} for a project path so the next
 * {@link getWorkspaceCore} rebuilds it from scratch.
 *
 * A core captures the project's realpath once, at construction (see
 * {@link realpathIfExists}). When it is built while the project directory is
 * missing, that realpath falls back to the plain resolved path; after the
 * directory is later recreated its true realpath can differ (on macOS `/tmp`
 * resolves through to `/private/tmp`), and every containment check then fails
 * as `outside-project` forever because the pinned root no longer matches the
 * resolved ancestor. Callers that recreate a deleted project directory must
 * invalidate the cached core so it is rebuilt against the resolvable realpath.
 */
export const invalidateWorkspaceCore = (projectPath: string): void => {
  workspaceCores.delete(path.resolve(projectPath))
}
