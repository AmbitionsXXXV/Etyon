import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"

import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  clampToolOutput,
  summarizeToolResult
} from "@/main/agents/truncate"

export {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  clampToolOutput,
  createToolResultSummaryCache,
  formatSize,
  summarizeToolResult,
  truncateHead,
  truncateLine,
  truncateTail
} from "@/main/agents/truncate"

const AGENT_FILE_SYSTEM_TEMP_DIR_NAME = ".etyon-agent-tmp"
const AGENT_ARTIFACT_DIR_NAME = "etyon-agent-artifacts"
const BINARY_OUTPUT_PLACEHOLDER = "[binary]"
const DEFAULT_AGENT_SHELL_TIMEOUT_MS = 120_000
const DEFAULT_FILE_SYSTEM_TEMP_PREFIX = "tmp-"
const DELETE_CONTROL_CODE = 0x7f
const FILE_OPERATION_ABORTED_MESSAGE = "File operation aborted."
const REPLACEMENT_CHARACTER_CODE = 0xfffd
const SPACE_CONTROL_CODE = 0x20
const TEMP_NAME_UNSAFE_PATTERN = /[^A-Za-z0-9._-]/gu
const TEXT_LINE_BREAK_PATTERN = /\r?\n/u

export interface AgentCommandOutputRef {
  byteLength: number
  kind: "command-output"
  path: string
}

export interface AgentCommandOutput {
  durationMs: number
  exitCode: number | null
  outputRef: AgentCommandOutputRef | null
  stderrPreview: string
  stdoutPreview: string
  status: "approval_required" | "failed" | "success"
  truncated: boolean
}

export type AgentExecutionErrorCode =
  | "aborted"
  | "spawn"
  | "timeout"
  | "unknown"

export interface AgentExecutionError {
  code: AgentExecutionErrorCode
  exitCode?: number
  message: string
  stderr?: string
  stdout?: string
}

export type AgentResult<TValue, TError> =
  | {
      ok: false
      error: TError
    }
  | {
      ok: true
      value: TValue
    }

export type AgentFileErrorCode =
  | "aborted"
  | "io-error"
  | "not-directory"
  | "not-file"
  | "not-found"
  | "outside-project"

export interface AgentFileError {
  causeCode?: string
  code: AgentFileErrorCode
  message: string
  path: string
}

export interface AgentFileInfo {
  isSymlink: boolean
  kind: "file" | "folder" | "other" | "symlink"
  mtimeMs: number
  path: string
  size: number
}

export interface AgentFileSystemCreateDirOptions {
  recursive?: boolean
  signal?: AbortSignal
}

export interface AgentFileSystemCreateTempFileOptions {
  prefix?: string
  signal?: AbortSignal
  suffix?: string
}

export interface AgentFileSystemReadTextLinesOptions {
  maxLines?: number
  signal?: AbortSignal
}

export interface AgentFileSystemRemoveOptions {
  force?: boolean
  recursive?: boolean
  signal?: AbortSignal
}

export type AgentFileSystemWriteContent = string | Uint8Array

export interface AgentFileSystem {
  absolutePath: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<string, AgentFileError>>
  appendFile: (
    requestedPath: string,
    content: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<void, AgentFileError>>
  canonicalPath: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<string, AgentFileError>>
  cleanup: () => Promise<void>
  createDir: (
    requestedPath: string,
    options?: AgentFileSystemCreateDirOptions
  ) => Promise<AgentResult<void, AgentFileError>>
  createTempDir: (
    prefix?: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<string, AgentFileError>>
  createTempFile: (
    options?: AgentFileSystemCreateTempFileOptions
  ) => Promise<AgentResult<string, AgentFileError>>
  cwd: string
  exists: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<boolean, AgentFileError>>
  fileInfo: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<AgentFileInfo, AgentFileError>>
  listDir: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<AgentFileInfo[], AgentFileError>>
  readBinaryFile: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<Uint8Array, AgentFileError>>
  readTextFile: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<string, AgentFileError>>
  readTextLines: (
    requestedPath: string,
    options?: AgentFileSystemReadTextLinesOptions
  ) => Promise<AgentResult<string[], AgentFileError>>
  remove: (
    requestedPath: string,
    options?: AgentFileSystemRemoveOptions
  ) => Promise<AgentResult<void, AgentFileError>>
  writeFile: (
    requestedPath: string,
    content: AgentFileSystemWriteContent,
    signal?: AbortSignal
  ) => Promise<AgentResult<void, AgentFileError>>
}

export type AgentShellOutputChannel = "stderr" | "stdout"

export interface AgentShellOutputEvent {
  channel: AgentShellOutputChannel
  chunk: string
  sequence: number
}

export interface AgentShellExecOptions {
  abortSignal?: AbortSignal
  cwd?: string
  env?: Record<string, string>
  onOutput?: (event: AgentShellOutputEvent) => void
  stdin?: string
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  timeout?: number
}

export interface AgentShellResult {
  exitCode: number | null
  stderr: string
  stdout: string
}

export interface AgentShell {
  cleanup: () => Promise<void>
  exec: (
    command: string,
    options?: AgentShellExecOptions
  ) => Promise<AgentResult<AgentShellResult, AgentExecutionError>>
}

export interface AgentExecutionEnv {
  fileSystem: AgentFileSystem
  projectPath: string
  resolveCwd: (cwd: string) => string
  runShellCommand: (
    options: RunShellCommandOptions
  ) => Promise<AgentCommandOutput>
  shell: AgentShell
}

export interface CreateAgentExecutionEnvOptions {
  outputMaxChars?: number
  projectPath: string
}

export interface RunShellCommandOptions {
  abortSignal?: AbortSignal
  command: string
  cwd: string
  stdin?: string
  timeoutMs: number
}

const isAllowedOutputControl = (char: string): boolean =>
  char === "\n" || char === "\r" || char === "\t"

const isUnsafeOutputChar = (char: string): boolean => {
  const codePoint = char.codePointAt(0)

  return (
    codePoint === REPLACEMENT_CHARACTER_CODE ||
    codePoint === DELETE_CONTROL_CODE ||
    (codePoint !== undefined &&
      codePoint < SPACE_CONTROL_CODE &&
      !isAllowedOutputControl(char))
  )
}

const sanitizeCommandOutput = (content: string): string => {
  let sanitized = ""
  let previousWasBinary = false

  for (const char of content) {
    if (isUnsafeOutputChar(char)) {
      if (!previousWasBinary) {
        sanitized = `${sanitized}${BINARY_OUTPUT_PLACEHOLDER}`
      }

      previousWasBinary = true
      continue
    }

    sanitized = `${sanitized}${char}`
    previousWasBinary = false
  }

  return sanitized
}

const createCommandOutputDecoder = () => {
  const decoder = new StringDecoder("utf-8")

  return {
    end: (): string => sanitizeCommandOutput(decoder.end()),
    write: (chunk: Buffer): string =>
      sanitizeCommandOutput(decoder.write(chunk))
  }
}

const isPathInsideRoot = (rootPath: string, targetPath: string): boolean => {
  const relativePath = path.relative(rootPath, targetPath)

  return !(relativePath.startsWith("..") || path.isAbsolute(relativePath))
}

const assertInsideProject = (projectPath: string, targetPath: string): void => {
  if (!isPathInsideRoot(projectPath, targetPath)) {
    throw new Error("Command cwd is outside project root.")
  }
}

const realpathIfExists = (targetPath: string): string => {
  try {
    return fsSync.realpathSync.native(targetPath)
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return path.resolve(targetPath)
    }

    throw error
  }
}

const resolveRealCwd = ({
  normalizedProjectPath,
  realProjectPath,
  resolvedCwd
}: {
  normalizedProjectPath: string
  realProjectPath: string
  resolvedCwd: string
}): string => {
  if (fsSync.existsSync(resolvedCwd)) {
    return realpathIfExists(resolvedCwd)
  }

  return path.resolve(
    realProjectPath,
    path.relative(normalizedProjectPath, resolvedCwd)
  )
}

const normalizeFileSystemPath = (filePath: string): string =>
  filePath.split(path.sep).join("/")

const sanitizeFileSystemTempNamePart = (name: string): string =>
  name.replaceAll(TEMP_NAME_UNSAFE_PATTERN, "-")

const ignoreFileSystemCleanupError = (): undefined => undefined

const createFileError = ({
  causeCode,
  code,
  message,
  requestedPath
}: {
  causeCode?: string
  code: AgentFileErrorCode
  message: string
  requestedPath: string
}): AgentResult<never, AgentFileError> => ({
  error: {
    ...(causeCode ? { causeCode } : {}),
    code,
    message,
    path: requestedPath
  },
  ok: false
})

const createExecutionError = ({
  code,
  exitCode,
  message,
  stderr,
  stdout
}: {
  code: AgentExecutionErrorCode
  exitCode?: number
  message: string
  stderr?: string
  stdout?: string
}): AgentResult<never, AgentExecutionError> => ({
  error: {
    code,
    ...(exitCode === undefined ? {} : { exitCode }),
    message,
    ...(stderr ? { stderr } : {}),
    ...(stdout ? { stdout } : {})
  },
  ok: false
})

const getShellExecutionError = ({
  abortSignal,
  spawnError,
  stderr,
  stdout,
  timedOut
}: {
  abortSignal?: AbortSignal
  spawnError: Error | null
  stderr: string
  stdout: string
  timedOut: boolean
}): AgentResult<never, AgentExecutionError> | null => {
  if (spawnError) {
    return createExecutionError({
      code: "spawn",
      message: spawnError.message,
      stderr,
      stdout
    })
  }

  if (abortSignal?.aborted) {
    return createExecutionError({
      code: "aborted",
      message: "Command aborted.",
      stderr,
      stdout
    })
  }

  if (timedOut) {
    return createExecutionError({
      code: "timeout",
      message: "Command timed out.",
      stderr,
      stdout
    })
  }

  return null
}

const createAbortedFileError = (
  requestedPath: string
): AgentResult<never, AgentFileError> =>
  createFileError({
    code: "aborted",
    message: FILE_OPERATION_ABORTED_MESSAGE,
    requestedPath
  })

const getPreAbortedFileSystemResult = ({
  requestedPath,
  signal
}: {
  requestedPath: string
  signal?: AbortSignal
}): AgentResult<never, AgentFileError> | null =>
  signal?.aborted ? createAbortedFileError(requestedPath) : null

const getNodeErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }

  const { code } = error as { code?: unknown }

  return typeof code === "string" ? code : undefined
}

const toFileSystemError = ({
  error,
  requestedPath
}: {
  error: unknown
  requestedPath: string
}): AgentResult<never, AgentFileError> => {
  const causeCode = getNodeErrorCode(error)

  if (causeCode === "ABORT_ERR") {
    return createAbortedFileError(requestedPath)
  }

  if (causeCode === "ENOENT") {
    return createFileError({
      code: "not-found",
      message: "File does not exist.",
      requestedPath
    })
  }

  if (causeCode === "ENOTDIR") {
    return createFileError({
      code: "not-directory",
      message: "Path is not a directory.",
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

const resolveProjectFileSystemPath = ({
  normalizedProjectPath,
  requestedPath
}: {
  normalizedProjectPath: string
  requestedPath: string
}): AgentResult<
  {
    absolutePath: string
    relativePath: string
  },
  AgentFileError
> => {
  const absolutePath = path.resolve(normalizedProjectPath, requestedPath || ".")
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
      relativePath: normalizeFileSystemPath(relativePath) || "."
    }
  }
}

const getFileSystemInfoKind = (stats: fsSync.Stats): AgentFileInfo["kind"] => {
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

export const writeAgentCommandOutputArtifact = async ({
  command,
  cwd,
  exitCode,
  stderr,
  stdout
}: {
  command: string
  cwd: string
  exitCode: number | null
  stderr: string
  stdout: string
}): Promise<AgentCommandOutputRef> => {
  const artifactDir = path.join(os.tmpdir(), AGENT_ARTIFACT_DIR_NAME)
  const artifactPath = path.join(artifactDir, `${randomUUID()}.json`)
  const content = JSON.stringify({
    command,
    createdAt: new Date().toISOString(),
    cwd,
    exitCode,
    stderr,
    stdout,
    summary: {
      stderr: summarizeToolResult(stderr),
      stdout: summarizeToolResult(stdout)
    }
  })

  await fs.mkdir(artifactDir, { recursive: true })
  await fs.writeFile(artifactPath, content, "utf-8")

  return {
    byteLength: Buffer.byteLength(content, "utf-8"),
    kind: "command-output",
    path: artifactPath
  }
}

export const createAgentExecutionEnv = ({
  outputMaxChars = AGENT_TOOL_OUTPUT_MAX_CHARS,
  projectPath
}: CreateAgentExecutionEnvOptions): AgentExecutionEnv => {
  const normalizedProjectPath = path.resolve(projectPath)
  const realProjectPath = realpathIfExists(normalizedProjectPath)
  const fileSystemTempRootRelativePath = `${AGENT_FILE_SYSTEM_TEMP_DIR_NAME}/${randomUUID()}`
  const fileSystemTempRootAbsolutePath = path.join(
    normalizedProjectPath,
    fileSystemTempRootRelativePath
  )
  const resolveCwd = (cwd: string): string => {
    const resolvedCwd = path.resolve(normalizedProjectPath, cwd || ".")
    const realResolvedCwd = resolveRealCwd({
      normalizedProjectPath,
      realProjectPath,
      resolvedCwd
    })

    assertInsideProject(normalizedProjectPath, resolvedCwd)
    assertInsideProject(realProjectPath, realResolvedCwd)

    return resolvedCwd
  }
  const findExistingAncestorPath = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<AgentResult<string, AgentFileError>> => {
    let currentPath = absolutePath

    while (true) {
      try {
        await fs.lstat(currentPath)

        return {
          ok: true,
          value: currentPath
        }
      } catch (error) {
        if (getNodeErrorCode(error) !== "ENOENT") {
          return toFileSystemError({
            error,
            requestedPath
          })
        }

        const parentPath = path.dirname(currentPath)

        if (parentPath === currentPath) {
          return toFileSystemError({
            error,
            requestedPath
          })
        }

        currentPath = parentPath
      }
    }
  }
  const resolveCanonicalProjectPath = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<AgentResult<string, AgentFileError>> => {
    try {
      const realTargetPath = await fs.realpath(absolutePath)

      if (!isPathInsideRoot(realProjectPath, realTargetPath)) {
        return createFileError({
          code: "outside-project",
          message: "Path is outside project root.",
          requestedPath
        })
      }

      return {
        ok: true,
        value:
          normalizeFileSystemPath(
            path.relative(realProjectPath, realTargetPath)
          ) || "."
      }
    } catch (error) {
      return toFileSystemError({
        error,
        requestedPath
      })
    }
  }
  const ensureExistingAncestorInsideProject = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<AgentResult<void, AgentFileError>> => {
    const existingAncestorPath = await findExistingAncestorPath({
      absolutePath,
      requestedPath
    })

    if (!existingAncestorPath.ok) {
      return existingAncestorPath
    }

    const canonicalAncestorPath = await resolveCanonicalProjectPath({
      absolutePath: existingAncestorPath.value,
      requestedPath
    })

    if (!canonicalAncestorPath.ok) {
      return canonicalAncestorPath
    }

    return {
      ok: true,
      value: undefined
    }
  }
  const ensureResolvedParentInsideProject = ({
    requestedPath,
    resolvedPath
  }: {
    requestedPath: string
    resolvedPath: {
      absolutePath: string
      relativePath: string
    }
  }): Promise<AgentResult<void, AgentFileError>> => {
    if (resolvedPath.relativePath === ".") {
      return Promise.resolve({
        ok: true,
        value: undefined
      })
    }

    return ensureExistingAncestorInsideProject({
      absolutePath: path.dirname(resolvedPath.absolutePath),
      requestedPath
    })
  }
  const ensureFileSystemTempRoot = async (
    requestedPath: string
  ): Promise<AgentResult<void, AgentFileError>> => {
    const parentCheck = await ensureExistingAncestorInsideProject({
      absolutePath: path.dirname(fileSystemTempRootAbsolutePath),
      requestedPath
    })

    if (!parentCheck.ok) {
      return parentCheck
    }

    try {
      await fs.mkdir(fileSystemTempRootAbsolutePath, { recursive: true })

      return {
        ok: true,
        value: undefined
      }
    } catch (error) {
      return toFileSystemError({
        error,
        requestedPath
      })
    }
  }
  const ensureWritableFileTarget = async ({
    absolutePath,
    requestedPath
  }: {
    absolutePath: string
    requestedPath: string
  }): Promise<AgentResult<void, AgentFileError>> => {
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
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    }

    return {
      ok: true,
      value: undefined
    }
  }
  const getProjectFileInfo = async (
    requestedPath: string,
    signal?: AbortSignal
  ): Promise<AgentResult<AgentFileInfo, AgentFileError>> => {
    const aborted = getPreAbortedFileSystemResult({
      requestedPath,
      signal
    })

    if (aborted) {
      return aborted
    }

    const resolvedPath = resolveProjectFileSystemPath({
      normalizedProjectPath,
      requestedPath
    })

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
          kind: getFileSystemInfoKind(stats),
          mtimeMs: stats.mtimeMs,
          path: resolvedPath.value.relativePath,
          size: stats.size
        }
      }
    } catch (error) {
      return toFileSystemError({
        error,
        requestedPath
      })
    }
  }
  const fileSystem: AgentFileSystem = {
    absolutePath: (requestedPath, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return Promise.resolve(aborted)
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

      if (!resolvedPath.ok) {
        return Promise.resolve(resolvedPath)
      }

      return Promise.resolve({
        ok: true,
        value: resolvedPath.value.absolutePath
      })
    },
    appendFile: async (requestedPath, content, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

      if (!resolvedPath.ok) {
        return resolvedPath
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
        await fs.appendFile(resolvedPath.value.absolutePath, content, "utf-8")

        return {
          ok: true,
          value: undefined
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    canonicalPath: (requestedPath, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return Promise.resolve(aborted)
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

      if (!resolvedPath.ok) {
        return Promise.resolve(resolvedPath)
      }

      return resolveCanonicalProjectPath({
        absolutePath: resolvedPath.value.absolutePath,
        requestedPath
      })
    },
    cleanup: async () => {
      await fs
        .rm(fileSystemTempRootAbsolutePath, {
          force: true,
          recursive: true
        })
        .catch(ignoreFileSystemCleanupError)
    },
    createDir: async (requestedPath, options) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal: options?.signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

      if (!resolvedPath.ok) {
        return resolvedPath
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

        if (options?.recursive || resolvedPath.value.relativePath === ".") {
          return {
            ok: true,
            value: undefined
          }
        }
      } catch (error) {
        if (getNodeErrorCode(error) !== "ENOENT") {
          return toFileSystemError({
            error,
            requestedPath
          })
        }
      }

      const ancestorCheck = await ensureExistingAncestorInsideProject({
        absolutePath: path.dirname(resolvedPath.value.absolutePath),
        requestedPath
      })

      if (!ancestorCheck.ok) {
        return ancestorCheck
      }

      try {
        await fs.mkdir(resolvedPath.value.absolutePath, {
          recursive: options?.recursive ?? false
        })

        return {
          ok: true,
          value: undefined
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    createTempDir: async (prefix, signal) => {
      const requestedPath = `${fileSystemTempRootRelativePath}/${
        prefix ?? DEFAULT_FILE_SYSTEM_TEMP_PREFIX
      }`
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const tempRoot = await ensureFileSystemTempRoot(requestedPath)

      if (!tempRoot.ok) {
        return tempRoot
      }

      const safePrefix =
        sanitizeFileSystemTempNamePart(
          prefix ?? DEFAULT_FILE_SYSTEM_TEMP_PREFIX
        ) || DEFAULT_FILE_SYSTEM_TEMP_PREFIX

      try {
        const tempDirectoryPath = await fs.mkdtemp(
          path.join(fileSystemTempRootAbsolutePath, safePrefix)
        )

        return {
          ok: true,
          value: normalizeFileSystemPath(
            path.relative(normalizedProjectPath, tempDirectoryPath)
          )
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    createTempFile: async (options) => {
      const requestedPath = `${fileSystemTempRootRelativePath}/${
        options?.prefix ?? DEFAULT_FILE_SYSTEM_TEMP_PREFIX
      }${options?.suffix ?? ""}`
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal: options?.signal
      })

      if (aborted) {
        return aborted
      }

      const tempRoot = await ensureFileSystemTempRoot(requestedPath)

      if (!tempRoot.ok) {
        return tempRoot
      }

      const safePrefix =
        sanitizeFileSystemTempNamePart(
          options?.prefix ?? DEFAULT_FILE_SYSTEM_TEMP_PREFIX
        ) || DEFAULT_FILE_SYSTEM_TEMP_PREFIX
      const safeSuffix = sanitizeFileSystemTempNamePart(options?.suffix ?? "")
      const tempFilePath = path.join(
        fileSystemTempRootAbsolutePath,
        `${safePrefix}${randomUUID()}${safeSuffix}`
      )

      try {
        await fs.writeFile(tempFilePath, "", { flag: "wx" })

        return {
          ok: true,
          value: normalizeFileSystemPath(
            path.relative(normalizedProjectPath, tempFilePath)
          )
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    cwd: normalizedProjectPath,
    exists: async (requestedPath, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

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
        await fs.lstat(resolvedPath.value.absolutePath)

        return {
          ok: true,
          value: true
        }
      } catch (error) {
        if (getNodeErrorCode(error) === "ENOENT") {
          return {
            ok: true,
            value: false
          }
        }

        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    fileInfo: getProjectFileInfo,
    listDir: async (requestedPath, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

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

        const unsortedDirectoryEntries = await fs.readdir(
          resolvedPath.value.absolutePath
        )
        const directoryEntries = unsortedDirectoryEntries.toSorted()
        const fileInfos: AgentFileInfo[] = []

        for (const entryName of directoryEntries) {
          const entryPath =
            resolvedPath.value.relativePath === "."
              ? entryName
              : `${resolvedPath.value.relativePath}/${entryName}`
          const fileInfo = await getProjectFileInfo(entryPath)

          if (fileInfo.ok) {
            fileInfos.push(fileInfo.value)
          }
        }

        return {
          ok: true,
          value: fileInfos
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    readBinaryFile: async (requestedPath, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

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

        return {
          ok: true,
          value: new Uint8Array(
            await fs.readFile(resolvedPath.value.absolutePath)
          )
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    readTextFile: async (requestedPath, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

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

        return {
          ok: true,
          value: await fs.readFile(resolvedPath.value.absolutePath, "utf-8")
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    readTextLines: async (requestedPath, options) => {
      const textFile = await fileSystem.readTextFile(
        requestedPath,
        options?.signal
      )

      if (!textFile.ok) {
        return textFile
      }

      if (textFile.value.length === 0) {
        return {
          ok: true,
          value: []
        }
      }

      const lines = textFile.value.split(TEXT_LINE_BREAK_PATTERN)

      if (textFile.value.endsWith("\n")) {
        lines.pop()
      }

      return {
        ok: true,
        value:
          options?.maxLines === undefined
            ? lines
            : lines.slice(0, Math.max(0, options.maxLines))
      }
    },
    remove: async (requestedPath, options) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal: options?.signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

      if (!resolvedPath.ok) {
        return resolvedPath
      }

      if (resolvedPath.value.relativePath === ".") {
        return createFileError({
          code: "io-error",
          message: "Cannot remove project root.",
          requestedPath
        })
      }

      const ancestorCheck = await ensureExistingAncestorInsideProject({
        absolutePath: path.dirname(resolvedPath.value.absolutePath),
        requestedPath
      })

      if (!ancestorCheck.ok) {
        return ancestorCheck
      }

      try {
        await fs.rm(resolvedPath.value.absolutePath, {
          force: options?.force ?? false,
          recursive: options?.recursive ?? false
        })

        return {
          ok: true,
          value: undefined
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    },
    writeFile: async (requestedPath, content, signal) => {
      const aborted = getPreAbortedFileSystemResult({
        requestedPath,
        signal
      })

      if (aborted) {
        return aborted
      }

      const resolvedPath = resolveProjectFileSystemPath({
        normalizedProjectPath,
        requestedPath
      })

      if (!resolvedPath.ok) {
        return resolvedPath
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
        await fs.writeFile(resolvedPath.value.absolutePath, content)

        return {
          ok: true,
          value: undefined
        }
      } catch (error) {
        return toFileSystemError({
          error,
          requestedPath
        })
      }
    }
  }

  const shell: AgentShell = {
    cleanup: () => Promise.resolve(),
    exec: async (command, options) => {
      const abortSignal = options?.abortSignal

      if (abortSignal?.aborted) {
        return createExecutionError({
          code: "aborted",
          message: "Command aborted."
        })
      }

      const timeoutMs = options?.timeout ?? DEFAULT_AGENT_SHELL_TIMEOUT_MS
      let stderr = ""
      let stdout = ""
      let timedOut = false
      const stderrDecoder = createCommandOutputDecoder()
      const stdoutDecoder = createCommandOutputDecoder()
      let outputSequence = 0
      const child = spawn("/bin/zsh", ["-fc", command], {
        cwd: resolveCwd(options?.cwd ?? ""),
        env: {
          ...process.env,
          ...options?.env
        },
        stdio: ["pipe", "pipe", "pipe"]
      })
      const spawnErrorRef: { value: Error | null } = { value: null }
      const emitOutput = (
        channel: AgentShellOutputChannel,
        chunk: string
      ): void => {
        if (chunk.length === 0) {
          return
        }

        options?.onOutput?.({
          channel,
          chunk,
          sequence: outputSequence
        })
        outputSequence += 1
      }
      const appendStderr = (chunk: Buffer): void => {
        const text = stderrDecoder.write(chunk)

        stderr = `${stderr}${text}`
        emitOutput("stderr", text)
        options?.onStderr?.(text)
      }
      const appendStdout = (chunk: Buffer): void => {
        const text = stdoutDecoder.write(chunk)

        stdout = `${stdout}${text}`
        emitOutput("stdout", text)
        options?.onStdout?.(text)
      }
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
      }, timeoutMs)
      const abortCommand = (): void => {
        child.kill("SIGTERM")
      }

      child.once("error", (error) => {
        spawnErrorRef.value = error
      })
      child.stderr.on("data", appendStderr)
      child.stdout.on("data", appendStdout)
      abortSignal?.addEventListener("abort", abortCommand, {
        once: true
      })

      if (options?.stdin) {
        child.stdin.write(options.stdin)
      }

      child.stdin.end()

      const [exitCode] = (await once(child, "close")) as [number | null]
      const stdoutRemainder = stdoutDecoder.end()
      const stderrRemainder = stderrDecoder.end()

      stdout = `${stdout}${stdoutRemainder}`
      stderr = `${stderr}${stderrRemainder}`
      emitOutput("stdout", stdoutRemainder)
      emitOutput("stderr", stderrRemainder)
      options?.onStdout?.(stdoutRemainder)
      options?.onStderr?.(stderrRemainder)

      clearTimeout(timeout)
      abortSignal?.removeEventListener("abort", abortCommand)

      const executionError = getShellExecutionError({
        abortSignal,
        spawnError: spawnErrorRef.value,
        stderr,
        stdout,
        timedOut
      })

      if (executionError) {
        return executionError
      }

      return {
        ok: true,
        value: {
          exitCode,
          stderr,
          stdout
        }
      }
    }
  }

  const runShellCommand = async ({
    abortSignal,
    command,
    cwd,
    stdin,
    timeoutMs
  }: RunShellCommandOptions): Promise<AgentCommandOutput> => {
    if (abortSignal?.aborted) {
      throw new Error("Command aborted.")
    }

    const startedAt = Date.now()
    let stderr = ""
    let stdout = ""
    let timedOut = false
    const stderrDecoder = createCommandOutputDecoder()
    const stdoutDecoder = createCommandOutputDecoder()
    const child = spawn("/bin/zsh", ["-lc", command], {
      cwd: resolveCwd(cwd),
      stdio: ["pipe", "pipe", "pipe"]
    })
    const appendStderr = (chunk: Buffer): void => {
      stderr = `${stderr}${stderrDecoder.write(chunk)}`
    }
    const appendStdout = (chunk: Buffer): void => {
      stdout = `${stdout}${stdoutDecoder.write(chunk)}`
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)
    const abortCommand = (): void => {
      child.kill("SIGTERM")
    }

    child.stderr.on("data", appendStderr)
    child.stdout.on("data", appendStdout)
    abortSignal?.addEventListener("abort", abortCommand, { once: true })

    if (stdin) {
      child.stdin.write(stdin)
    }

    child.stdin.end()

    const [exitCode] = (await once(child, "close")) as [number | null]

    stdout = `${stdout}${stdoutDecoder.end()}`
    stderr = `${stderr}${stderrDecoder.end()}`

    clearTimeout(timeout)
    abortSignal?.removeEventListener("abort", abortCommand)

    let stderrText = stderr

    if (abortSignal?.aborted) {
      stderrText = `${stderr}\nCommand aborted.`
    } else if (timedOut) {
      stderrText = `${stderr}\nCommand timed out.`
    }

    const resolvedCwd = resolveCwd(cwd)
    const stderrOutput = clampToolOutput(stderrText, outputMaxChars)
    const stdoutOutput = clampToolOutput(stdout, outputMaxChars)
    const truncated = stderrOutput.truncated || stdoutOutput.truncated
    const outputRef = truncated
      ? await writeAgentCommandOutputArtifact({
          command,
          cwd: resolvedCwd,
          exitCode,
          stderr,
          stdout
        })
      : null

    return {
      durationMs: Date.now() - startedAt,
      exitCode,
      outputRef,
      stderrPreview: stderrOutput.content,
      stdoutPreview: stdoutOutput.content,
      status:
        exitCode === 0 && !(abortSignal?.aborted || timedOut)
          ? "success"
          : "failed",
      truncated
    }
  }

  return {
    fileSystem,
    projectPath: normalizedProjectPath,
    resolveCwd,
    runShellCommand,
    shell
  }
}
