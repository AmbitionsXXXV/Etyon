import nodePath from "node:path"

import type {
  AgentSettings,
  ListProjectSnapshotFilesOutput,
  MemoryEntry,
  MemorySettings
} from "@etyon/rpc"
import type { ModelMessage, ToolExecutionOptions, ToolSet } from "ai"
import { tool } from "ai"
import * as z from "zod"

import {
  getAgentRun,
  listAgentEvents,
  listAgentToolCalls
} from "@/main/agents/agent-event-store"
import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  clampToolOutput,
  createAgentExecutionEnv,
  writeAgentCommandOutputArtifact
} from "@/main/agents/execution-env"
import type {
  AgentCommandOutput,
  AgentExecutionError,
  AgentFileError
} from "@/main/agents/execution-env"
import {
  evaluateAgentToolPermission,
  isSecretAgentPath
} from "@/main/agents/permission-engine"
import { resolveActiveAgentProfile } from "@/main/agents/profiles"
import { compileAgentToolNames } from "@/main/agents/tool-policy"
import type { AgentToolName } from "@/main/agents/types"
import type { AppDatabase } from "@/main/db"
import { getGitProjectDiff } from "@/main/git-project-status"
import { retrieveMemoryEntries } from "@/main/memory/retrieval"
import { listProjectSnapshotFiles } from "@/main/project-snapshot"

export { AGENT_TOOL_OUTPUT_MAX_CHARS }

const DEFAULT_FILE_SEARCH_LIMIT = 20
const DEFAULT_FIND_FILES_LIMIT = 50
const DEFAULT_LIST_DIRECTORY_LIMIT = 100
const DEFAULT_MEMORY_SEARCH_LIMIT = 5
const DEFAULT_TOOL_COMMAND_TIMEOUT_MS = 120_000
const DEFAULT_TREE_LIMIT = 80
const DEFAULT_WEB_SEARCH_LIMIT = 5
const DUCKDUCKGO_SEARCH_URL = "https://api.duckduckgo.com/"
const FIND_FILES_SNAPSHOT_LIMIT = 5000
const MEMORY_SEARCH_ENTRY_MAX_CHARS = 1200
const TOOL_READ_FILE_MAX_SIZE = 5 * 1024 * 1024
const SECRET_SEARCH_EXCLUDE_GLOBS = [
  "!.env",
  "!.env.*",
  "!**/.env",
  "!**/.env.*",
  "!**/.ssh/**",
  "!**/secrets/**",
  "!**/*.key",
  "!**/*.p12",
  "!**/*.pem",
  "!**/*.pfx"
] as const
const SHELL_SAFE_ARG_PATTERN = /^[\w./:=@%+,-]+$/u

const AgentEventsSearchInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  runId: z.string().min(1),
  type: z.string().default("")
})

const AgentRunInspectInputSchema = z.object({
  runId: z.string().min(1)
})

const AgentDelegationInputSchema = z.object({
  context: z.string().default(""),
  expectedOutput: z.string().default(""),
  task: z.string().min(1)
})

const PiReadInputSchema = z.object({
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(1).optional(),
  path: z.string().min(1)
})

const PiBashInputSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().int().min(1).max(600).optional()
})

const ApplyPatchInputSchema = z.object({
  patch: z.string().min(1),
  reason: z.string().default("")
})

const EditFileInputSchema = z.object({
  edits: z
    .array(
      z.object({
        newText: z.string(),
        oldText: z.string().min(1)
      })
    )
    .min(1),
  path: z.string().min(1)
})

const preparePiEditInput = (input: unknown): unknown => {
  if (!isRecord(input)) {
    return input
  }

  const nextInput = { ...input }

  if (typeof nextInput.edits === "string") {
    try {
      const parsedEdits = JSON.parse(nextInput.edits) as unknown

      if (Array.isArray(parsedEdits)) {
        nextInput.edits = parsedEdits
      }
    } catch {
      // Let the schema report the invalid edits value.
    }
  }

  if (
    typeof nextInput.oldText !== "string" ||
    typeof nextInput.newText !== "string"
  ) {
    return nextInput
  }

  const edits = Array.isArray(nextInput.edits) ? [...nextInput.edits] : []
  edits.push({
    newText: nextInput.newText,
    oldText: nextInput.oldText
  })
  delete nextInput.newText
  delete nextInput.oldText

  return {
    ...nextInput,
    edits
  }
}

const PiEditInputSchema = z.preprocess(preparePiEditInput, EditFileInputSchema)

const FileInfoInputSchema = z.object({
  path: z.string().min(1)
})

const PiFindInputSchema = z.object({
  limit: z.number().int().min(1).max(5000).default(1000),
  path: z.string().optional(),
  pattern: z.string().min(1)
})

const FindFilesInputSchema = z.object({
  cwd: z.string().default(""),
  limit: z.number().int().min(1).max(200).default(DEFAULT_FIND_FILES_LIMIT),
  query: z.string().min(1)
})

const WriteFileInputSchema = z.object({
  content: z.string(),
  path: z.string().min(1)
})

const PiGrepInputSchema = z.object({
  context: z.number().int().min(0).max(20).optional(),
  glob: z.string().min(1).optional(),
  ignoreCase: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  literal: z.boolean().optional(),
  path: z.string().optional(),
  pattern: z.string().min(1)
})

const PiLsInputSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(500),
  path: z.string().optional()
})

const GitDiffInputSchema = z.object({
  maxChars: z
    .number()
    .int()
    .min(1_000)
    .max(AGENT_TOOL_OUTPUT_MAX_CHARS)
    .optional(),
  paths: z.array(z.string().min(1)).max(50).optional()
})

const ListProjectTreeInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(DEFAULT_TREE_LIMIT)
})

const ListDirectoryInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(DEFAULT_LIST_DIRECTORY_LIMIT),
  path: z.string().default("")
})

const MemorySearchInputSchema = z.object({
  limit: z.number().int().min(1).max(20).default(DEFAULT_MEMORY_SEARCH_LIMIT),
  query: z.string().min(1)
})

const ReadFileInputSchema = z.object({
  endLine: z.number().int().min(1).optional(),
  maxChars: z
    .number()
    .int()
    .min(1_000)
    .max(AGENT_TOOL_OUTPUT_MAX_CHARS)
    .optional(),
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional()
})

const RtkCommandInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().default(""),
  rawOutput: z.boolean().default(false),
  reason: z.string().default(""),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(DEFAULT_TOOL_COMMAND_TIMEOUT_MS)
})

const RunCheckInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().default(""),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(DEFAULT_TOOL_COMMAND_TIMEOUT_MS)
})

const SearchFilesInputSchema = z.object({
  cwd: z.string().default(""),
  glob: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  query: z.string().min(1)
})

const WebSearchInputSchema = z.object({
  maxResults: z.number().int().min(1).max(10).default(DEFAULT_WEB_SEARCH_LIMIT),
  query: z.string().min(1)
})

interface AgentApplyPatchOutput {
  applied: boolean
  exitCode: number | null
  outputRef: AgentCommandOutput["outputRef"]
  stderrPreview: string
  stdoutPreview: string
  truncated: boolean
}

interface AgentFileItem {
  kind: "file" | "folder"
  language?: string | null
  relativePath: string
  size?: number
}

interface AgentFileInfoOutput {
  isSymlink: boolean
  kind: "file" | "folder" | "other" | "symlink"
  language: string | null
  mtimeMs: number
  path: string
  size: number
}

interface AgentDirectoryEntry {
  kind: "file" | "folder" | "other" | "symlink"
  name: string
  relativePath: string
  size?: number
}

interface AgentFindFilesOutput {
  cwd: string
  files: AgentFileItem[]
  query: string
  truncated: boolean
}

interface AgentGitDiffOutput {
  hasPatch: boolean
  patch: string
  projectPath: string
  truncated: boolean
}

interface AgentListDirectoryOutput {
  entries: AgentDirectoryEntry[]
  path: string
  truncated: boolean
}

interface AgentListFilesOutput {
  files: AgentFileItem[]
  snapshotId: string
  truncated: boolean
}

interface AgentMemorySearchEntry {
  content: string
  contentTruncated: boolean
  id: string
  kind: MemoryEntry["kind"]
  projectPath: null | string
  scope: MemoryEntry["scope"]
  source: MemoryEntry["source"]
  updatedAt: string
}

interface AgentMemorySearchOutput {
  entries: AgentMemorySearchEntry[]
  query: string
  truncated: boolean
}

interface AgentSearchFilesMatch {
  column: number
  lineNumber: number
  path: string
  preview: string
}

interface AgentSearchFilesOutput {
  cwd: string
  matches: AgentSearchFilesMatch[]
  query: string
  truncated: boolean
}

interface AgentWebSearchResult {
  snippet: string
  title: string
  url: string
}

interface AgentWebSearchOutput {
  query: string
  results: AgentWebSearchResult[]
  truncated: boolean
}

interface AgentPiTextContent {
  text: string
  type: "text"
}

interface AgentPiTextOutput {
  content: AgentPiTextContent[]
  details?: Record<string, unknown>
}

type AgentToolApprovalMode = "default" | "preapproved"

interface AgentEventsSearchOutput {
  events: Awaited<ReturnType<typeof listAgentEvents>>
  runId: string
  truncated: boolean
}

interface AgentEditFileOutput {
  applied: boolean
  diff: string
  path: string
  replacements: number
  truncated: boolean
}

interface AgentWriteFileOutput {
  bytesWritten: number
  path: string
  written: boolean
}

interface ExecuteCommandToolOptions {
  abortSignal?: AbortSignal
  command: string
  cwd: string
  projectPath: string
  stdin?: string
  timeoutMs: number
}

interface AgentRunInspectOutput {
  events: Awaited<ReturnType<typeof listAgentEvents>>
  runId: string
  toolCalls: Awaited<ReturnType<typeof listAgentToolCalls>>
}

export interface AgentDelegationOutput {
  profileId: string
  runId: string | null
  status: "failed" | "rejected" | "succeeded"
  subRunId: string | null
  summary: string
  truncated: boolean
}

interface AgentReadFileOutput {
  content: string
  endLine: number
  language: string | null
  lineCount: number
  path: string
  startLine: number
  truncated: boolean
}

type AgentToolExecutionOutput =
  | AgentEventsSearchOutput
  | AgentRunInspectOutput
  | AgentApplyPatchOutput
  | AgentCommandOutput
  | AgentEditFileOutput
  | AgentFileInfoOutput
  | AgentFindFilesOutput
  | AgentGitDiffOutput
  | AgentListDirectoryOutput
  | AgentListFilesOutput
  | AgentMemorySearchOutput
  | AgentPiTextOutput
  | AgentReadFileOutput
  | AgentSearchFilesOutput
  | AgentWebSearchOutput
  | AgentWriteFileOutput

interface BuildAgentToolsOptions {
  approvalMode?: AgentToolApprovalMode
  chatSessionId?: string
  db?: AppDatabase
  executeDelegation?: ExecuteAgentDelegation
  includeApprovalTools?: boolean
  memorySettings?: MemorySettings
  projectPath: string
  settings: AgentSettings
  skillCapabilities?: readonly string[]
}

export interface ExecuteAgentDelegationOptions {
  abortSignal?: AbortSignal
  includeApprovalTools?: boolean
  input: z.infer<typeof AgentDelegationInputSchema>
  messages: ModelMessage[]
  parentToolCallId: string
  profileId: string
}

export type ExecuteAgentDelegation = (
  options: ExecuteAgentDelegationOptions
) => Promise<AgentDelegationOutput>

type ExecutableAgentToolName =
  | "agentEventsSearch"
  | "agentRunInspect"
  | "applyPatch"
  | "bash"
  | "edit"
  | "editFile"
  | "fileInfo"
  | "find"
  | "findFiles"
  | "gitDiff"
  | "grep"
  | "listDirectory"
  | "listProjectTree"
  | "ls"
  | "memorySearch"
  | "read"
  | "readFile"
  | "rtkCommand"
  | "runCheck"
  | "searchFiles"
  | "webSearch"
  | "write"
  | "writeFile"

type DelegationAgentToolName =
  | "agentCoder"
  | "agentExplore"
  | "agentPlan"
  | "agentReview"

interface ExecuteAgentToolOptions {
  abortSignal?: AbortSignal
  approvalContext?: AgentToolApprovalContext
  chatSessionId?: string
  db?: AppDatabase
  input: unknown
  memorySettings?: MemorySettings
  name: ExecutableAgentToolName
  projectPath: string
}

interface AgentToolApprovalContext {
  messages: ModelMessage[]
  preapproved?: boolean
  toolCallId: string
}

const EXECUTABLE_AGENT_TOOL_NAMES = [
  "agentEventsSearch",
  "agentRunInspect",
  "applyPatch",
  "bash",
  "edit",
  "editFile",
  "fileInfo",
  "find",
  "findFiles",
  "gitDiff",
  "grep",
  "listDirectory",
  "listProjectTree",
  "ls",
  "memorySearch",
  "read",
  "readFile",
  "rtkCommand",
  "runCheck",
  "searchFiles",
  "webSearch",
  "write",
  "writeFile"
] as const satisfies readonly ExecutableAgentToolName[]

const executableToolNameSet = new Set<string>(EXECUTABLE_AGENT_TOOL_NAMES)

const DELEGATION_PROFILE_ID_BY_TOOL = {
  agentCoder: "coder",
  agentExplore: "explore",
  agentPlan: "plan",
  agentReview: "review"
} as const satisfies Record<DelegationAgentToolName, string>

const normalizeRtkCommand = (command: string): string =>
  command.trim().startsWith("rtk ") ? command.trim() : `rtk ${command.trim()}`

const requireAgentDatabase = (db?: AppDatabase): AppDatabase => {
  if (!db) {
    throw new Error("Agent event tools require a database handle.")
  }

  return db
}

const requireMemorySettings = (
  memorySettings?: MemorySettings
): MemorySettings => {
  if (!memorySettings) {
    throw new Error("memorySearch requires memory settings.")
  }

  return memorySettings
}

const canExposeMemorySearchTool = ({
  db,
  memorySettings
}: {
  db?: AppDatabase
  memorySettings?: MemorySettings
}): boolean =>
  Boolean(db && memorySettings?.enabled && memorySettings.autoRetrieve)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const createPiTextOutput = (
  text: string,
  details?: Record<string, unknown>
): AgentPiTextOutput => ({
  content: [
    {
      text,
      type: "text"
    }
  ],
  ...(details ? { details } : {})
})

const getRecordString = (
  record: Record<string, unknown>,
  key: string
): string => {
  const value = record[key]

  return typeof value === "string" ? value.trim() : ""
}

const getModelMessageContentParts = (message: ModelMessage): unknown[] =>
  Array.isArray(message.content) ? message.content : []

const hasApprovedToolExecution = ({
  messages,
  toolCallId
}: AgentToolApprovalContext): boolean => {
  const approvalIds = new Set<string>()

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    for (const part of getModelMessageContentParts(message)) {
      if (
        isRecord(part) &&
        part.type === "tool-approval-request" &&
        part.toolCallId === toolCallId &&
        typeof part.approvalId === "string"
      ) {
        approvalIds.add(part.approvalId)
      }
    }
  }

  if (approvalIds.size === 0) {
    return false
  }

  for (const message of messages) {
    if (message.role !== "tool") {
      continue
    }

    for (const part of getModelMessageContentParts(message)) {
      if (
        isRecord(part) &&
        part.type === "tool-approval-response" &&
        part.approved === true &&
        typeof part.approvalId === "string" &&
        approvalIds.has(part.approvalId)
      ) {
        return true
      }
    }
  }

  return false
}

const buildDuckDuckGoSearchUrl = (query: string): string => {
  const searchUrl = new URL(DUCKDUCKGO_SEARCH_URL)

  searchUrl.searchParams.set("q", query)
  searchUrl.searchParams.set("format", "json")
  searchUrl.searchParams.set("no_redirect", "1")
  searchUrl.searchParams.set("no_html", "1")

  return searchUrl.toString()
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
}): AgentWebSearchResult | null => {
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
  results: AgentWebSearchResult[],
  seenUrls: Set<string>,
  result: AgentWebSearchResult | null
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
): Pick<AgentWebSearchOutput, "results" | "truncated"> => {
  if (!isRecord(payload)) {
    return {
      results: [],
      truncated: false
    }
  }

  const results: AgentWebSearchResult[] = []
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

const getScopedAgentRun = async ({
  chatSessionId,
  db,
  projectPath,
  runId
}: {
  chatSessionId?: string
  db: AppDatabase
  projectPath: string
  runId: string
}) => {
  const run = await getAgentRun({
    chatSessionId,
    db,
    projectPath,
    runId
  })

  if (!run) {
    throw new Error("Agent run is outside the active chat session or project.")
  }

  return run
}

const resolveProjectFilePath = (projectPath: string, requestedPath: string) => {
  const normalizedProjectPath = nodePath.resolve(projectPath)
  const resolvedPath = nodePath.resolve(normalizedProjectPath, requestedPath)
  const relativePath = nodePath.relative(normalizedProjectPath, resolvedPath)

  if (relativePath.startsWith("..") || nodePath.isAbsolute(relativePath)) {
    throw new Error("The requested file path is outside the active workspace.")
  }

  return {
    absolutePath: resolvedPath,
    relativePath
  }
}

const assertNonSecretToolPath = (requestedPath: string): void => {
  if (isSecretAgentPath(requestedPath)) {
    throw new Error(
      "The requested path looks like a secret or credential file."
    )
  }
}

const normalizeToolPath = (filePath: string): string =>
  filePath.split(nodePath.sep).join("/")

const normalizeToolCwd = (projectPath: string, cwd: string): string => {
  const relativePath = nodePath.relative(nodePath.resolve(projectPath), cwd)

  return normalizeToolPath(relativePath) || "."
}

const getToolFileErrorMessage = (error: AgentFileError): string => {
  switch (error.code) {
    case "outside-project": {
      return "The requested file path is outside the active workspace."
    }
    case "not-directory": {
      return "The requested path is not a directory."
    }
    case "not-file": {
      return "The requested path is not a file."
    }
    case "not-found": {
      return "The requested file path does not exist."
    }
    case "aborted": {
      return "File operation aborted."
    }
    case "io-error": {
      return error.message
    }
    default: {
      const exhaustiveErrorCode: never = error.code

      return exhaustiveErrorCode
    }
  }
}

const throwToolFileError = (error: AgentFileError): never => {
  throw new Error(getToolFileErrorMessage(error))
}

const getCommandErrorPreview = (error: AgentExecutionError): string => {
  switch (error.code) {
    case "aborted":
    case "spawn":
    case "timeout":
    case "unknown": {
      return error.message
    }
    default: {
      const exhaustiveErrorCode: never = error.code

      return exhaustiveErrorCode
    }
  }
}

const executeCommandTool = async ({
  abortSignal,
  command,
  cwd,
  projectPath,
  stdin,
  timeoutMs
}: ExecuteCommandToolOptions): Promise<AgentCommandOutput> => {
  const env = createAgentExecutionEnv({
    projectPath
  })
  const startedAt = Date.now()
  const resolvedCwd = env.resolveCwd(cwd)
  const result = await env.shell.exec(command, {
    abortSignal,
    cwd,
    stdin,
    timeout: timeoutMs
  })
  const stdout =
    "value" in result ? result.value.stdout : (result.error.stdout ?? "")
  const stderr =
    "value" in result
      ? result.value.stderr
      : [result.error.stderr, getCommandErrorPreview(result.error)]
          .filter(Boolean)
          .join("\n")
  const exitCode =
    "value" in result ? result.value.exitCode : (result.error.exitCode ?? null)
  const stderrOutput = clampToolOutput(stderr)
  const stdoutOutput = clampToolOutput(stdout)
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
      "value" in result && result.value.exitCode === 0 ? "success" : "failed",
    truncated
  }
}

const TOOL_LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".cjs", "javascript"],
  [".css", "css"],
  [".cts", "typescript"],
  [".html", "html"],
  [".js", "javascript"],
  [".json", "json"],
  [".jsx", "javascriptreact"],
  [".markdown", "markdown"],
  [".md", "markdown"],
  [".mjs", "javascript"],
  [".mts", "typescript"],
  [".py", "python"],
  [".rs", "rust"],
  [".sh", "shell"],
  [".sql", "sql"],
  [".svg", "svg"],
  [".toml", "toml"],
  [".ts", "typescript"],
  [".tsx", "typescriptreact"],
  [".txt", "plaintext"],
  [".vue", "vue"],
  [".xml", "xml"],
  [".yaml", "yaml"],
  [".yml", "yaml"]
])

const getToolLanguageFromPath = (filePath: string): string | null =>
  TOOL_LANGUAGE_BY_EXTENSION.get(nodePath.extname(filePath).toLowerCase()) ??
  null

const isToolTextContent = (filePath: string, content: string): boolean =>
  getToolLanguageFromPath(filePath) !== null || !content.includes("\u0000")

const normalizePatchHeaderPath = (headerPath: string): string | null => {
  const pathToken = headerPath.trim().split(/\s/u)[0] ?? ""

  if (pathToken === "" || pathToken === "/dev/null") {
    return null
  }

  return pathToken.replace(/^(?:a|b)\//u, "")
}

const collectPatchTargetPaths = (patch: string): string[] => {
  const targetPaths = new Set<string>()

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      const diffHeaderParts = line.split(/\s/u)
      const [oldPath, newPath] = diffHeaderParts.slice(2, 4)

      for (const pathToken of [oldPath, newPath]) {
        const normalizedPath = pathToken
          ? normalizePatchHeaderPath(pathToken)
          : null

        if (normalizedPath) {
          targetPaths.add(normalizedPath)
        }
      }

      continue
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const normalizedPath = normalizePatchHeaderPath(line.slice(4))

      if (normalizedPath) {
        targetPaths.add(normalizedPath)
      }
    }
  }

  return [...targetPaths]
}

const assertPatchTargetPaths = (patch: string, projectPath: string): void => {
  for (const targetPath of collectPatchTargetPaths(patch)) {
    assertNonSecretToolPath(targetPath)
    const { relativePath } = resolveProjectFilePath(projectPath, targetPath)

    assertNonSecretToolPath(relativePath)
  }
}

const normalizeToolFileItem = (
  item: ListProjectSnapshotFilesOutput["files"][number]
): AgentFileItem =>
  item.kind === "file"
    ? {
        kind: item.kind,
        language: item.language,
        relativePath: item.relativePath,
        size: item.size
      }
    : {
        kind: item.kind,
        relativePath: item.relativePath
      }

const toListFilesOutput = (
  result: ListProjectSnapshotFilesOutput,
  limit: number
): AgentListFilesOutput => ({
  files: result.files.map(normalizeToolFileItem),
  snapshotId: result.snapshotId,
  truncated: result.files.length >= limit
})

const shellQuoteArgument = (value: string): string =>
  SHELL_SAFE_ARG_PATTERN.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`

const runRipgrepJson = async ({
  abortSignal,
  args,
  projectPath,
  requestedCwd
}: {
  abortSignal?: AbortSignal
  args: string[]
  projectPath: string
  requestedCwd: string
}): Promise<string> => {
  const result = await createAgentExecutionEnv({
    projectPath
  }).shell.exec(["rg", ...args].map(shellQuoteArgument).join(" "), {
    abortSignal,
    cwd: requestedCwd,
    timeout: DEFAULT_TOOL_COMMAND_TIMEOUT_MS
  })

  if ("error" in result) {
    throw new Error(result.error.message)
  }

  if (result.value.exitCode === 0 || result.value.exitCode === 1) {
    return result.value.stdout
  }

  if (result.value.exitCode === 127) {
    throw new Error("ripgrep (rg) is required for searchFiles.")
  }

  throw new Error(result.value.stderr.trim() || "Failed to execute ripgrep.")
}

const parseRipgrepMatch = ({
  cwd,
  line,
  projectPath
}: {
  cwd: string
  line: string
  projectPath: string
}): AgentSearchFilesMatch | null => {
  if (!line.trim()) {
    return null
  }

  const event = JSON.parse(line) as {
    data?: {
      line_number?: unknown
      lines?: {
        text?: unknown
      }
      path?: {
        text?: unknown
      }
      submatches?: {
        start?: unknown
      }[]
    }
    type?: unknown
  }

  if (event.type !== "match") {
    return null
  }

  const pathText = event.data?.path?.text
  const lineNumber = event.data?.line_number
  const lineText = event.data?.lines?.text
  const columnStart = event.data?.submatches?.[0]?.start

  if (
    typeof pathText !== "string" ||
    typeof lineNumber !== "number" ||
    typeof lineText !== "string"
  ) {
    return null
  }

  const absolutePath = nodePath.resolve(cwd, pathText)
  const relativePath = nodePath.relative(projectPath, absolutePath)

  return {
    column: typeof columnStart === "number" ? columnStart + 1 : 1,
    lineNumber,
    path: normalizeToolPath(relativePath),
    preview: lineText.trimEnd()
  }
}

const toSearchFilesOutput = ({
  cwd,
  maxResults,
  projectPath,
  query,
  stdout
}: {
  cwd: string
  maxResults: number
  projectPath: string
  query: string
  stdout: string
}): AgentSearchFilesOutput => {
  const matches: AgentSearchFilesMatch[] = []
  let outputSize = 0
  let truncated = false

  for (const line of stdout.split(/\r?\n/u)) {
    const match = parseRipgrepMatch({
      cwd,
      line,
      projectPath
    })

    if (!match) {
      continue
    }

    if (matches.length >= maxResults) {
      truncated = true
      break
    }

    outputSize += match.path.length + match.preview.length

    if (outputSize > AGENT_TOOL_OUTPUT_MAX_CHARS) {
      truncated = true
      break
    }

    matches.push(match)
  }

  return {
    cwd: normalizeToolPath(nodePath.relative(projectPath, cwd)) || ".",
    matches,
    query,
    truncated
  }
}

const executeAgentEventsSearch = async (
  db: AppDatabase | undefined,
  input: unknown,
  projectPath: string,
  chatSessionId?: string
): Promise<AgentEventsSearchOutput> => {
  const { limit, runId, type } = AgentEventsSearchInputSchema.parse(input)
  const database = requireAgentDatabase(db)
  const run = await getScopedAgentRun({
    chatSessionId,
    db: database,
    projectPath,
    runId
  })
  const events = await listAgentEvents({
    db: database,
    runId: run.id
  })
  const filteredEvents = type
    ? events.filter((event) => event.type.includes(type))
    : events
  const limitedEvents = filteredEvents.slice(0, limit)

  return {
    events: limitedEvents,
    runId: run.id,
    truncated: filteredEvents.length > limitedEvents.length
  }
}

const executeAgentRunInspect = async (
  db: AppDatabase | undefined,
  input: unknown,
  projectPath: string,
  chatSessionId?: string
): Promise<AgentRunInspectOutput> => {
  const { runId } = AgentRunInspectInputSchema.parse(input)
  const database = requireAgentDatabase(db)
  const run = await getScopedAgentRun({
    chatSessionId,
    db: database,
    projectPath,
    runId
  })
  const [events, toolCalls] = await Promise.all([
    listAgentEvents({
      db: database,
      runId: run.id
    }),
    listAgentToolCalls({
      db: database,
      runId: run.id
    })
  ])

  return {
    events,
    runId: run.id,
    toolCalls
  }
}

const executeApplyPatch = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal
): Promise<AgentApplyPatchOutput> => {
  const { patch } = ApplyPatchInputSchema.parse(input)

  assertPatchTargetPaths(patch, projectPath)

  const result = await executeCommandTool({
    abortSignal,
    command: "git apply --whitespace=nowarn",
    cwd: "",
    projectPath,
    stdin: patch,
    timeoutMs: DEFAULT_TOOL_COMMAND_TIMEOUT_MS
  })

  return {
    applied: result.status === "success",
    exitCode: result.exitCode,
    outputRef: result.outputRef,
    stderrPreview: result.stderrPreview,
    stdoutPreview: result.stdoutPreview,
    truncated: result.truncated
  }
}

const countOccurrences = (content: string, needle: string): number => {
  let count = 0
  let index = content.indexOf(needle)

  while (index !== -1) {
    count += 1
    index = content.indexOf(needle, index + needle.length)
  }

  return count
}

const generateEditDiff = (
  edits: z.infer<typeof EditFileInputSchema>["edits"]
): string =>
  edits.flatMap((edit) => [`-${edit.oldText}`, `+${edit.newText}`]).join("\n")

const executeEditFile = async (
  input: unknown,
  projectPath: string
): Promise<AgentEditFileOutput> => {
  const { edits, path: requestedPath } = EditFileInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })

  assertNonSecretToolPath(requestedPath)
  const canonicalPath = await env.fileSystem.canonicalPath(requestedPath)
  const canonicalRelativePath =
    "value" in canonicalPath
      ? canonicalPath.value
      : throwToolFileError(canonicalPath.error)

  assertNonSecretToolPath(canonicalRelativePath)

  const textFile = await env.fileSystem.readTextFile(requestedPath)
  let content =
    "value" in textFile ? textFile.value : throwToolFileError(textFile.error)

  for (const edit of edits) {
    const matches = countOccurrences(content, edit.oldText)

    if (matches !== 1) {
      throw new Error(
        `Expected exactly one match for edit in ${normalizeToolPath(requestedPath)}, found ${matches}.`
      )
    }

    content = content.replace(edit.oldText, edit.newText)
  }

  const writeResult = await env.fileSystem.writeFile(requestedPath, content)

  if ("error" in writeResult) {
    throwToolFileError(writeResult.error)
  }

  const diff = clampToolOutput(generateEditDiff(edits))
  const targetPath = await env.fileSystem.absolutePath(requestedPath)
  const absoluteTargetPath =
    "value" in targetPath
      ? targetPath.value
      : throwToolFileError(targetPath.error)

  return {
    applied: true,
    diff: diff.content,
    path: normalizeToolPath(
      nodePath.relative(nodePath.resolve(projectPath), absoluteTargetPath)
    ),
    replacements: edits.length,
    truncated: diff.truncated
  }
}

const executeWriteFile = async (
  input: unknown,
  projectPath: string
): Promise<AgentWriteFileOutput> => {
  const { content, path: requestedPath } = WriteFileInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })

  assertNonSecretToolPath(requestedPath)

  const parentDirectory = await env.fileSystem.createDir(
    nodePath.dirname(requestedPath),
    { recursive: true }
  )

  if ("error" in parentDirectory) {
    throwToolFileError(parentDirectory.error)
  }

  const writeResult = await env.fileSystem.writeFile(requestedPath, content)

  if ("error" in writeResult) {
    throwToolFileError(writeResult.error)
  }

  const targetPath = await env.fileSystem.absolutePath(requestedPath)
  const absoluteTargetPath =
    "value" in targetPath
      ? targetPath.value
      : throwToolFileError(targetPath.error)

  return {
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    path: normalizeToolPath(
      nodePath.relative(nodePath.resolve(projectPath), absoluteTargetPath)
    ),
    written: true
  }
}

const executeFileInfo = async (
  input: unknown,
  projectPath: string
): Promise<AgentFileInfoOutput> => {
  const { path: requestedPath } = FileInfoInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })

  assertNonSecretToolPath(requestedPath)

  const canonicalParent = await env.fileSystem.canonicalPath(
    nodePath.dirname(requestedPath)
  )

  const canonicalParentPath =
    "value" in canonicalParent
      ? canonicalParent.value
      : throwToolFileError(canonicalParent.error)

  assertNonSecretToolPath(canonicalParentPath)

  const fileInfo = await env.fileSystem.fileInfo(requestedPath)
  const { value } =
    "value" in fileInfo ? fileInfo : throwToolFileError(fileInfo.error)

  return {
    isSymlink: value.isSymlink,
    kind: value.kind,
    language: getToolLanguageFromPath(value.path),
    mtimeMs: value.mtimeMs,
    path: value.path,
    size: value.size
  }
}

const executeFindFiles = (
  input: unknown,
  projectPath: string
): AgentFindFilesOutput => {
  const { cwd, limit, query } = FindFilesInputSchema.parse(input)

  if (cwd) {
    assertNonSecretToolPath(cwd)
  }

  const resolvedCwd = createAgentExecutionEnv({
    projectPath
  }).resolveCwd(cwd)
  const normalizedProjectPath = nodePath.resolve(projectPath)
  const relativeCwd = normalizeToolCwd(normalizedProjectPath, resolvedCwd)
  const cwdPrefix = relativeCwd === "." ? "" : `${relativeCwd}/`
  const result = listProjectSnapshotFiles({
    limit: FIND_FILES_SNAPSHOT_LIMIT,
    projectPath,
    query
  })
  const matchingFiles = result.files.filter(
    (item) =>
      item.kind === "file" &&
      !isSecretAgentPath(item.relativePath) &&
      (relativeCwd === "." || item.relativePath.startsWith(cwdPrefix))
  )
  const files = matchingFiles.slice(0, limit).map(normalizeToolFileItem)

  return {
    cwd: relativeCwd,
    files,
    query,
    truncated:
      matchingFiles.length > files.length ||
      result.files.length >= FIND_FILES_SNAPSHOT_LIMIT
  }
}

const executeListDirectory = async (
  input: unknown,
  projectPath: string
): Promise<AgentListDirectoryOutput> => {
  const { limit, path: requestedPath } = ListDirectoryInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })

  if (requestedPath) {
    assertNonSecretToolPath(requestedPath)
  }

  const directory = await env.fileSystem.listDir(requestedPath)

  const directoryEntries =
    "value" in directory ? directory.value : throwToolFileError(directory.error)

  const entries: AgentDirectoryEntry[] = []
  let truncated = false

  for (const entry of directoryEntries) {
    if (isSecretAgentPath(entry.path)) {
      continue
    }

    if (entries.length >= limit) {
      truncated = true
      break
    }

    entries.push({
      kind: entry.kind,
      name: nodePath.posix.basename(entry.path),
      relativePath: entry.path,
      ...(entry.kind === "file" ? { size: entry.size } : {})
    })
  }

  return {
    entries,
    path: normalizeToolPath(requestedPath) || ".",
    truncated
  }
}

const executeGitDiff = async (
  input: unknown,
  projectPath: string
): Promise<AgentGitDiffOutput> => {
  const { maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS, paths } =
    GitDiffInputSchema.parse(input)
  for (const requestedPath of paths ?? []) {
    assertNonSecretToolPath(requestedPath)
  }

  const result = await getGitProjectDiff(projectPath, {
    excludeSecretPaths: true,
    paths
  })
  const patch = clampToolOutput(result.patch, maxChars)

  return {
    hasPatch: result.hasPatch,
    patch: patch.content,
    projectPath: result.projectPath,
    truncated: result.truncated || patch.truncated
  }
}

const executeListProjectTree = (
  input: unknown,
  projectPath: string
): AgentListFilesOutput => {
  const { limit } = ListProjectTreeInputSchema.parse(input)
  const result = listProjectSnapshotFiles({
    limit,
    projectPath,
    query: ""
  })

  return toListFilesOutput(result, limit)
}

const toMemorySearchEntry = (entry: MemoryEntry): AgentMemorySearchEntry => {
  const content = clampToolOutput(entry.content, MEMORY_SEARCH_ENTRY_MAX_CHARS)

  return {
    content: content.content,
    contentTruncated: content.truncated,
    id: entry.id,
    kind: entry.kind,
    projectPath: entry.projectPath,
    scope: entry.scope,
    source: entry.source,
    updatedAt: entry.updatedAt
  }
}

const executeMemorySearch = async (
  db: AppDatabase | undefined,
  input: unknown,
  memorySettings: MemorySettings | undefined,
  projectPath: string
): Promise<AgentMemorySearchOutput> => {
  const { limit, query } = MemorySearchInputSchema.parse(input)
  const settings = requireMemorySettings(memorySettings)
  const visibleLimit = Math.min(limit, settings.maxRetrievedMemories)
  const retrievalLimit = Math.min(
    visibleLimit + 1,
    settings.maxRetrievedMemories
  )
  const entries = await retrieveMemoryEntries({
    db: requireAgentDatabase(db),
    embeddingModel: settings.embeddingModel,
    projectPath,
    query,
    settings: {
      ...settings,
      maxRetrievedMemories: retrievalLimit
    }
  })
  const visibleEntries = entries.slice(0, visibleLimit)

  return {
    entries: visibleEntries.map(toMemorySearchEntry),
    query,
    truncated: entries.length > visibleEntries.length
  }
}

const executeReadFile = async (
  input: unknown,
  projectPath: string
): Promise<AgentReadFileOutput> => {
  const {
    endLine,
    maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS,
    path,
    startLine
  } = ReadFileInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })
  const decision = evaluateAgentToolPermission({
    input: {
      path
    },
    name: "readFile",
    workspaceRoot: projectPath
  })

  if (decision.action === "deny") {
    throw new Error(decision.reason)
  }

  const canonicalPath = await env.fileSystem.canonicalPath(path)
  const canonicalRelativePath =
    "value" in canonicalPath
      ? canonicalPath.value
      : throwToolFileError(canonicalPath.error)

  assertNonSecretToolPath(canonicalRelativePath)

  const fileInfo = await env.fileSystem.fileInfo(path)
  const fileInfoValue =
    "value" in fileInfo ? fileInfo.value : throwToolFileError(fileInfo.error)

  if (fileInfoValue.size > TOOL_READ_FILE_MAX_SIZE) {
    throw new Error(
      `File too large (${Math.round(fileInfoValue.size / 1024)}KB). Maximum supported size is ${TOOL_READ_FILE_MAX_SIZE / 1024}KB.`
    )
  }

  const textFile = await env.fileSystem.readTextFile(path)
  const contentValue =
    "value" in textFile ? textFile.value : throwToolFileError(textFile.error)

  if (!isToolTextContent(fileInfoValue.path, contentValue)) {
    throw new Error("Binary files are not supported.")
  }

  const lines = contentValue.endsWith("\n")
    ? contentValue.slice(0, -1).split("\n")
    : contentValue.split("\n")
  const lineCount = lines.length
  const effectiveStartLine = startLine ?? 1
  const effectiveEndLine = endLine ?? lineCount

  if (effectiveStartLine > effectiveEndLine) {
    throw new Error("readFile startLine must be less than or equal to endLine.")
  }

  const selectedContent = lines
    .slice(effectiveStartLine - 1, effectiveEndLine)
    .join("\n")
  const content = clampToolOutput(selectedContent, maxChars)

  return {
    content: content.content,
    endLine: Math.min(effectiveEndLine, lineCount),
    language: getToolLanguageFromPath(fileInfoValue.path),
    lineCount,
    path: fileInfoValue.path,
    startLine: effectiveStartLine,
    truncated: content.truncated
  }
}

const executeRtkCommand = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal
): Promise<AgentCommandOutput> => {
  const parsedInput = RtkCommandInputSchema.parse(input)
  const decision = evaluateAgentToolPermission({
    input: parsedInput,
    name: "rtkCommand",
    workspaceRoot: projectPath
  })

  if (decision.action === "deny") {
    throw new Error(decision.reason)
  }

  return await executeCommandTool({
    abortSignal,
    command: normalizeRtkCommand(parsedInput.command),
    cwd: parsedInput.cwd,
    projectPath,
    timeoutMs: parsedInput.timeoutMs
  })
}

const executeRunCheck = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal
): Promise<AgentCommandOutput> => {
  const parsedInput = RunCheckInputSchema.parse(input)
  const decision = evaluateAgentToolPermission({
    input: parsedInput,
    name: "runCheck",
    workspaceRoot: projectPath
  })

  if (decision.action === "deny") {
    throw new Error(decision.reason)
  }

  return await executeCommandTool({
    abortSignal,
    command: normalizeRtkCommand(parsedInput.command),
    cwd: parsedInput.cwd,
    projectPath,
    timeoutMs: parsedInput.timeoutMs
  })
}

const executeSearchFiles = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal
): Promise<AgentSearchFilesOutput> => {
  const { cwd, glob, limit, maxResults, query } =
    SearchFilesInputSchema.parse(input)
  if (cwd) {
    assertNonSecretToolPath(cwd)
  }

  const resolvedCwd = createAgentExecutionEnv({
    projectPath
  }).resolveCwd(cwd)
  const effectiveMaxResults = maxResults ?? limit ?? DEFAULT_FILE_SEARCH_LIMIT
  const stdout = await runRipgrepJson({
    abortSignal,
    args: [
      "--json",
      "--line-number",
      "--column",
      "--color",
      "never",
      "--sort",
      "path",
      ...(glob ? ["--glob", glob] : []),
      ...SECRET_SEARCH_EXCLUDE_GLOBS.flatMap((secretGlob) => [
        "--glob",
        secretGlob
      ]),
      "--",
      query,
      "."
    ],
    projectPath,
    requestedCwd: cwd
  })

  return toSearchFilesOutput({
    cwd: resolvedCwd,
    maxResults: effectiveMaxResults,
    projectPath: nodePath.resolve(projectPath),
    query,
    stdout
  })
}

const executePiRead = async (
  input: unknown,
  projectPath: string
): Promise<AgentPiTextOutput> => {
  const { limit, offset, path } = PiReadInputSchema.parse(input)
  const startLine = offset ?? 1
  const result = await executeReadFile(
    {
      ...(limit ? { endLine: startLine + limit - 1 } : {}),
      path,
      startLine
    },
    projectPath
  )

  if (startLine > result.lineCount) {
    throw new Error(
      `Offset ${startLine} is beyond end of file (${result.lineCount} lines total).`
    )
  }

  let text = result.content

  if (limit && result.endLine < result.lineCount) {
    const remaining = result.lineCount - result.endLine
    text += `\n\n[${remaining} more lines in file. Use offset=${result.endLine + 1} to continue.]`
  } else if (result.truncated) {
    text += `\n\n[Output truncated. Use offset=${result.endLine + 1} to continue.]`
  }

  return createPiTextOutput(text, {
    lineCount: result.lineCount,
    path: result.path,
    truncated: result.truncated
  })
}

const executePiBash = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal
): Promise<AgentPiTextOutput> => {
  const { command, timeout } = PiBashInputSchema.parse(input)
  const result = await executeCommandTool({
    abortSignal,
    command,
    cwd: "",
    projectPath,
    timeoutMs: timeout ? timeout * 1000 : DEFAULT_TOOL_COMMAND_TIMEOUT_MS
  })
  const output = [result.stdoutPreview, result.stderrPreview]
    .filter(Boolean)
    .join("\n")
  const text = output || "(no output)"

  if (result.status !== "success") {
    throw new Error(
      [text, `Command exited with code ${result.exitCode ?? "unknown"}`].join(
        "\n\n"
      )
    )
  }

  return createPiTextOutput(text, {
    durationMs: result.durationMs,
    fullOutputPath: result.outputRef?.path,
    truncated: result.truncated
  })
}

const executePiEdit = async (
  input: unknown,
  projectPath: string
): Promise<AgentPiTextOutput> => {
  const parsedInput = PiEditInputSchema.parse(input)
  const result = await executeEditFile(parsedInput, projectPath)

  return createPiTextOutput(
    `Successfully replaced ${result.replacements} block(s) in ${result.path}.`,
    {
      diff: result.diff,
      path: result.path,
      replacements: result.replacements,
      truncated: result.truncated
    }
  )
}

const executePiWrite = async (
  input: unknown,
  projectPath: string
): Promise<AgentPiTextOutput> => {
  const result = await executeWriteFile(input, projectPath)

  return createPiTextOutput(
    `Successfully wrote ${result.bytesWritten} bytes to ${result.path}`,
    {
      bytesWritten: result.bytesWritten,
      path: result.path
    }
  )
}

const executePiGrep = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal
): Promise<AgentPiTextOutput> => {
  const {
    context,
    glob,
    ignoreCase,
    limit,
    literal,
    path: requestedPath,
    pattern
  } = PiGrepInputSchema.parse(input)
  const searchPath = requestedPath || "."

  if (requestedPath) {
    assertNonSecretToolPath(requestedPath)
  }

  const stdout = await runRipgrepJson({
    abortSignal,
    args: [
      "--line-number",
      "--color",
      "never",
      "--sort",
      "path",
      "--max-count",
      String(limit),
      ...(ignoreCase ? ["--ignore-case"] : []),
      ...(literal ? ["--fixed-strings"] : []),
      ...(context ? ["--context", String(context)] : []),
      ...(glob ? ["--glob", glob] : []),
      ...SECRET_SEARCH_EXCLUDE_GLOBS.flatMap((secretGlob) => [
        "--glob",
        secretGlob
      ]),
      "--",
      pattern,
      searchPath
    ],
    projectPath,
    requestedCwd: ""
  })
  const output = clampToolOutput(stdout.trimEnd() || "No matches found")

  return createPiTextOutput(output.content, {
    truncated: output.truncated
  })
}

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const globToRegExp = (glob: string): RegExp => {
  let source = ""

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    const nextChar = glob[index + 1]

    if (char === "*" && nextChar === "*") {
      source += ".*"
      index += 1
      continue
    }

    if (char === "*") {
      source += "[^/]*"
      continue
    }

    if (char === "?") {
      source += "[^/]"
      continue
    }

    source += escapeRegExp(char ?? "")
  }

  return new RegExp(`^${source}$`, "u")
}

const matchesPiFindPattern = (
  relativePath: string,
  pattern: string
): boolean => {
  const normalizedRelativePath = normalizeToolPath(relativePath)
  const normalizedPattern = normalizeToolPath(pattern)
  const target = normalizedPattern.includes("/")
    ? normalizedRelativePath
    : nodePath.posix.basename(normalizedRelativePath)
  const directPattern = globToRegExp(normalizedPattern)

  if (directPattern.test(target)) {
    return true
  }

  return (
    normalizedPattern.includes("/") &&
    globToRegExp(`**/${normalizedPattern}`).test(normalizedRelativePath)
  )
}

const executePiFind = (
  input: unknown,
  projectPath: string
): AgentPiTextOutput => {
  const { limit, path: requestedPath, pattern } = PiFindInputSchema.parse(input)

  if (requestedPath) {
    assertNonSecretToolPath(requestedPath)
  }

  const env = createAgentExecutionEnv({
    projectPath
  })
  const resolvedSearchPath = env.resolveCwd(requestedPath ?? "")
  const relativeSearchPath = normalizeToolCwd(projectPath, resolvedSearchPath)
  const searchPrefix =
    relativeSearchPath === "." ? "" : `${relativeSearchPath}/`
  const result = listProjectSnapshotFiles({
    limit: FIND_FILES_SNAPSHOT_LIMIT,
    projectPath,
    query: ""
  })
  const matchingPaths = result.files
    .filter((item) => {
      if (item.kind !== "file" || isSecretAgentPath(item.relativePath)) {
        return false
      }

      if (searchPrefix && !item.relativePath.startsWith(searchPrefix)) {
        return false
      }

      const relativeCandidate = searchPrefix
        ? item.relativePath.slice(searchPrefix.length)
        : item.relativePath

      return matchesPiFindPattern(relativeCandidate, pattern)
    })
    .map((item) =>
      searchPrefix
        ? item.relativePath.slice(searchPrefix.length)
        : item.relativePath
    )
    .slice(0, limit)
  const output =
    matchingPaths.length > 0
      ? matchingPaths.join("\n")
      : "No files found matching pattern"
  const truncated =
    matchingPaths.length >= limit ||
    result.files.length >= FIND_FILES_SNAPSHOT_LIMIT

  return createPiTextOutput(output, {
    truncated
  })
}

const executePiLs = async (
  input: unknown,
  projectPath: string
): Promise<AgentPiTextOutput> => {
  const { limit, path } = PiLsInputSchema.parse(input)
  const result = await executeListDirectory(
    {
      limit,
      path: path ?? ""
    },
    projectPath
  )
  const entries = result.entries
    .toSorted((first, second) =>
      first.name.toLowerCase().localeCompare(second.name.toLowerCase())
    )
    .map((entry) => (entry.kind === "folder" ? `${entry.name}/` : entry.name))

  return createPiTextOutput(entries.join("\n") || "(empty directory)", {
    path: result.path,
    truncated: result.truncated
  })
}

const executeWebSearch = async (
  input: unknown,
  abortSignal?: AbortSignal
): Promise<AgentWebSearchOutput> => {
  const { maxResults, query } = WebSearchInputSchema.parse(input)
  const searchUrl = buildDuckDuckGoSearchUrl(query)
  const response = await fetch(searchUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "Etyon Agent Web Search"
    },
    signal: abortSignal
  })

  if (!response.ok) {
    throw new Error(`webSearch request failed with HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as unknown
  const { results, truncated } = getDuckDuckGoWebSearchResults(
    payload,
    maxResults
  )

  return {
    query,
    results,
    truncated
  }
}

const assertAgentToolExecutionAllowed = ({
  approvalContext,
  input,
  name,
  projectPath
}: {
  approvalContext?: AgentToolApprovalContext
  input: unknown
  name: ExecutableAgentToolName
  projectPath: string
}): void => {
  const decision = evaluateAgentToolPermission({
    input,
    name,
    workspaceRoot: projectPath
  })

  if (decision.action === "deny") {
    throw new Error(decision.reason)
  }

  if (
    decision.action === "ask" &&
    !approvalContext?.preapproved &&
    !(
      approvalContext &&
      hasApprovedToolExecution({
        messages: approvalContext.messages,
        toolCallId: approvalContext.toolCallId
      })
    )
  ) {
    throw new Error(`${name} requires approval before execution.`)
  }
}

const isExecutableAgentToolName = (
  toolName: AgentToolName
): toolName is ExecutableAgentToolName => executableToolNameSet.has(toolName)

const isDelegationAgentToolName = (
  toolName: AgentToolName
): toolName is DelegationAgentToolName =>
  toolName in DELEGATION_PROFILE_ID_BY_TOOL

type ExecuteAgentToolHandlerOptions = Omit<ExecuteAgentToolOptions, "name">

type ExecuteAgentToolHandler = (
  options: ExecuteAgentToolHandlerOptions
) => AgentToolExecutionOutput | Promise<AgentToolExecutionOutput>

const EXECUTE_AGENT_TOOL_HANDLERS = {
  agentEventsSearch: async ({
    chatSessionId,
    db,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeAgentEventsSearch(db, input, projectPath, chatSessionId),
  agentRunInspect: async ({
    chatSessionId,
    db,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeAgentRunInspect(db, input, projectPath, chatSessionId),
  applyPatch: async ({
    abortSignal,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeApplyPatch(input, projectPath, abortSignal),
  bash: async ({
    abortSignal,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executePiBash(input, projectPath, abortSignal),
  edit: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executePiEdit(input, projectPath),
  editFile: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeEditFile(input, projectPath),
  fileInfo: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeFileInfo(input, projectPath),
  find: ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    executePiFind(input, projectPath),
  findFiles: ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    executeFindFiles(input, projectPath),
  gitDiff: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeGitDiff(input, projectPath),
  grep: async ({
    abortSignal,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executePiGrep(input, projectPath, abortSignal),
  listDirectory: async ({
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeListDirectory(input, projectPath),
  listProjectTree: ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    executeListProjectTree(input, projectPath),
  ls: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executePiLs(input, projectPath),
  memorySearch: async ({
    db,
    input,
    memorySettings,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeMemorySearch(db, input, memorySettings, projectPath),
  read: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executePiRead(input, projectPath),
  readFile: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeReadFile(input, projectPath),
  rtkCommand: async ({
    abortSignal,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeRtkCommand(input, projectPath, abortSignal),
  runCheck: async ({
    abortSignal,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeRunCheck(input, projectPath, abortSignal),
  searchFiles: async ({
    abortSignal,
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeSearchFiles(input, projectPath, abortSignal),
  webSearch: async ({ abortSignal, input }: ExecuteAgentToolHandlerOptions) =>
    await executeWebSearch(input, abortSignal),
  write: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executePiWrite(input, projectPath),
  writeFile: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeWriteFile(input, projectPath)
} as const satisfies Record<ExecutableAgentToolName, ExecuteAgentToolHandler>

export const executeAgentTool = async ({
  abortSignal,
  approvalContext,
  chatSessionId,
  db,
  input,
  memorySettings,
  name,
  projectPath
}: ExecuteAgentToolOptions): Promise<AgentToolExecutionOutput> => {
  assertAgentToolExecutionAllowed({
    approvalContext,
    input,
    name,
    projectPath
  })

  return await EXECUTE_AGENT_TOOL_HANDLERS[name]({
    abortSignal,
    approvalContext,
    chatSessionId,
    db,
    input,
    memorySettings,
    projectPath
  })
}

const needsApprovalForTool =
  (name: ExecutableAgentToolName, projectPath: string) =>
  (input: unknown): boolean => {
    try {
      return (
        evaluateAgentToolPermission({
          input,
          name,
          workspaceRoot: projectPath
        }).action !== "allow"
      )
    } catch {
      return true
    }
  }

const getToolNeedsApproval = (
  approvalMode: AgentToolApprovalMode,
  name: ExecutableAgentToolName,
  projectPath: string
): ReturnType<typeof needsApprovalForTool> | undefined =>
  approvalMode === "preapproved"
    ? undefined
    : needsApprovalForTool(name, projectPath)

const getToolNeedsApprovalConfig = (
  approvalMode: AgentToolApprovalMode,
  name: ExecutableAgentToolName,
  projectPath: string
): { needsApproval?: ReturnType<typeof needsApprovalForTool> } => {
  const needsApproval = getToolNeedsApproval(approvalMode, name, projectPath)

  return needsApproval ? { needsApproval } : {}
}

interface AgentToolDefinitionConfig {
  description: string
  inputSchema: z.ZodType
}

const AGENT_TOOL_DEFINITION_CONFIGS = {
  agentEventsSearch: {
    description:
      "Search append-only agent runtime events for a known agent run id. This is read-only harness inspection.",
    inputSchema: AgentEventsSearchInputSchema
  },
  agentRunInspect: {
    description:
      "Inspect events and tool calls for a known agent run id. This is read-only harness diagnostics.",
    inputSchema: AgentRunInspectInputSchema
  },
  applyPatch: {
    description:
      "Apply a unified patch inside the active project. This always requires approval before execution.",
    inputSchema: ApplyPatchInputSchema
  },
  bash: {
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide timeout in seconds.",
    inputSchema: PiBashInputSchema
  },
  edit: {
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file.",
    inputSchema: PiEditInputSchema
  },
  editFile: {
    description:
      "Apply exact oldText/newText replacements inside one project file. This always requires approval before execution.",
    inputSchema: EditFileInputSchema
  },
  fileInfo: {
    description:
      "Read structured metadata for one project path without following symlinks.",
    inputSchema: FileInfoInputSchema
  },
  find: {
    description:
      "Search for files by glob pattern. Returns matching file paths relative to the search directory.",
    inputSchema: PiFindInputSchema
  },
  findFiles: {
    description:
      "Find project files by relative path query. Use this when you know part of a filename or directory name.",
    inputSchema: FindFilesInputSchema
  },
  gitDiff: {
    description:
      "Read the current git diff for the active project. Use this for change review and implementation context.",
    inputSchema: GitDiffInputSchema
  },
  grep: {
    description:
      "Search file contents for a pattern. Returns matching lines with file paths and line numbers.",
    inputSchema: PiGrepInputSchema
  },
  listDirectory: {
    description:
      "List the direct children of a project directory. Use this for focused ls-style inspection.",
    inputSchema: ListDirectoryInputSchema
  },
  listProjectTree: {
    description:
      "List project files and folders from the local snapshot. Use this to understand project structure.",
    inputSchema: ListProjectTreeInputSchema
  },
  ls: {
    description:
      "List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories.",
    inputSchema: PiLsInputSchema
  },
  memorySearch: {
    description:
      "Search enabled long-term memory entries for relevant project and user context. This is read-only and respects memory scope settings.",
    inputSchema: MemorySearchInputSchema
  },
  read: {
    description:
      "Read the contents of a file. For text files, output is bounded; use offset and limit for large files.",
    inputSchema: PiReadInputSchema
  },
  readFile: {
    description:
      "Read a UTF-8 text file inside the active project by relative path. Output is bounded.",
    inputSchema: ReadFileInputSchema
  },
  rtkCommand: {
    description:
      "Run a bounded local command through the project RTK wrapper. Risky commands require approval.",
    inputSchema: RtkCommandInputSchema
  },
  runCheck: {
    description:
      "Run a bounded project check command such as a targeted test, lint, or typecheck.",
    inputSchema: RunCheckInputSchema
  },
  searchFiles: {
    description:
      "Search project file contents with ripgrep and return bounded line matches.",
    inputSchema: SearchFilesInputSchema
  },
  webSearch: {
    description:
      "Search the public web for current external information. This requires approval because the query leaves the local workspace.",
    inputSchema: WebSearchInputSchema
  },
  write: {
    description:
      "Write content to a file. Creates the file if it does not exist, overwrites if it does, and automatically creates parent directories.",
    inputSchema: WriteFileInputSchema
  },
  writeFile: {
    description:
      "Create or overwrite a UTF-8 text file inside the active project. This always requires approval before execution.",
    inputSchema: WriteFileInputSchema
  }
} as const satisfies Record<ExecutableAgentToolName, AgentToolDefinitionConfig>

const TOOL_APPROVAL_GATED_TOOL_NAMES = new Set<ExecutableAgentToolName>([
  "applyPatch",
  "bash",
  "edit",
  "editFile",
  "rtkCommand",
  "runCheck",
  "webSearch",
  "write",
  "writeFile"
])

const shouldAttachApprovalGate = (name: ExecutableAgentToolName): boolean =>
  TOOL_APPROVAL_GATED_TOOL_NAMES.has(name)

const createAgentTool = (
  approvalMode: AgentToolApprovalMode,
  chatSessionId: string | undefined,
  db: AppDatabase | undefined,
  memorySettings: MemorySettings | undefined,
  name: ExecutableAgentToolName,
  projectPath: string
): ToolSet[string] => {
  const executeWithToolContext = (
    input: unknown,
    options: ToolExecutionOptions
  ): Promise<AgentToolExecutionOutput> =>
    executeAgentTool({
      abortSignal: options.abortSignal,
      approvalContext: {
        messages: options.messages,
        preapproved: approvalMode === "preapproved",
        toolCallId: options.toolCallId
      },
      chatSessionId,
      db,
      input,
      memorySettings,
      name,
      projectPath
    })

  const definition = AGENT_TOOL_DEFINITION_CONFIGS[name]

  return tool({
    description: definition.description,
    execute: executeWithToolContext,
    inputSchema: definition.inputSchema,
    ...(shouldAttachApprovalGate(name)
      ? getToolNeedsApprovalConfig(approvalMode, name, projectPath)
      : {})
  })
}

const createAgentDelegationTool = (
  executeDelegation: ExecuteAgentDelegation,
  name: DelegationAgentToolName
): ToolSet[string] => {
  const profileId = DELEGATION_PROFILE_ID_BY_TOOL[name]
  const requiresApproval = name === "agentCoder"

  return tool({
    description: `Delegate a bounded task to the ${profileId} agent. The child run receives only the task and supplied context, then returns a concise summary.`,
    execute: async (input, options: ToolExecutionOptions) => {
      if (
        requiresApproval &&
        !hasApprovedToolExecution({
          messages: options.messages,
          toolCallId: options.toolCallId
        })
      ) {
        throw new Error("agentCoder requires approval before execution.")
      }

      return await executeDelegation({
        abortSignal: options.abortSignal,
        includeApprovalTools: requiresApproval,
        input: AgentDelegationInputSchema.parse(input),
        messages: options.messages,
        parentToolCallId: options.toolCallId,
        profileId
      })
    },
    inputSchema: AgentDelegationInputSchema,
    ...(requiresApproval ? { needsApproval: () => true } : {})
  })
}

const canExposeDelegationTool = ({
  executeDelegation,
  name,
  settings
}: {
  executeDelegation?: ExecuteAgentDelegation
  name: DelegationAgentToolName
  settings: AgentSettings
}): boolean => {
  if (!(executeDelegation && settings.allowSubagentDelegation)) {
    return false
  }

  const activeProfile = resolveActiveAgentProfile(settings)
  const targetProfileId = DELEGATION_PROFILE_ID_BY_TOOL[name]

  if (
    !activeProfile.delegationPolicy.canDelegate ||
    !activeProfile.delegationPolicy.allowedDelegateProfileIds.includes(
      targetProfileId
    )
  ) {
    return false
  }

  const targetProfile = resolveActiveAgentProfile(settings, targetProfileId)

  return targetProfile.id === targetProfileId && targetProfile.available
}

export const buildAgentTools = ({
  approvalMode = "default",
  chatSessionId,
  db,
  executeDelegation,
  includeApprovalTools = true,
  memorySettings,
  projectPath,
  settings,
  skillCapabilities
}: BuildAgentToolsOptions): ToolSet => {
  if (!settings.enabled) {
    return {}
  }

  const profile = resolveActiveAgentProfile(settings)
  const allowedToolNames = compileAgentToolNames({
    allowedToolNames: profile.toolPolicy.allowedToolNames,
    restrictToSafeTools: !includeApprovalTools,
    skillCapabilities
  })
  const tools: ToolSet = {}

  for (const toolName of allowedToolNames) {
    if (
      toolName === "memorySearch" &&
      !canExposeMemorySearchTool({ db, memorySettings })
    ) {
      continue
    }

    if (isExecutableAgentToolName(toolName)) {
      tools[toolName] = createAgentTool(
        approvalMode,
        chatSessionId,
        db,
        memorySettings,
        toolName,
        projectPath
      )
      continue
    }

    if (
      isDelegationAgentToolName(toolName) &&
      executeDelegation &&
      canExposeDelegationTool({
        executeDelegation,
        name: toolName,
        settings
      })
    ) {
      tools[toolName] = createAgentDelegationTool(executeDelegation, toolName)
    }
  }

  return tools
}
