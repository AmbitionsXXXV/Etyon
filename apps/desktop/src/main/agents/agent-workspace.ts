import { isIP } from "node:net"
import path from "node:path"

import type {
  AgentSettings,
  GitProjectDiffOutput,
  ListProjectSnapshotFilesOutput,
  MemoryEntry,
  MemorySettings
} from "@etyon/rpc"

import {
  createAgentBackgroundProcessStore,
  createAgentExecutionEnv
} from "@/main/agents/execution-env"
import type {
  AgentBackgroundProcessEvent,
  AgentBackgroundProcessRecoverInput,
  AgentBackgroundProcessSnapshot,
  AgentBackgroundProcessStore,
  AgentExecutionEnv,
  AgentExecutionError,
  AgentFileError,
  AgentFileInfo,
  AgentFileSystem,
  AgentFileSystemCreateDirOptions,
  AgentFileSystemRemoveOptions,
  AgentFileSystemWriteContent,
  AgentResult,
  AgentShellEvent,
  AgentShellFinishedEvent,
  AgentShellResult
} from "@/main/agents/execution-env"
import { createAgentLspManager } from "@/main/agents/lsp-manager"
import type {
  AgentLspEvent,
  AgentLspManager,
  LspDiagnosticsResult,
  LspDocumentSymbolsInput,
  LspDocumentSymbolsResult,
  LspInspectInput,
  LspInspectResult,
  LspWorkspaceSymbolsInput,
  LspWorkspaceSymbolsResult
} from "@/main/agents/lsp-manager"
import type { WorkspaceSandbox } from "@/main/agents/workspace-sandbox"
import type { AppDatabase } from "@/main/db"
import { getGitProjectDiff } from "@/main/git-project-status"
import { retrieveMemoryEntries } from "@/main/memory/retrieval"
import { listProjectSnapshotFiles as readProjectSnapshotFiles } from "@/main/project-snapshot"

export interface AgentSandboxEvent {
  payload: unknown
  type:
    | "background_process_finished"
    | "background_process_output"
    | "background_process_started"
    | "sandbox_command_finished"
    | "sandbox_command_output"
    | "sandbox_command_started"
}

export type AgentWorkspaceEvent = AgentLspEvent | AgentSandboxEvent

export interface AgentWorkspaceFileView {
  content: string
  info: AgentFileInfo
}

export interface AgentWorkspaceWriteFileOptions {
  createParentDirectories?: boolean
  expectedMtimeMs?: number
  requireReadSnapshot?: boolean
  signal?: AbortSignal
}

export interface AgentWorkspaceWriteFileResult {
  bytesWritten: number
  info: AgentFileInfo
}

export interface AgentWorkspaceExecuteCommandOptions {
  abortSignal?: AbortSignal
  cwd?: string
  emitEvents?: boolean
  stdin?: string
  timeoutMs?: number
}

export interface AgentWorkspaceCommandExecution {
  durationMs: number
  eventsEnabled: boolean
  resolvedCwd: string
  result: AgentResult<AgentShellResult, AgentExecutionError>
  shellFinishedEvent: AgentShellFinishedEvent | null
}

export interface AgentWorkspaceProcessStartOptions {
  cwd?: string
}

export interface AgentWorkspaceGitDiffOptions {
  excludeSecretPaths?: boolean
  paths?: string[]
}

export interface AgentWorkspaceProjectSnapshotOptions {
  limit: number
  query: string
}

export interface AgentWorkspaceMemorySearchOptions {
  db: AppDatabase
  maxResults: number
  query: string
  settings: MemorySettings
}

export interface AgentWorkspaceWebSearchResult {
  snippet: string
  title: string
  url: string
}

export interface AgentWorkspaceWebSearchOutput {
  query: string
  results: AgentWorkspaceWebSearchResult[]
  truncated: boolean
}

export interface AgentWorkspaceWebExtractOutput {
  content: string
  contentType: string
  title: null | string
  truncated: boolean
  url: string
}

export interface AgentWorkspaceSearchCommandOptions {
  abortSignal?: AbortSignal
  args: readonly string[]
  requestedCwd?: string
  timeoutMs?: number
}

export interface AgentWorkspaceOperations {
  absolutePath: AgentFileSystem["absolutePath"]
  canonicalPath: AgentFileSystem["canonicalPath"]
  deleteFile: (
    requestedPath: string,
    options?: AgentFileSystemRemoveOptions
  ) => Promise<AgentResult<AgentFileInfo, AgentFileError>>
  executeCommand: (
    command: string,
    options?: AgentWorkspaceExecuteCommandOptions
  ) => Promise<AgentWorkspaceCommandExecution>
  fileStat: AgentFileSystem["fileInfo"]
  findFiles: (
    options: AgentWorkspaceSearchCommandOptions
  ) => Promise<AgentResult<string, AgentExecutionError>>
  gitDiff: (
    options?: AgentWorkspaceGitDiffOptions
  ) => Promise<GitProjectDiffOutput>
  getProcess: (processId: string) => AgentBackgroundProcessSnapshot | null
  listDir: AgentFileSystem["listDir"]
  listProjectSnapshotFiles: (
    options: AgentWorkspaceProjectSnapshotOptions
  ) => ListProjectSnapshotFilesOutput
  lspDocumentSymbols: (
    input: LspDocumentSymbolsInput
  ) => Promise<LspDocumentSymbolsResult>
  lspInspect: (input: LspInspectInput) => Promise<LspInspectResult>
  lspTouchFile: (path: string) => Promise<LspDiagnosticsResult | null>
  lspWorkspaceSymbols: (
    input: LspWorkspaceSymbolsInput
  ) => Promise<LspWorkspaceSymbolsResult>
  memorySearch: (
    options: AgentWorkspaceMemorySearchOptions
  ) => Promise<MemoryEntry[]>
  mkdir: (
    requestedPath: string,
    options?: AgentFileSystemCreateDirOptions
  ) => Promise<AgentResult<AgentFileInfo, AgentFileError>>
  readTextFile: AgentFileSystem["readTextFile"]
  recoverProcess: (
    input: AgentBackgroundProcessRecoverInput
  ) => AgentBackgroundProcessSnapshot
  searchContent: (
    options: AgentWorkspaceSearchCommandOptions
  ) => Promise<AgentResult<string, AgentExecutionError>>
  startProcess: (
    command: string,
    options?: AgentWorkspaceProcessStartOptions
  ) => Promise<AgentResult<AgentBackgroundProcessSnapshot, AgentExecutionError>>
  stopProcess: (
    processId: string
  ) => Promise<AgentResult<AgentBackgroundProcessSnapshot, AgentExecutionError>>
  view: (
    requestedPath: string,
    signal?: AbortSignal
  ) => Promise<AgentResult<AgentWorkspaceFileView, AgentFileError>>
  webExtract: (
    url: string,
    options: {
      abortSignal?: AbortSignal
      maxChars: number
    }
  ) => Promise<AgentResult<AgentWorkspaceWebExtractOutput, AgentExecutionError>>
  webSearch: (
    query: string,
    options: {
      abortSignal?: AbortSignal
      maxResults: number
    }
  ) => Promise<AgentResult<AgentWorkspaceWebSearchOutput, AgentExecutionError>>
  writeFile: (
    requestedPath: string,
    content: AgentFileSystemWriteContent,
    options?: AgentWorkspaceWriteFileOptions
  ) => Promise<AgentResult<AgentWorkspaceWriteFileResult, AgentFileError>>
}

export interface AgentWorkspace {
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  executionEnv: AgentExecutionEnv
  fileSystem: AgentFileSystem
  lsp: AgentLspManager | null
  operations: AgentWorkspaceOperations
  projectPath: string
  sandbox: WorkspaceSandbox
}

export interface CreateAgentWorkspaceOptions {
  chatSessionId?: string
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  projectPath: string
  settings: AgentSettings
}

const backgroundProcessStores = new Map<string, AgentBackgroundProcessStore>()
const backgroundProcessCleanups = new Map<string, () => Promise<void>>()
const lspManagers = new Map<string, AgentLspManager>()
const lspEventSinks = new Map<
  string,
  ((event: AgentWorkspaceEvent) => Promise<void> | void) | undefined
>()
const workspaceWriteQueues = new Map<string, Promise<void>>()
const WORKSPACE_SEARCH_COMMAND_TIMEOUT_MS = 120_000
const WORKSPACE_SHELL_SAFE_ARG_PATTERN = /^[\w./:=@%+,-]+$/u
const DUCKDUCKGO_SEARCH_URL = "https://api.duckduckgo.com/"
const PRIVATE_WEB_EXTRACT_TARGET_MESSAGE =
  "webExtract can only fetch public http(s) URLs; local and private network targets are not allowed."
const WEB_EXTRACT_MAX_REDIRECTS = 5

const getBackgroundProcessStoreKey = ({
  chatSessionId,
  projectPath
}: {
  chatSessionId?: string
  projectPath: string
}): string => `${path.resolve(projectPath)}\0${chatSessionId ?? ""}`

const getWorkspaceWriteLockKey = ({
  absolutePath,
  projectPath
}: {
  absolutePath: string
  projectPath: string
}): string => `${path.resolve(projectPath)}\0${path.resolve(absolutePath)}`

const waitForWorkspaceWriteQueue = async (
  queue: Promise<void>
): Promise<void> => {
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
    await waitForWorkspaceWriteQueue(previousQueue)
    await currentQueue.promise
  })()

  workspaceWriteQueues.set(lockKey, queuedOperation)
  await waitForWorkspaceWriteQueue(previousQueue)

  try {
    return await task()
  } finally {
    currentQueue.resolve(null)

    if (workspaceWriteQueues.get(lockKey) === queuedOperation) {
      workspaceWriteQueues.delete(lockKey)
    }
  }
}

const getAgentWorkspaceBackgroundProcessStore = ({
  chatSessionId,
  projectPath
}: {
  chatSessionId?: string
  projectPath: string
}): AgentBackgroundProcessStore => {
  const key = getBackgroundProcessStoreKey({
    chatSessionId,
    projectPath
  })
  const existingStore = backgroundProcessStores.get(key)

  if (existingStore) {
    return existingStore
  }

  const store = createAgentBackgroundProcessStore()

  backgroundProcessStores.set(key, store)

  return store
}

const getAgentWorkspaceLspManagerKey = ({
  chatSessionId,
  projectPath,
  settings
}: {
  chatSessionId?: string
  projectPath: string
  settings: AgentSettings
}): string =>
  [
    getBackgroundProcessStoreKey({
      chatSessionId,
      projectPath
    }),
    JSON.stringify({
      lsp: settings.lsp,
      sandbox: settings.sandbox
    })
  ].join("\0")

const getAgentWorkspaceLspManager = ({
  chatSessionId,
  eventSink,
  executionEnv,
  settings
}: {
  chatSessionId?: string
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  executionEnv: AgentExecutionEnv
  settings: AgentSettings
}): AgentLspManager | null => {
  if (!settings.lsp.enabled) {
    return null
  }

  if (settings.lsp.requireSandbox && !settings.sandbox.enabled) {
    return null
  }

  const key = getAgentWorkspaceLspManagerKey({
    chatSessionId,
    projectPath: executionEnv.projectPath,
    settings
  })
  const existingManager = lspManagers.get(key)

  lspEventSinks.set(key, eventSink)

  if (existingManager) {
    return existingManager
  }

  const manager = createAgentLspManager({
    eventSink: (event) => lspEventSinks.get(key)?.(event),
    fileSystem: executionEnv.fileSystem,
    projectPath: executionEnv.projectPath,
    sandbox: executionEnv.sandbox,
    settings: settings.lsp
  })

  lspManagers.set(key, manager)

  return manager
}

const createWorkspaceFileResult = <TValue>(
  value: TValue
): AgentResult<TValue, AgentFileError> => ({
  ok: true,
  value
})

const createWorkspaceFileError = ({
  code,
  message,
  requestedPath
}: {
  code: AgentFileError["code"]
  message: string
  requestedPath: string
}): AgentResult<never, AgentFileError> => ({
  error: {
    code,
    message,
    path: requestedPath
  },
  ok: false
})

const getWorkspaceContentByteLength = (
  content: AgentFileSystemWriteContent
): number =>
  typeof content === "string"
    ? Buffer.byteLength(content, "utf-8")
    : content.byteLength

const emitWorkspaceEvent = (
  eventSink: ((event: AgentWorkspaceEvent) => Promise<void> | void) | undefined,
  event: AgentWorkspaceEvent
): void => {
  void eventSink?.(event)
}

const createShellWorkspaceEventBridge = ({
  command,
  emitSandboxEvents,
  eventSink,
  resolvedCwd
}: {
  command: string
  emitSandboxEvents: boolean
  eventSink: ((event: AgentWorkspaceEvent) => Promise<void> | void) | undefined
  resolvedCwd: string
}): {
  getFinishedEvent: () => AgentShellFinishedEvent | null
  onEvent: (event: AgentShellEvent) => void
} => {
  let finishedEvent: AgentShellFinishedEvent | null = null

  return {
    getFinishedEvent: () => finishedEvent,
    onEvent: (event) => {
      if (!emitSandboxEvents) {
        return
      }

      switch (event.type) {
        case "finished": {
          finishedEvent = event
          break
        }
        case "output": {
          emitWorkspaceEvent(eventSink, {
            payload: {
              channel: event.channel,
              chunk: event.chunk,
              command,
              cwd: resolvedCwd,
              sequence: event.outputSequence
            },
            type: "sandbox_command_output"
          })
          break
        }
        case "started": {
          emitWorkspaceEvent(eventSink, {
            payload: {
              args: event.args,
              command,
              cwd: resolvedCwd,
              pid: event.pid,
              sandboxed: event.sandboxed,
              startedAt: event.startedAt
            },
            type: "sandbox_command_started"
          })
          break
        }
        default: {
          const exhaustiveEvent: never = event

          throw new Error(`Unknown shell event: ${exhaustiveEvent}`)
        }
      }
    }
  }
}

const createBackgroundProcessWorkspaceEventBridge = ({
  eventSink
}: {
  eventSink: ((event: AgentWorkspaceEvent) => Promise<void> | void) | undefined
}): ((event: AgentBackgroundProcessEvent) => void) => {
  const emitProcessEvent = (event: AgentBackgroundProcessEvent): void => {
    switch (event.type) {
      case "finished": {
        emitWorkspaceEvent(eventSink, {
          payload: {
            command: event.command,
            cwd: event.cwd,
            durationMs: event.durationMs,
            exitCode: event.exitCode,
            finishedAt: event.finishedAt,
            processId: event.processId,
            sandboxed: event.sandboxed,
            status: event.status,
            stderrChars: event.stderrChars,
            stdoutChars: event.stdoutChars
          },
          type: "background_process_finished"
        })
        break
      }
      case "output": {
        emitWorkspaceEvent(eventSink, {
          payload: {
            channel: event.channel,
            chunk: event.chunk,
            processId: event.processId,
            sequence: event.sequence
          },
          type: "background_process_output"
        })
        break
      }
      case "started": {
        emitWorkspaceEvent(eventSink, {
          payload: {
            command: event.command,
            cwd: event.cwd,
            pid: event.pid,
            processId: event.processId,
            sandboxed: event.sandboxed,
            startedAt: event.startedAt
          },
          type: "background_process_started"
        })
        break
      }
      default: {
        const exhaustiveEvent: never = event

        throw new Error(`Unknown background process event: ${exhaustiveEvent}`)
      }
    }
  }

  return emitProcessEvent
}

const getCommandDurationMs = ({
  result,
  shellFinishedEvent,
  startedAt
}: {
  result: AgentResult<AgentShellResult, AgentExecutionError>
  shellFinishedEvent: AgentShellFinishedEvent | null
  startedAt: number
}): number => {
  if (result.ok) {
    return result.value.durationMs
  }

  return shellFinishedEvent?.durationMs ?? Date.now() - startedAt
}

const shellQuoteArgument = (value: string): string =>
  WORKSPACE_SHELL_SAFE_ARG_PATTERN.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`

const createWorkspaceExecutionErrorResult = ({
  code = "unknown",
  exitCode,
  message,
  stderr,
  stdout
}: {
  code?: AgentExecutionError["code"]
  exitCode?: number | null
  message: string
  stderr?: string
  stdout?: string
}): AgentResult<string, AgentExecutionError> => ({
  error: {
    code,
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    message,
    ...(stderr ? { stderr } : {}),
    ...(stdout ? { stdout } : {})
  },
  ok: false
})

const createWorkspaceExecutionError = ({
  code = "unknown",
  message
}: {
  code?: AgentExecutionError["code"]
  message: string
}): AgentResult<never, AgentExecutionError> => ({
  error: {
    code,
    message
  },
  ok: false
})

const toWorkspaceExecutionError = (
  error: unknown,
  fallbackMessage: string
): AgentResult<never, AgentExecutionError> =>
  createWorkspaceExecutionError({
    message: error instanceof Error ? error.message : fallbackMessage
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getRecordString = (
  value: Record<string, unknown>,
  key: string
): string => {
  const rawValue = value[key]

  return typeof rawValue === "string" ? rawValue : ""
}

const buildDuckDuckGoSearchUrl = (query: string): string => {
  const searchUrl = new URL(DUCKDUCKGO_SEARCH_URL)

  searchUrl.searchParams.set("q", query)
  searchUrl.searchParams.set("format", "json")
  searchUrl.searchParams.set("no_redirect", "1")
  searchUrl.searchParams.set("no_html", "1")

  return searchUrl.toString()
}

const stripIpv6Brackets = (hostname: string): string =>
  hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname

const getIpv4Octets = (hostname: string): number[] | null => {
  const octets = hostname.split(".")

  if (octets.length !== 4) {
    return null
  }

  const values = octets.map(Number)

  return values.every(
    (value, index) =>
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 255 &&
      String(value) === octets[index]
  )
    ? values
    : null
}

const isPrivateIpv4Hostname = (hostname: string): boolean => {
  const octets = getIpv4Octets(hostname)

  if (!octets) {
    return false
  }

  const [first = 0, second = 0] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  )
}

const isPrivateIpv6Hostname = (hostname: string): boolean => {
  const normalizedHostname = stripIpv6Brackets(hostname).toLowerCase()

  return (
    normalizedHostname === "::" ||
    normalizedHostname === "::1" ||
    normalizedHostname.startsWith("fc") ||
    normalizedHostname.startsWith("fd") ||
    normalizedHostname.startsWith("fe80:") ||
    normalizedHostname.startsWith("::ffff:10.") ||
    normalizedHostname.startsWith("::ffff:127.") ||
    normalizedHostname.startsWith("::ffff:192.168.")
  )
}

const isLocalOrPrivateWebHostname = (hostname: string): boolean => {
  const normalizedHostname = stripIpv6Brackets(
    hostname.toLowerCase().replace(/\.$/u, "")
  )

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname === "host.docker.internal" ||
    normalizedHostname.endsWith(".local") ||
    normalizedHostname.endsWith(".localhost")
  ) {
    return true
  }

  if (isIP(normalizedHostname) === 4) {
    return isPrivateIpv4Hostname(normalizedHostname)
  }

  if (isIP(normalizedHostname) === 6) {
    return isPrivateIpv6Hostname(normalizedHostname)
  }

  return false
}

const validatePublicWebExtractUrl = (
  url: string
): AgentResult<void, AgentExecutionError> => {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch {
    return createWorkspaceExecutionError({
      message: "webExtract URL is invalid."
    })
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return createWorkspaceExecutionError({
      message: "webExtract URL must use http or https."
    })
  }

  if (isLocalOrPrivateWebHostname(parsedUrl.hostname)) {
    return createWorkspaceExecutionError({
      message: PRIVATE_WEB_EXTRACT_TARGET_MESSAGE
    })
  }

  return {
    ok: true,
    value: undefined
  }
}

const isWebExtractRedirectStatus = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308

const resolveWebExtractRedirectUrl = ({
  currentUrl,
  location
}: {
  currentUrl: string
  location: string
}): AgentResult<string, AgentExecutionError> => {
  try {
    return {
      ok: true,
      value: new URL(location, currentUrl).toString()
    }
  } catch {
    return createWorkspaceExecutionError({
      message: "webExtract redirect URL is invalid."
    })
  }
}

const fetchPublicWebExtractResponse = async ({
  abortSignal,
  url
}: {
  abortSignal?: AbortSignal
  url: string
}): Promise<
  AgentResult<
    {
      response: Response
      url: string
    },
    AgentExecutionError
  >
> => {
  let currentUrl = url

  for (let redirectCount = 0; redirectCount <= WEB_EXTRACT_MAX_REDIRECTS; ) {
    const urlValidation = validatePublicWebExtractUrl(currentUrl)

    if (!urlValidation.ok) {
      return urlValidation
    }

    let response: Response

    try {
      response = await fetch(currentUrl, {
        headers: {
          accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "user-agent": "Etyon Agent Web Extract"
        },
        redirect: "manual",
        signal: abortSignal
      })
    } catch (error) {
      return toWorkspaceExecutionError(error, "webExtract request failed.")
    }

    if (response.url) {
      const finalUrlValidation = validatePublicWebExtractUrl(response.url)

      if (!finalUrlValidation.ok) {
        return finalUrlValidation
      }
    }

    if (!isWebExtractRedirectStatus(response.status)) {
      return {
        ok: true,
        value: {
          response,
          url: response.url || currentUrl
        }
      }
    }

    const location = response.headers.get("location")

    if (!location) {
      return createWorkspaceExecutionError({
        message: "webExtract redirect response is missing a Location header."
      })
    }

    const redirectUrl = resolveWebExtractRedirectUrl({
      currentUrl,
      location
    })

    if (!redirectUrl.ok) {
      return redirectUrl
    }

    currentUrl = redirectUrl.value
    redirectCount += 1
  }

  return createWorkspaceExecutionError({
    message: "webExtract exceeded the maximum redirect limit."
  })
}

const getWebSearchTitleFromText = (text: string): string => {
  const title = text.split(" - ")[0]?.trim()

  return title || text.slice(0, 120).trim()
}

const getWebSearchTitleFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "")
  } catch {
    return url
  }
}

const createWebSearchResult = ({
  heading,
  text,
  url
}: {
  heading: string
  text: string
  url: string
}): AgentWorkspaceWebSearchResult | null => {
  if (!(text && url)) {
    return null
  }

  return {
    snippet: text,
    title:
      heading ||
      getWebSearchTitleFromText(text) ||
      getWebSearchTitleFromUrl(url),
    url
  }
}

const addUniqueWebSearchResult = (
  results: AgentWorkspaceWebSearchResult[],
  seenUrls: Set<string>,
  result: AgentWorkspaceWebSearchResult | null
): void => {
  if (!result || seenUrls.has(result.url)) {
    return
  }

  seenUrls.add(result.url)
  results.push(result)
}

const collectDuckDuckGoRelatedTopics = (
  value: unknown
): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const topics: Record<string, unknown>[] = []

  for (const item of value) {
    if (!isRecord(item)) {
      continue
    }

    topics.push(item)
    topics.push(...collectDuckDuckGoRelatedTopics(item.Topics))
  }

  return topics
}

const getDuckDuckGoWebSearchResults = (
  payload: unknown,
  maxResults: number
): Pick<AgentWorkspaceWebSearchOutput, "results" | "truncated"> => {
  if (!isRecord(payload)) {
    return {
      results: [],
      truncated: false
    }
  }

  const results: AgentWorkspaceWebSearchResult[] = []
  const seenUrls = new Set<string>()

  addUniqueWebSearchResult(
    results,
    seenUrls,
    createWebSearchResult({
      heading: getRecordString(payload, "Heading"),
      text: getRecordString(payload, "AbstractText"),
      url: getRecordString(payload, "AbstractURL")
    })
  )

  for (const topic of collectDuckDuckGoRelatedTopics(payload.RelatedTopics)) {
    addUniqueWebSearchResult(
      results,
      seenUrls,
      createWebSearchResult({
        heading: "",
        text: getRecordString(topic, "Text"),
        url: getRecordString(topic, "FirstURL")
      })
    )
  }

  return {
    results: results.slice(0, maxResults),
    truncated: results.length > maxResults
  }
}

const decodeHtmlEntities = (text: string): string =>
  text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/&#(\d+);/gu, (_, codePoint: string) =>
      String.fromCodePoint(Number(codePoint))
    )
    .replaceAll(/&#x([\da-f]+);/giu, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16))
    )

const normalizeWebExtractText = (text: string): string =>
  decodeHtmlEntities(text)
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[ \t\f\v]+/gu, " ")
    .replaceAll(/[ \t]*\n[ \t]*/gu, "\n")
    .replaceAll(/\n{2,}/gu, "\n")
    .trim()

const extractHtmlTitle = (html: string): null | string => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
  const title = match ? normalizeWebExtractText(match[1] ?? "") : ""

  return title || null
}

const extractHtmlText = (html: string): string => {
  const bodyHtml = /<body[^>]*>([\s\S]*?)<\/body>/iu.exec(html)?.[1] ?? html

  return normalizeWebExtractText(
    bodyHtml
      .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replaceAll(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
      .replaceAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, " ")
      .replaceAll(/<(?:br|hr)\b[^>]*>/giu, "\n")
      .replaceAll(
        /<\/(?:article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|p|pre|section|tr)>/giu,
        "\n"
      )
      .replaceAll(/<[^>]+>/gu, " ")
  )
}

const isLikelyHtmlContent = (contentType: string, content: string): boolean =>
  /\bhtml\b/iu.test(contentType) ||
  /<html[\s>]|<!doctype html|<body[\s>]/iu.test(content.slice(0, 2048))

const getWorkspaceErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

const getLspInputColumn = (match: string): number => {
  const markerIndex = match.indexOf("<<<")

  return markerIndex === -1 ? 1 : markerIndex + 1
}

const createUnavailableLspInspectResult = ({
  line,
  match,
  path: filePath
}: LspInspectInput): LspInspectResult => ({
  calls: {
    incoming: [],
    outgoing: []
  },
  column: getLspInputColumn(match),
  definition: [],
  diagnostics: [],
  hover: null,
  implementation: [],
  line,
  path: filePath,
  references: [],
  status: "unavailable"
})

const createFailedLspInspectResult = (
  input: LspInspectInput,
  error: unknown
): LspInspectResult => ({
  ...createUnavailableLspInspectResult(input),
  error: getWorkspaceErrorMessage(error, "Failed to inspect source position."),
  status: "failed"
})

const createFailedLspDiagnosticsResult = (
  filePath: string,
  error: unknown
): LspDiagnosticsResult => ({
  diagnostics: [],
  error: getWorkspaceErrorMessage(error, "Failed to collect diagnostics."),
  path: filePath,
  status: "failed"
})

const createUnavailableLspDocumentSymbolsResult = ({
  path: filePath
}: LspDocumentSymbolsInput): LspDocumentSymbolsResult => ({
  path: filePath,
  status: "unavailable",
  symbols: []
})

const createFailedLspDocumentSymbolsResult = (
  input: LspDocumentSymbolsInput,
  error: unknown
): LspDocumentSymbolsResult => ({
  ...createUnavailableLspDocumentSymbolsResult(input),
  error: getWorkspaceErrorMessage(error, "Failed to list source symbols."),
  status: "failed"
})

const createUnavailableLspWorkspaceSymbolsResult = ({
  query
}: LspWorkspaceSymbolsInput): LspWorkspaceSymbolsResult => ({
  query,
  rootPath: ".",
  status: "unavailable",
  symbols: []
})

const createFailedLspWorkspaceSymbolsResult = (
  input: LspWorkspaceSymbolsInput,
  error: unknown
): LspWorkspaceSymbolsResult => ({
  ...createUnavailableLspWorkspaceSymbolsResult(input),
  error: getWorkspaceErrorMessage(error, "Failed to search workspace symbols."),
  status: "failed"
})

export const createAgentWorkspaceOperations = (
  executionEnv: AgentExecutionEnv,
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void,
  lsp?: AgentLspManager | null
): AgentWorkspaceOperations => {
  const { fileSystem } = executionEnv
  const readSnapshots = new Map<string, number>()
  const getWorkspacePathLockKey = async (
    requestedPath: string,
    signal?: AbortSignal
  ): Promise<AgentResult<string, AgentFileError>> => {
    const absolutePath = await fileSystem.absolutePath(requestedPath, signal)

    if (!absolutePath.ok) {
      return absolutePath
    }

    return createWorkspaceFileResult(
      getWorkspaceWriteLockKey({
        absolutePath: absolutePath.value,
        projectPath: executionEnv.projectPath
      })
    )
  }
  const recordReadSnapshot = async ({
    mtimeMs,
    requestedPath,
    signal
  }: {
    mtimeMs: number
    requestedPath: string
    signal?: AbortSignal
  }): Promise<void> => {
    const lockKey = await getWorkspacePathLockKey(requestedPath, signal)

    if (lockKey.ok) {
      readSnapshots.set(lockKey.value, mtimeMs)
    }
  }
  const readTextFile = async (
    requestedPath: string,
    signal?: AbortSignal
  ): Promise<AgentResult<string, AgentFileError>> => {
    const fileInfo = await fileSystem.fileInfo(requestedPath, signal)

    if (!fileInfo.ok) {
      return fileInfo
    }

    const content = await fileSystem.readTextFile(requestedPath, signal)

    if (!content.ok) {
      return content
    }

    await recordReadSnapshot({
      mtimeMs: fileInfo.value.mtimeMs,
      requestedPath,
      signal
    })

    return content
  }
  const executeCommand = async (
    command: string,
    options?: AgentWorkspaceExecuteCommandOptions
  ): Promise<AgentWorkspaceCommandExecution> => {
    const startedAt = Date.now()
    const cwd = options?.cwd ?? ""
    const resolvedCwd = executionEnv.resolveCwd(cwd)
    const eventsEnabled = Boolean(
      options?.emitEvents !== false && eventSink && executionEnv.sandbox.enabled
    )
    const shellWorkspaceEventBridge = createShellWorkspaceEventBridge({
      command,
      emitSandboxEvents: eventsEnabled,
      eventSink,
      resolvedCwd
    })
    const result = await executionEnv.shell.exec(command, {
      abortSignal: options?.abortSignal,
      cwd,
      onEvent: shellWorkspaceEventBridge.onEvent,
      stdin: options?.stdin,
      timeout: options?.timeoutMs
    })
    const shellFinishedEvent = shellWorkspaceEventBridge.getFinishedEvent()

    return {
      durationMs: getCommandDurationMs({
        result,
        shellFinishedEvent,
        startedAt
      }),
      eventsEnabled,
      resolvedCwd,
      result,
      shellFinishedEvent
    }
  }
  const runSearchCommand = async ({
    acceptedExitCodes,
    args,
    commandName,
    failureMessage,
    missingCommandMessage,
    options
  }: {
    acceptedExitCodes: readonly number[]
    args: readonly string[]
    commandName: string
    failureMessage: string
    missingCommandMessage: string
    options: Omit<AgentWorkspaceSearchCommandOptions, "args">
  }): Promise<AgentResult<string, AgentExecutionError>> => {
    const { result } = await executeCommand(
      [commandName, ...args].map(shellQuoteArgument).join(" "),
      {
        abortSignal: options.abortSignal,
        cwd: options.requestedCwd ?? "",
        emitEvents: false,
        timeoutMs: options.timeoutMs ?? WORKSPACE_SEARCH_COMMAND_TIMEOUT_MS
      }
    )

    if (!result.ok) {
      return result
    }

    if (acceptedExitCodes.includes(result.value.exitCode ?? -1)) {
      return {
        ok: true,
        value: result.value.stdout
      }
    }

    if (result.value.exitCode === 127) {
      return createWorkspaceExecutionErrorResult({
        code: "spawn",
        exitCode: result.value.exitCode,
        message: missingCommandMessage,
        stderr: result.value.stderr,
        stdout: result.value.stdout
      })
    }

    return createWorkspaceExecutionErrorResult({
      exitCode: result.value.exitCode,
      message: result.value.stderr.trim() || failureMessage,
      stderr: result.value.stderr,
      stdout: result.value.stdout
    })
  }

  return {
    absolutePath: fileSystem.absolutePath,
    canonicalPath: fileSystem.canonicalPath,
    deleteFile: async (requestedPath, options) => {
      const fileInfo = await fileSystem.fileInfo(requestedPath, options?.signal)

      if (!fileInfo.ok) {
        return fileInfo
      }

      const removeResult = await fileSystem.remove(requestedPath, options)

      if (!removeResult.ok) {
        return removeResult
      }

      return createWorkspaceFileResult(fileInfo.value)
    },
    executeCommand,
    fileStat: fileSystem.fileInfo,
    findFiles: ({ args, ...options }) =>
      runSearchCommand({
        acceptedExitCodes: [0],
        args,
        commandName: "fd",
        failureMessage: "Failed to execute fd.",
        missingCommandMessage: "fd is required for file path search.",
        options
      }),
    gitDiff: (options) => getGitProjectDiff(executionEnv.projectPath, options),
    getProcess: executionEnv.backgroundProcesses.get,
    listDir: fileSystem.listDir,
    listProjectSnapshotFiles: (options) =>
      readProjectSnapshotFiles({
        ...options,
        projectPath: executionEnv.projectPath
      }),
    lspDocumentSymbols: async (input) => {
      if (!lsp) {
        return createUnavailableLspDocumentSymbolsResult(input)
      }

      try {
        return await lsp.documentSymbols(input)
      } catch (error) {
        return createFailedLspDocumentSymbolsResult(input, error)
      }
    },
    lspInspect: async (input) => {
      if (!lsp) {
        return createUnavailableLspInspectResult(input)
      }

      try {
        return await lsp.inspect(input)
      } catch (error) {
        return createFailedLspInspectResult(input, error)
      }
    },
    lspTouchFile: async (filePath) => {
      if (!lsp) {
        return null
      }

      try {
        return await lsp.touchFile(filePath)
      } catch (error) {
        return createFailedLspDiagnosticsResult(filePath, error)
      }
    },
    lspWorkspaceSymbols: async (input) => {
      if (!lsp) {
        return createUnavailableLspWorkspaceSymbolsResult(input)
      }

      try {
        return await lsp.workspaceSymbols(input)
      } catch (error) {
        return createFailedLspWorkspaceSymbolsResult(input, error)
      }
    },
    memorySearch: async ({ db, maxResults, query, settings }) =>
      await retrieveMemoryEntries({
        db,
        embeddingModel: settings.embeddingModel,
        projectPath: executionEnv.projectPath,
        query,
        settings: {
          ...settings,
          maxRetrievedMemories: Math.min(
            maxResults,
            settings.maxRetrievedMemories
          )
        }
      }),
    mkdir: async (requestedPath, options) => {
      const createResult = await fileSystem.createDir(requestedPath, options)

      if (!createResult.ok) {
        return createResult
      }

      return await fileSystem.fileInfo(requestedPath, options?.signal)
    },
    readTextFile,
    recoverProcess: (input) =>
      executionEnv.backgroundProcesses.recover(input, {
        onEvent: createBackgroundProcessWorkspaceEventBridge({
          eventSink
        })
      }),
    searchContent: ({ args, ...options }) =>
      runSearchCommand({
        acceptedExitCodes: [0, 1],
        args,
        commandName: "rg",
        failureMessage: "Failed to execute ripgrep.",
        missingCommandMessage:
          "ripgrep (rg) is required for file content search.",
        options
      }),
    startProcess: (command, options) =>
      executionEnv.backgroundProcesses.start(command, {
        cwd: options?.cwd ?? "",
        onEvent: createBackgroundProcessWorkspaceEventBridge({
          eventSink
        })
      }),
    stopProcess: executionEnv.backgroundProcesses.stop,
    view: async (requestedPath, signal) => {
      const fileInfo = await fileSystem.fileInfo(requestedPath, signal)

      if (!fileInfo.ok) {
        return fileInfo
      }

      const content = await fileSystem.readTextFile(requestedPath, signal)

      if (!content.ok) {
        return content
      }

      await recordReadSnapshot({
        mtimeMs: fileInfo.value.mtimeMs,
        requestedPath,
        signal
      })

      return createWorkspaceFileResult({
        content: content.value,
        info: fileInfo.value
      })
    },
    webExtract: async (url, options) => {
      const responseResult = await fetchPublicWebExtractResponse({
        abortSignal: options.abortSignal,
        url
      })

      if (!responseResult.ok) {
        return responseResult
      }

      const { response, url: finalUrl } = responseResult.value

      if (!response.ok) {
        return createWorkspaceExecutionError({
          message: `webExtract request failed with HTTP ${response.status}.`
        })
      }

      try {
        const contentType = response.headers.get("content-type") ?? ""
        const rawContent = await response.text()
        const isHtml = isLikelyHtmlContent(contentType, rawContent)
        const content = isHtml
          ? extractHtmlText(rawContent)
          : normalizeWebExtractText(rawContent)
        const truncated = content.length > options.maxChars

        return {
          ok: true,
          value: {
            content: content.slice(0, options.maxChars),
            contentType,
            title: isHtml ? extractHtmlTitle(rawContent) : null,
            truncated,
            url: finalUrl
          }
        }
      } catch (error) {
        return toWorkspaceExecutionError(
          error,
          "webExtract response parsing failed."
        )
      }
    },
    webSearch: async (query, options) => {
      let response: Response

      try {
        response = await fetch(buildDuckDuckGoSearchUrl(query), {
          headers: {
            accept: "application/json",
            "user-agent": "Etyon Agent Web Search"
          },
          signal: options.abortSignal
        })
      } catch (error) {
        return toWorkspaceExecutionError(error, "webSearch request failed.")
      }

      if (!response.ok) {
        return createWorkspaceExecutionError({
          message: `webSearch request failed with HTTP ${response.status}.`
        })
      }

      try {
        const payload = (await response.json()) as unknown
        const { results, truncated } = getDuckDuckGoWebSearchResults(
          payload,
          options.maxResults
        )

        return {
          ok: true,
          value: {
            query,
            results,
            truncated
          }
        }
      } catch (error) {
        return toWorkspaceExecutionError(
          error,
          "webSearch response parsing failed."
        )
      }
    },
    writeFile: async (requestedPath, content, options) => {
      const lockPath = await fileSystem.absolutePath(
        requestedPath,
        options?.signal
      )

      if (!lockPath.ok) {
        return lockPath
      }

      const lockKey = getWorkspaceWriteLockKey({
        absolutePath: lockPath.value,
        projectPath: executionEnv.projectPath
      })

      return await withWorkspaceWriteLock(lockKey, async () => {
        if (options?.createParentDirectories) {
          const parentDirectory = await fileSystem.createDir(
            path.dirname(requestedPath),
            {
              recursive: true,
              signal: options.signal
            }
          )

          if (!parentDirectory.ok) {
            return parentDirectory
          }
        }

        if (options?.requireReadSnapshot) {
          const exists = await fileSystem.exists(requestedPath, options.signal)

          if (!exists.ok) {
            return exists
          }

          if (exists.value) {
            const expectedMtimeMs = readSnapshots.get(lockKey)

            if (expectedMtimeMs === undefined) {
              return createWorkspaceFileError({
                code: "stale-write",
                message: `${requestedPath} must be read before overwriting; read it before writing.`,
                requestedPath
              })
            }

            const currentFileInfo = await fileSystem.fileInfo(
              requestedPath,
              options.signal
            )

            if (!currentFileInfo.ok) {
              return currentFileInfo
            }

            if (currentFileInfo.value.mtimeMs !== expectedMtimeMs) {
              return createWorkspaceFileError({
                code: "stale-write",
                message: `${requestedPath} changed since it was read; read it again before writing.`,
                requestedPath
              })
            }
          }
        }

        if (options?.expectedMtimeMs !== undefined) {
          const currentFileInfo = await fileSystem.fileInfo(
            requestedPath,
            options.signal
          )

          if (!currentFileInfo.ok) {
            return currentFileInfo
          }

          if (currentFileInfo.value.mtimeMs !== options.expectedMtimeMs) {
            return createWorkspaceFileError({
              code: "stale-write",
              message: `${requestedPath} changed since it was read; read it again before writing.`,
              requestedPath
            })
          }
        }

        const writeResult = await fileSystem.writeFile(
          requestedPath,
          content,
          options?.signal
        )

        if (!writeResult.ok) {
          return writeResult
        }

        const fileInfo = await fileSystem.fileInfo(
          requestedPath,
          options?.signal
        )

        if (!fileInfo.ok) {
          return fileInfo
        }

        readSnapshots.delete(lockKey)

        return createWorkspaceFileResult({
          bytesWritten: getWorkspaceContentByteLength(content),
          info: fileInfo.value
        })
      })
    }
  }
}

export const cleanupAgentWorkspaceResources = async (): Promise<void> => {
  const cleanupResults = await Promise.allSettled([
    ...Array.from(backgroundProcessCleanups.values(), (cleanup) => cleanup()),
    ...Array.from(lspManagers.values(), (manager) => manager.cleanup())
  ])

  backgroundProcessCleanups.clear()
  backgroundProcessStores.clear()
  lspEventSinks.clear()
  lspManagers.clear()
  workspaceWriteQueues.clear()

  for (const result of cleanupResults) {
    if (result.status === "rejected") {
      throw result.reason
    }
  }
}

export const createAgentWorkspace = ({
  chatSessionId,
  eventSink,
  projectPath,
  settings
}: CreateAgentWorkspaceOptions): AgentWorkspace => {
  const backgroundProcessStoreKey = getBackgroundProcessStoreKey({
    chatSessionId,
    projectPath
  })
  const executionEnv = createAgentExecutionEnv({
    backgroundProcessStore: getAgentWorkspaceBackgroundProcessStore({
      chatSessionId,
      projectPath
    }),
    projectPath,
    sandboxSettings: settings.sandbox
  })

  backgroundProcessCleanups.set(
    backgroundProcessStoreKey,
    executionEnv.backgroundProcesses.cleanup
  )

  const lsp = getAgentWorkspaceLspManager({
    chatSessionId,
    eventSink,
    executionEnv,
    settings
  })

  return {
    ...(eventSink ? { eventSink } : {}),
    executionEnv,
    fileSystem: executionEnv.fileSystem,
    lsp,
    operations: createAgentWorkspaceOperations(executionEnv, eventSink, lsp),
    projectPath: executionEnv.projectPath,
    sandbox: executionEnv.sandbox
  }
}
