import { spawn } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"

import type { AgentSandboxSettings } from "@etyon/rpc"

import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  clampToolOutput,
  summarizeToolResult,
  truncateHead
} from "@/main/agents/truncate"
import { createWorkspaceSandbox } from "@/main/agents/workspace-sandbox"
import type {
  WorkspaceSandbox,
  WorkspaceSandboxSpawnConfig
} from "@/main/agents/workspace-sandbox"

export {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  clampToolOutput,
  createToolResultSummaryCache,
  appendToolResultSummaryAnnotation,
  formatToolResultSummaryAnnotation,
  formatSize,
  summarizeToolResult,
  summarizeToolResultWithProcessor,
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
const FORCE_KILL_GRACE_MS = 250
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
  | "process-not-found"
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

interface AgentShellEventBase {
  command: string
  cwd: string
  sandboxed: boolean
  sequence: number
}

export interface AgentShellStartedEvent extends AgentShellEventBase {
  args: readonly string[]
  pid: number | null
  startedAt: string
  type: "started"
}

export interface AgentShellLifecycleOutputEvent extends AgentShellEventBase {
  channel: AgentShellOutputChannel
  chunk: string
  outputSequence: number
  type: "output"
}

export type AgentShellFinishedStatus =
  | "aborted"
  | "exited"
  | "spawn_error"
  | "timed_out"

export interface AgentShellFinishedEvent extends AgentShellEventBase {
  durationMs: number
  exitCode: number | null
  status: AgentShellFinishedStatus
  stderrChars: number
  stdoutChars: number
  type: "finished"
}

export type AgentShellEvent =
  | AgentShellFinishedEvent
  | AgentShellLifecycleOutputEvent
  | AgentShellStartedEvent

export interface AgentShellExecOptions {
  abortSignal?: AbortSignal
  cwd?: string
  env?: Record<string, string>
  onEvent?: (event: AgentShellEvent) => void
  onOutput?: (event: AgentShellOutputEvent) => void
  stdin?: string
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  timeout?: number
}

export interface AgentShellResult {
  durationMs: number
  exitCode: number | null
  sandboxed: boolean
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

export type AgentBackgroundProcessStatus =
  | "exited"
  | "running"
  | "spawn_error"
  | "stopped"

export interface AgentBackgroundProcessOutputEvent {
  channel: AgentShellOutputChannel
  chunk: string
  processId: string
  sequence: number
  type: "output"
}

export interface AgentBackgroundProcessStartedEvent {
  command: string
  cwd: string
  pid: number | null
  processId: string
  sandboxed: boolean
  startedAt: string
  type: "started"
}

export interface AgentBackgroundProcessFinishedEvent {
  command: string
  cwd: string
  durationMs: number
  exitCode: number | null
  finishedAt: string
  processId: string
  sandboxed: boolean
  status: AgentBackgroundProcessStatus
  stderrChars: number
  stdoutChars: number
  type: "finished"
}

export type AgentBackgroundProcessEvent =
  | AgentBackgroundProcessFinishedEvent
  | AgentBackgroundProcessOutputEvent
  | AgentBackgroundProcessStartedEvent

export interface AgentBackgroundProcessSnapshot {
  command: string
  cwd: string
  durationMs: number
  errorMessage?: string
  exitCode: number | null
  finishedAt: string | null
  id: string
  pid: number | null
  sandboxed: boolean
  startedAt: string
  status: AgentBackgroundProcessStatus
  stderrChars: number
  stderrPreview: string
  stdoutChars: number
  stdoutPreview: string
  truncated: boolean
}

export interface AgentBackgroundProcessStartOptions {
  cwd?: string
  env?: Record<string, string>
  onEvent?: (event: AgentBackgroundProcessEvent) => void
  onOutput?: (event: AgentBackgroundProcessOutputEvent) => void
  stdin?: string
}

export interface AgentBackgroundProcessRecoverInput {
  command: string
  cwd: string
  exitCode?: number | null
  finishedAt?: string | null
  id: string
  pid: number | null
  sandboxed: boolean
  startedAt: string
  status?: AgentBackgroundProcessStatus
  stderr?: string
  stdout?: string
}

export interface AgentBackgroundProcessRecoverOptions {
  onEvent?: (event: AgentBackgroundProcessEvent) => void
  onOutput?: (event: AgentBackgroundProcessOutputEvent) => void
}

export interface AgentBackgroundProcesses {
  cleanup: () => Promise<void>
  get: (processId: string) => AgentBackgroundProcessSnapshot | null
  list: () => AgentBackgroundProcessSnapshot[]
  recover: (
    input: AgentBackgroundProcessRecoverInput,
    options?: AgentBackgroundProcessRecoverOptions
  ) => AgentBackgroundProcessSnapshot
  start: (
    command: string,
    options?: AgentBackgroundProcessStartOptions
  ) => Promise<AgentResult<AgentBackgroundProcessSnapshot, AgentExecutionError>>
  stop: (
    processId: string
  ) => Promise<AgentResult<AgentBackgroundProcessSnapshot, AgentExecutionError>>
}

export interface AgentBackgroundProcessStore {
  records: Map<string, unknown>
}

export interface AgentExecutionEnv {
  backgroundProcesses: AgentBackgroundProcesses
  fileSystem: AgentFileSystem
  projectPath: string
  resolveCwd: (cwd: string) => string
  runShellCommand: (
    options: RunShellCommandOptions
  ) => Promise<AgentCommandOutput>
  sandbox: WorkspaceSandbox
  shell: AgentShell
}

export interface CreateAgentExecutionEnvOptions {
  backgroundProcessStore?: AgentBackgroundProcessStore
  outputMaxChars?: number
  projectPath: string
  sandbox?: WorkspaceSandbox
  sandboxSettings?: AgentSandboxSettings
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

const killChildProcessTree = (
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals
): void => {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall back to the direct child when process-group signaling is unavailable.
    }
  }

  child.kill(signal)
}

const createChildProcessTerminator = (
  child: ChildProcessWithoutNullStreams
): {
  cleanup: () => void
  terminate: () => void
} => {
  let forceKillTimeout: NodeJS.Timeout | undefined

  return {
    cleanup: () => {
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout)
      }
    },
    terminate: () => {
      killChildProcessTree(child, "SIGTERM")
      forceKillTimeout = setTimeout(() => {
        killChildProcessTree(child, "SIGKILL")
      }, FORCE_KILL_GRACE_MS)
    }
  }
}

const killRecoveredProcessTree = (
  pid: number | null,
  signal: NodeJS.Signals
): void => {
  if (!pid) {
    return
  }

  try {
    process.kill(-pid, signal)
    return
  } catch {
    // Fall back to direct pid when process-group signaling is unavailable.
  }

  try {
    process.kill(pid, signal)
  } catch {
    // The process may already be gone after app restart.
  }
}

const createRecoveredProcessTerminator = (
  pid: number | null
): {
  cleanup: () => void
  terminate: () => void
} => {
  let forceKillTimeout: NodeJS.Timeout | undefined

  return {
    cleanup: () => {
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout)
      }
    },
    terminate: () => {
      killRecoveredProcessTree(pid, "SIGTERM")
      forceKillTimeout = setTimeout(() => {
        killRecoveredProcessTree(pid, "SIGKILL")
      }, FORCE_KILL_GRACE_MS)
    }
  }
}

const emitShellOutputEvent = ({
  channel,
  chunk,
  onOutput,
  sequenceRef
}: {
  channel: AgentShellOutputChannel
  chunk: string
  onOutput?: (event: AgentShellOutputEvent) => void
  sequenceRef: {
    value: number
  }
}): number | null => {
  if (chunk.length === 0) {
    return null
  }

  const sequence = sequenceRef.value

  onOutput?.({
    channel,
    chunk,
    sequence
  })
  sequenceRef.value += 1

  return sequence
}

const createCommandOutputDecoder = () => {
  const decoder = new StringDecoder("utf-8")

  return {
    end: (): string => sanitizeCommandOutput(decoder.end()),
    write: (chunk: Buffer): string =>
      sanitizeCommandOutput(decoder.write(chunk))
  }
}

interface AgentBackgroundProcessRecord {
  child?: ChildProcessWithoutNullStreams
  cleanupPreparedCommand: () => Promise<void>
  closed: Promise<void>
  command: string
  cwd: string
  errorMessage?: string
  exitCode: number | null
  finishedAtMs: number | null
  id: string
  onEvent?: (event: AgentBackgroundProcessEvent) => void
  onOutput?: (event: AgentBackgroundProcessOutputEvent) => void
  outputSequence: number
  pid: number | null
  sandboxed: boolean
  startedAtMs: number
  status: AgentBackgroundProcessStatus
  stderr: string
  stderrDecoder: ReturnType<typeof createCommandOutputDecoder>
  stdout: string
  stdoutDecoder: ReturnType<typeof createCommandOutputDecoder>
  stopRequested: boolean
  terminator?: ReturnType<typeof createChildProcessTerminator>
}

export const createAgentBackgroundProcessStore =
  (): AgentBackgroundProcessStore => ({
    records: new Map()
  })

const getBackgroundProcessRecords = (
  store?: AgentBackgroundProcessStore
): Map<string, AgentBackgroundProcessRecord> =>
  (store?.records as Map<string, AgentBackgroundProcessRecord> | undefined) ??
  new Map()

const countTextChars = (content: string): number => [...content].length

const createCleanupOnce = (
  cleanup: () => Promise<void>
): (() => Promise<void>) => {
  let cleanupPromise: Promise<void> | null = null

  return () => {
    cleanupPromise ??= cleanup()

    return cleanupPromise
  }
}

const waitForChildProcessClose = async (
  child: ChildProcessWithoutNullStreams
): Promise<void> => {
  try {
    await once(child, "close")
  } catch {
    // The close listener can be rejected by a spawn error; the error handler
    // settles the process record separately.
  }
}

const appendBackgroundProcessOutput = ({
  channel,
  chunk,
  record
}: {
  channel: AgentShellOutputChannel
  chunk: Buffer | string
  record: AgentBackgroundProcessRecord
}): void => {
  let text: string

  if (typeof chunk === "string") {
    text = sanitizeCommandOutput(chunk)
  } else if (channel === "stdout") {
    text = record.stdoutDecoder.write(chunk)
  } else {
    text = record.stderrDecoder.write(chunk)
  }

  if (text.length === 0) {
    return
  }

  if (channel === "stdout") {
    record.stdout = `${record.stdout}${text}`
  } else {
    record.stderr = `${record.stderr}${text}`
  }

  const event: AgentBackgroundProcessOutputEvent = {
    channel,
    chunk: text,
    processId: record.id,
    sequence: record.outputSequence,
    type: "output"
  }

  record.onEvent?.(event)
  record.onOutput?.(event)
  record.outputSequence += 1
}

const finishBackgroundProcessOutput = (
  record: AgentBackgroundProcessRecord
): void => {
  appendBackgroundProcessOutput({
    channel: "stdout",
    chunk: record.stdoutDecoder.end(),
    record
  })
  appendBackgroundProcessOutput({
    channel: "stderr",
    chunk: record.stderrDecoder.end(),
    record
  })
}

const createBackgroundProcessSnapshot = ({
  outputMaxChars,
  record
}: {
  outputMaxChars: number
  record: AgentBackgroundProcessRecord
}): AgentBackgroundProcessSnapshot => {
  const stderrPreview = truncateHead(record.stderr, outputMaxChars)
  const stdoutPreview = truncateHead(record.stdout, outputMaxChars)
  const { finishedAtMs } = record
  const finishedAt = finishedAtMs ? new Date(finishedAtMs).toISOString() : null

  return {
    command: record.command,
    cwd: record.cwd,
    durationMs: (finishedAtMs ?? Date.now()) - record.startedAtMs,
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
    exitCode: record.exitCode,
    finishedAt,
    id: record.id,
    pid: record.pid,
    sandboxed: record.sandboxed,
    startedAt: new Date(record.startedAtMs).toISOString(),
    status: record.status,
    stderrChars: countTextChars(record.stderr),
    stderrPreview: stderrPreview.content,
    stdoutChars: countTextChars(record.stdout),
    stdoutPreview: stdoutPreview.content,
    truncated: stderrPreview.truncated || stdoutPreview.truncated
  }
}

const isBackgroundProcessTerminal = (
  status: AgentBackgroundProcessStatus
): boolean => status !== "running"

const isRecoveredPidRunning = (pid: number | null): boolean => {
  if (!pid) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false
    }

    return true
  }
}

const settleBackgroundProcess = async ({
  errorMessage,
  exitCode,
  record,
  status
}: {
  errorMessage?: string
  exitCode: number | null
  record: AgentBackgroundProcessRecord
  status: AgentBackgroundProcessStatus
}): Promise<void> => {
  if (record.finishedAtMs !== null) {
    return
  }

  finishBackgroundProcessOutput(record)
  if (errorMessage) {
    record.errorMessage = errorMessage
  }
  record.exitCode = exitCode
  record.finishedAtMs = Date.now()
  record.status = record.stopRequested ? "stopped" : status
  record.terminator?.cleanup()
  record.onEvent?.({
    command: record.command,
    cwd: record.cwd,
    durationMs: record.finishedAtMs - record.startedAtMs,
    exitCode: record.exitCode,
    finishedAt: new Date(record.finishedAtMs).toISOString(),
    processId: record.id,
    sandboxed: record.sandboxed,
    status: record.status,
    stderrChars: countTextChars(record.stderr),
    stdoutChars: countTextChars(record.stdout),
    type: "finished"
  })

  await record.cleanupPreparedCommand()
}

const createRecoveredBackgroundProcessRecord = ({
  input,
  onEvent,
  onOutput
}: {
  input: AgentBackgroundProcessRecoverInput
  onEvent?: (event: AgentBackgroundProcessEvent) => void
  onOutput?: (event: AgentBackgroundProcessOutputEvent) => void
}): AgentBackgroundProcessRecord => {
  const startedAtMs = Date.parse(input.startedAt)
  const validStartedAtMs = Number.isFinite(startedAtMs)
    ? startedAtMs
    : Date.now()
  const parsedFinishedAtMs = input.finishedAt
    ? Date.parse(input.finishedAt)
    : Number.NaN
  const finishedAtMs = Number.isFinite(parsedFinishedAtMs)
    ? parsedFinishedAtMs
    : null
  const inferredStatus =
    input.status ??
    (finishedAtMs !== null || !isRecoveredPidRunning(input.pid)
      ? "exited"
      : "running")

  return {
    cleanupPreparedCommand: () => Promise.resolve(),
    closed: Promise.resolve(),
    command: input.command,
    cwd: input.cwd,
    exitCode: input.exitCode ?? null,
    finishedAtMs:
      finishedAtMs ?? (inferredStatus === "running" ? null : Date.now()),
    id: input.id,
    ...(onEvent ? { onEvent } : {}),
    ...(onOutput ? { onOutput } : {}),
    outputSequence: 0,
    pid: input.pid,
    sandboxed: input.sandboxed,
    startedAtMs: validStartedAtMs,
    status: inferredStatus,
    stderr: input.stderr ?? "",
    stderrDecoder: createCommandOutputDecoder(),
    stdout: input.stdout ?? "",
    stdoutDecoder: createCommandOutputDecoder(),
    stopRequested: false,
    terminator: createRecoveredProcessTerminator(input.pid)
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

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

const writeChildStdin = ({
  child,
  onError,
  stdin = ""
}: {
  child: ChildProcessWithoutNullStreams
  onError: (error: Error) => void
  stdin?: string
}): void => {
  const handleError = (error: Error): void => {
    if (getNodeErrorCode(error) !== "EPIPE") {
      onError(error)
    }
  }
  const canListenToErrors =
    typeof child.stdin.on === "function" &&
    typeof child.stdin.removeListener === "function"

  if (canListenToErrors) {
    child.stdin.on("error", handleError)
  }

  try {
    child.stdin.end(stdin)
  } catch (error) {
    if (canListenToErrors) {
      child.stdin.removeListener("error", handleError)
    }

    const normalizedError = toError(error)

    if (getNodeErrorCode(normalizedError) !== "EPIPE") {
      onError(normalizedError)
    }
  }
}

const getShellFinishedStatus = ({
  abortSignal,
  spawnError,
  timedOut
}: {
  abortSignal?: AbortSignal
  spawnError: Error | null
  timedOut: boolean
}): AgentShellFinishedStatus => {
  if (spawnError) {
    return "spawn_error"
  }

  if (abortSignal?.aborted) {
    return "aborted"
  }

  if (timedOut) {
    return "timed_out"
  }

  return "exited"
}

const createCommandAbortedExecutionError = (): AgentResult<
  never,
  AgentExecutionError
> =>
  createExecutionError({
    code: "aborted",
    message: "Command aborted."
  })

const createShellOutputCapture = ({
  command,
  cwd,
  eventSequenceRef,
  options,
  sandboxed
}: {
  command: string
  cwd: string
  eventSequenceRef: {
    value: number
  }
  options?: AgentShellExecOptions
  sandboxed: boolean
}): {
  appendStderr: (chunk: Buffer) => void
  appendStdout: (chunk: Buffer) => void
  finish: () => {
    stderr: string
    stdout: string
  }
} => {
  let stderr = ""
  let stdout = ""
  const stderrDecoder = createCommandOutputDecoder()
  const stdoutDecoder = createCommandOutputDecoder()
  const outputSequenceRef = {
    value: 0
  }
  const emitOutput = (
    channel: AgentShellOutputChannel,
    chunk: string
  ): void => {
    const outputSequence = emitShellOutputEvent({
      channel,
      chunk,
      onOutput: options?.onOutput,
      sequenceRef: outputSequenceRef
    })

    if (outputSequence === null) {
      return
    }

    options?.onEvent?.({
      channel,
      chunk,
      command,
      cwd,
      outputSequence,
      sandboxed,
      sequence: eventSequenceRef.value,
      type: "output"
    })
    eventSequenceRef.value += 1
  }

  return {
    appendStderr: (chunk) => {
      const text = stderrDecoder.write(chunk)

      stderr = `${stderr}${text}`
      emitOutput("stderr", text)
      options?.onStderr?.(text)
    },
    appendStdout: (chunk) => {
      const text = stdoutDecoder.write(chunk)

      stdout = `${stdout}${text}`
      emitOutput("stdout", text)
      options?.onStdout?.(text)
    },
    finish: () => {
      const stdoutRemainder = stdoutDecoder.end()
      const stderrRemainder = stderrDecoder.end()

      stdout = `${stdout}${stdoutRemainder}`
      stderr = `${stderr}${stderrRemainder}`
      emitOutput("stdout", stdoutRemainder)
      emitOutput("stderr", stderrRemainder)
      options?.onStdout?.(stdoutRemainder)
      options?.onStderr?.(stderrRemainder)

      return {
        stderr,
        stdout
      }
    }
  }
}

const executePreparedShellCommand = async ({
  abortSignal,
  command,
  options,
  preparedCommand,
  timeoutMs
}: {
  abortSignal?: AbortSignal
  command: string
  options?: AgentShellExecOptions
  preparedCommand: WorkspaceSandboxSpawnConfig
  timeoutMs: number
}): Promise<AgentResult<AgentShellResult, AgentExecutionError>> => {
  let timedOut = false
  const startedAt = Date.now()
  const eventSequenceRef = {
    value: 0
  }
  const child = spawn(preparedCommand.command, preparedCommand.args, {
    cwd: preparedCommand.cwd,
    detached: true,
    env: preparedCommand.env,
    stdio: ["pipe", "pipe", "pipe"]
  })
  const childTerminator = createChildProcessTerminator(child)
  const outputCapture = createShellOutputCapture({
    command,
    cwd: preparedCommand.cwd,
    eventSequenceRef,
    options,
    sandboxed: preparedCommand.sandboxed
  })
  const spawnErrorRef: { value: Error | null } = { value: null }
  const timeout = setTimeout(() => {
    timedOut = true
    childTerminator.terminate()
  }, timeoutMs)
  const abortCommand = (): void => {
    childTerminator.terminate()
  }

  options?.onEvent?.({
    args: preparedCommand.args,
    command,
    cwd: preparedCommand.cwd,
    pid: child.pid ?? null,
    sandboxed: preparedCommand.sandboxed,
    sequence: eventSequenceRef.value,
    startedAt: new Date(startedAt).toISOString(),
    type: "started"
  })
  eventSequenceRef.value += 1
  child.once("error", (error) => {
    spawnErrorRef.value = error
  })
  child.stderr.on("data", outputCapture.appendStderr)
  child.stdout.on("data", outputCapture.appendStdout)
  abortSignal?.addEventListener("abort", abortCommand, {
    once: true
  })

  writeChildStdin({
    child,
    onError: (error) => {
      spawnErrorRef.value = error
    },
    stdin: options?.stdin
  })

  const [exitCode] = (await once(child, "close")) as [number | null]
  const { stderr, stdout } = outputCapture.finish()

  await preparedCommand.cleanup()
  clearTimeout(timeout)
  childTerminator.cleanup()
  abortSignal?.removeEventListener("abort", abortCommand)
  const durationMs = Date.now() - startedAt
  const status = getShellFinishedStatus({
    abortSignal,
    spawnError: spawnErrorRef.value,
    timedOut
  })

  options?.onEvent?.({
    command,
    cwd: preparedCommand.cwd,
    durationMs,
    exitCode,
    sandboxed: preparedCommand.sandboxed,
    sequence: eventSequenceRef.value,
    status,
    stderrChars: [...stderr].length,
    stdoutChars: [...stdout].length,
    type: "finished"
  })
  eventSequenceRef.value += 1

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
      durationMs,
      exitCode,
      sandboxed: preparedCommand.sandboxed,
      stderr,
      stdout
    }
  }
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
  backgroundProcessStore,
  outputMaxChars = AGENT_TOOL_OUTPUT_MAX_CHARS,
  projectPath,
  sandbox: providedSandbox,
  sandboxSettings
}: CreateAgentExecutionEnvOptions): AgentExecutionEnv => {
  const normalizedProjectPath = path.resolve(projectPath)
  const realProjectPath = realpathIfExists(normalizedProjectPath)
  const fileSystemTempRootRelativePath = `${AGENT_FILE_SYSTEM_TEMP_DIR_NAME}/${randomUUID()}`
  const fileSystemTempRootAbsolutePath = path.join(
    normalizedProjectPath,
    fileSystemTempRootRelativePath
  )
  const sandbox =
    providedSandbox ??
    createWorkspaceSandbox({
      projectPath: normalizedProjectPath,
      settings: sandboxSettings
    })
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

  const backgroundProcessRecords = getBackgroundProcessRecords(
    backgroundProcessStore
  )
  const backgroundProcesses: AgentBackgroundProcesses = {
    cleanup: async () => {
      const closePromises: Promise<void>[] = []

      for (const record of backgroundProcessRecords.values()) {
        if (isBackgroundProcessTerminal(record.status)) {
          continue
        }

        record.stopRequested = true
        record.terminator?.terminate()
        closePromises.push(
          record.child
            ? record.closed
            : settleBackgroundProcess({
                exitCode: null,
                record,
                status: "stopped"
              })
        )
      }

      await Promise.all(closePromises)
      await sandbox.cleanup()
    },
    get: (processId) => {
      const record = backgroundProcessRecords.get(processId)

      return record
        ? createBackgroundProcessSnapshot({
            outputMaxChars,
            record
          })
        : null
    },
    list: () =>
      Array.from(backgroundProcessRecords.values(), (record) =>
        createBackgroundProcessSnapshot({
          outputMaxChars,
          record
        })
      ),
    recover: (input, options) => {
      const existingRecord = backgroundProcessRecords.get(input.id)

      if (existingRecord) {
        if (options?.onEvent) {
          existingRecord.onEvent = options.onEvent
        }

        if (options?.onOutput) {
          existingRecord.onOutput = options.onOutput
        }

        return createBackgroundProcessSnapshot({
          outputMaxChars,
          record: existingRecord
        })
      }

      const record = createRecoveredBackgroundProcessRecord({
        input,
        ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
        ...(options?.onOutput ? { onOutput: options.onOutput } : {})
      })

      backgroundProcessRecords.set(record.id, record)

      return createBackgroundProcessSnapshot({
        outputMaxChars,
        record
      })
    },
    start: async (command, options) => {
      const resolvedCwd = resolveCwd(options?.cwd ?? "")
      const preparedCommand = await sandbox.prepareShellCommand({
        command,
        cwd: resolvedCwd,
        env: {
          ...process.env,
          ...options?.env
        }
      })

      if (!preparedCommand.ok) {
        return createExecutionError({
          code: "spawn",
          message: preparedCommand.error.message
        })
      }

      const cleanupPreparedCommand = createCleanupOnce(
        preparedCommand.value.cleanup
      )
      let child: ChildProcessWithoutNullStreams

      try {
        child = spawn(
          preparedCommand.value.command,
          preparedCommand.value.args,
          {
            cwd: preparedCommand.value.cwd,
            detached: true,
            env: preparedCommand.value.env,
            stdio: ["pipe", "pipe", "pipe"]
          }
        )
      } catch (error) {
        await cleanupPreparedCommand()

        return createExecutionError({
          code: "spawn",
          message:
            error instanceof Error ? error.message : "Failed to spawn process."
        })
      }

      const closed = waitForChildProcessClose(child)
      const id = randomUUID()
      const record: AgentBackgroundProcessRecord = {
        child,
        cleanupPreparedCommand,
        closed,
        command,
        cwd: preparedCommand.value.cwd,
        exitCode: null,
        finishedAtMs: null,
        id,
        ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
        ...(options?.onOutput ? { onOutput: options.onOutput } : {}),
        outputSequence: 0,
        pid: child.pid ?? null,
        sandboxed: preparedCommand.value.sandboxed,
        startedAtMs: Date.now(),
        status: "running",
        stderr: "",
        stderrDecoder: createCommandOutputDecoder(),
        stdout: "",
        stdoutDecoder: createCommandOutputDecoder(),
        stopRequested: false,
        terminator: createChildProcessTerminator(child)
      }

      backgroundProcessRecords.set(id, record)
      record.onEvent?.({
        command,
        cwd: preparedCommand.value.cwd,
        pid: record.pid,
        processId: id,
        sandboxed: preparedCommand.value.sandboxed,
        startedAt: new Date(record.startedAtMs).toISOString(),
        type: "started"
      })

      child.stderr.on("data", (chunk: Buffer) => {
        appendBackgroundProcessOutput({
          channel: "stderr",
          chunk,
          record
        })
      })
      child.stdout.on("data", (chunk: Buffer) => {
        appendBackgroundProcessOutput({
          channel: "stdout",
          chunk,
          record
        })
      })
      child.once("error", (error) => {
        void settleBackgroundProcess({
          errorMessage: error.message,
          exitCode: null,
          record,
          status: "spawn_error"
        })
      })
      child.once("close", (exitCode) => {
        void settleBackgroundProcess({
          exitCode,
          record,
          status: "exited"
        })
      })

      writeChildStdin({
        child,
        onError: (error) => {
          void settleBackgroundProcess({
            errorMessage: error.message,
            exitCode: null,
            record,
            status: "spawn_error"
          })
        },
        stdin: options?.stdin
      })

      return {
        ok: true,
        value: createBackgroundProcessSnapshot({
          outputMaxChars,
          record
        })
      }
    },
    stop: async (processId) => {
      const record = backgroundProcessRecords.get(processId)

      if (!record) {
        return createExecutionError({
          code: "process-not-found",
          message: `Background process ${processId} was not found.`
        })
      }

      if (!isBackgroundProcessTerminal(record.status)) {
        record.stopRequested = true
        record.terminator?.terminate()
        await (record.child
          ? record.closed
          : settleBackgroundProcess({
              exitCode: null,
              record,
              status: "stopped"
            }))
      }

      return {
        ok: true,
        value: createBackgroundProcessSnapshot({
          outputMaxChars,
          record
        })
      }
    }
  }

  const shell: AgentShell = {
    cleanup: () => Promise.resolve(),
    exec: async (command, options) => {
      const abortSignal = options?.abortSignal

      if (abortSignal?.aborted) {
        return createCommandAbortedExecutionError()
      }

      const timeoutMs = options?.timeout ?? DEFAULT_AGENT_SHELL_TIMEOUT_MS
      const resolvedCwd = resolveCwd(options?.cwd ?? "")
      const sandboxedCommand = await sandbox.prepareShellCommand({
        command,
        cwd: resolvedCwd,
        env: {
          ...process.env,
          ...options?.env
        }
      })

      if (!sandboxedCommand.ok) {
        return createExecutionError({
          code: "spawn",
          message: sandboxedCommand.error.message
        })
      }

      if (abortSignal?.aborted) {
        await sandboxedCommand.value.cleanup()

        return createCommandAbortedExecutionError()
      }

      return executePreparedShellCommand({
        abortSignal,
        command,
        options,
        preparedCommand: sandboxedCommand.value,
        timeoutMs
      })
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
    const resolvedCwd = resolveCwd(cwd)
    const sandboxedCommand = await sandbox.prepareShellCommand({
      command,
      cwd: resolvedCwd,
      env: process.env
    })

    if (!sandboxedCommand.ok) {
      const stderrOutput = clampToolOutput(
        sandboxedCommand.error.message,
        outputMaxChars
      )

      return {
        durationMs: Date.now() - startedAt,
        exitCode: null,
        outputRef: null,
        stderrPreview: stderrOutput.content,
        stdoutPreview: "",
        status: "failed",
        truncated: stderrOutput.truncated
      }
    }

    if (abortSignal?.aborted) {
      await sandboxedCommand.value.cleanup()

      return {
        durationMs: Date.now() - startedAt,
        exitCode: null,
        outputRef: null,
        stderrPreview: "Command aborted.",
        stdoutPreview: "",
        status: "failed",
        truncated: false
      }
    }

    const child = spawn(
      sandboxedCommand.value.command,
      sandboxedCommand.value.args,
      {
        cwd: sandboxedCommand.value.cwd,
        detached: true,
        env: sandboxedCommand.value.env,
        stdio: ["pipe", "pipe", "pipe"]
      }
    )
    const childTerminator = createChildProcessTerminator(child)
    const stdinErrorRef: { value: Error | null } = { value: null }
    const appendStderr = (chunk: Buffer): void => {
      stderr = `${stderr}${stderrDecoder.write(chunk)}`
    }
    const appendStdout = (chunk: Buffer): void => {
      stdout = `${stdout}${stdoutDecoder.write(chunk)}`
    }
    const timeout = setTimeout(() => {
      timedOut = true
      childTerminator.terminate()
    }, timeoutMs)
    const abortCommand = (): void => {
      childTerminator.terminate()
    }

    child.stderr.on("data", appendStderr)
    child.stdout.on("data", appendStdout)
    abortSignal?.addEventListener("abort", abortCommand, { once: true })

    writeChildStdin({
      child,
      onError: (error) => {
        stdinErrorRef.value = error
      },
      stdin
    })

    const [exitCode] = (await once(child, "close")) as [number | null]

    stdout = `${stdout}${stdoutDecoder.end()}`
    stderr = `${stderr}${stderrDecoder.end()}`

    await sandboxedCommand.value.cleanup()

    clearTimeout(timeout)
    childTerminator.cleanup()
    abortSignal?.removeEventListener("abort", abortCommand)

    let stderrText = stderr

    if (abortSignal?.aborted) {
      stderrText = `${stderr}\nCommand aborted.`
    } else if (timedOut) {
      stderrText = `${stderr}\nCommand timed out.`
    } else if (stdinErrorRef.value) {
      stderrText = `${stderr}\n${stdinErrorRef.value.message}`
    }

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
        exitCode === 0 &&
        !(abortSignal?.aborted || timedOut) &&
        !stdinErrorRef.value
          ? "success"
          : "failed",
      truncated
    }
  }

  return {
    backgroundProcesses,
    fileSystem,
    projectPath: normalizedProjectPath,
    resolveCwd,
    runShellCommand,
    sandbox,
    shell
  }
}
