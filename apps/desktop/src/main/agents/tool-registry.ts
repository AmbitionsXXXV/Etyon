import nodePath from "node:path"

import type {
  AgentSettings,
  ListProjectSnapshotFilesOutput,
  MemoryEntry,
  MemorySettings
} from "@etyon/rpc"
import type { ModelMessage, ToolExecutionOptions, ToolSet } from "ai"
import { tool } from "ai"
import * as ts from "typescript"
import * as z from "zod"

import {
  getAgentRun,
  listAgentEvents,
  listAgentRuns,
  listAgentToolCalls
} from "@/main/agents/agent-event-store"
import type { AgentEvent } from "@/main/agents/agent-event-store"
import type {
  AgentExtensionRegisteredTool,
  AgentExtensionRunner,
  AgentExtensionToolExecutionContext
} from "@/main/agents/agent-extensions"
import { toAgentExtensionErrorMessage } from "@/main/agents/agent-extensions"
import { createAgentWorkspace } from "@/main/agents/agent-workspace"
import type {
  AgentWorkspace,
  AgentWorkspaceEvent
} from "@/main/agents/agent-workspace"
import { ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES } from "@/main/agents/code-agent-tool-aliases"
import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  formatToolResultSummaryAnnotation,
  clampToolOutput,
  createAgentExecutionEnv,
  writeAgentCommandOutputArtifact
} from "@/main/agents/execution-env"
import type {
  AgentBackgroundProcessEvent,
  AgentBackgroundProcessRecoverInput,
  AgentBackgroundProcessSnapshot,
  AgentCommandOutput,
  AgentExecutionError,
  AgentFileError,
  AgentResult,
  AgentShellEvent,
  AgentShellResult
} from "@/main/agents/execution-env"
import type {
  LspDiagnostic,
  LspDiagnosticsResult
} from "@/main/agents/lsp-manager"
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

const RequestAccessInputSchema = z
  .object({
    actions: z
      .array(z.string().min(1).max(160))
      .max(10)
      .default([])
      .describe("Concrete actions the agent wants permission to take."),
    reason: z
      .string()
      .min(1)
      .max(2000)
      .describe("Why this access is needed for the current task."),
    scope: z
      .string()
      .min(1)
      .max(500)
      .default("current task")
      .describe("The narrow scope this approval should cover.")
  })
  .strict()

const CodeAgentReadInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of lines to read."),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Line number to start reading from, 1-indexed."),
    path: z
      .string()
      .min(1)
      .describe("Path to the file to read, relative or absolute.")
  })
  .strict()

const CodeAgentBashInputSchema = z
  .object({
    background: z
      .boolean()
      .default(false)
      .describe(
        "Start the command as an Etyon-managed background process and return a processId."
      ),
    command: z.string().min(1).describe("Bash command to execute."),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(600)
      .optional()
      .describe("Timeout in seconds.")
  })
  .strict()

const CodeAgentProcessInputSchema = z
  .object({
    processId: z
      .string()
      .min(1)
      .describe("Process id returned by a background bash command.")
  })
  .strict()

const ApplyPatchInputSchema = z.object({
  patch: z.string().min(1),
  reason: z.string().default("")
})

const EditFileInputSchema = z.object({
  edits: z
    .array(
      z
        .object({
          newText: z.string().describe("Replacement text for this edit."),
          oldText: z
            .string()
            .min(1)
            .describe(
              "Exact text for one targeted replacement; it must be unique in the original file."
            )
        })
        .strict()
    )
    .min(1)
    .describe(
      "One or more targeted replacements matched against the original file."
    ),
  path: z
    .string()
    .min(1)
    .describe("Path to the file to edit, relative or absolute.")
})

const prepareCodeAgentEditInput = (input: unknown): unknown => {
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

const CodeAgentEditInputSchema = z.preprocess(
  prepareCodeAgentEditInput,
  EditFileInputSchema.strict()
)

const CodeAgentSmartEditKindSchema = z.enum([
  "any",
  "class",
  "enum",
  "function",
  "interface",
  "type",
  "variable"
])

const CodeAgentSmartEditInputSchema = z
  .object({
    kind: CodeAgentSmartEditKindSchema.default("any").describe(
      "Expected declaration kind. Use any when unsure."
    ),
    path: z
      .string()
      .min(1)
      .describe("Path to the TypeScript or JavaScript file to edit."),
    replacement: z
      .string()
      .min(1)
      .describe("Full replacement source for the matched declaration."),
    symbol: z.string().min(1).describe("Name of the declaration to replace.")
  })
  .strict()

const FileInfoInputSchema = z.object({
  path: z.string().min(1)
})

const CodeAgentMkdirInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe("Directory path to create, relative or absolute."),
    recursive: z
      .boolean()
      .default(true)
      .describe("Create missing parent directories.")
  })
  .strict()

const CodeAgentDeleteInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe("File or directory path to delete, relative or absolute."),
    recursive: z
      .boolean()
      .default(false)
      .describe("Delete directories recursively.")
  })
  .strict()

const CodeAgentFindInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(1000)
      .describe("Maximum number of paths to return."),
    path: z
      .string()
      .optional()
      .describe("Directory to search; defaults to the current workspace."),
    pattern: z.string().min(1).describe("Glob pattern to match files.")
  })
  .strict()

const FindFilesInputSchema = z.object({
  cwd: z.string().default(""),
  limit: z.number().int().min(1).max(200).default(DEFAULT_FIND_FILES_LIMIT),
  query: z.string().min(1)
})

const WriteFileInputSchema = z.object({
  content: z.string().describe("Complete file content to write."),
  path: z
    .string()
    .min(1)
    .describe("Path to the file to write, relative or absolute.")
})

const CodeAgentGrepInputSchema = z
  .object({
    context: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Number of context lines before and after each match."),
    glob: z
      .string()
      .min(1)
      .optional()
      .describe("Filter searched files by glob, e.g. '*.ts'."),
    ignoreCase: z
      .boolean()
      .optional()
      .describe("Run a case-insensitive search."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Maximum number of matches to return."),
    literal: z
      .boolean()
      .optional()
      .describe("Treat pattern as a literal string instead of regex."),
    path: z
      .string()
      .optional()
      .describe("Directory or file to search; defaults to the workspace."),
    pattern: z.string().min(1).describe("Search pattern.")
  })
  .strict()

const CodeAgentInspectInputSchema = z
  .object({
    line: z.number().int().min(1).describe("1-indexed source line to inspect."),
    match: z
      .string()
      .min(1)
      .describe("Source text around the target with <<< marking the cursor."),
    path: z
      .string()
      .min(1)
      .describe("Path to the source file to inspect, relative or absolute.")
  })
  .strict()

const CodeAgentLsInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(500)
      .describe("Maximum number of directory entries to return."),
    path: z
      .string()
      .optional()
      .describe("Directory to list; defaults to the workspace.")
  })
  .strict()

const GitDiffInputSchema = z.object({
  maxChars: z.number().int().min(1).max(AGENT_TOOL_OUTPUT_MAX_CHARS).optional(),
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

const WebExtractInputSchema = z.object({
  maxChars: z
    .number()
    .int()
    .min(1)
    .max(AGENT_TOOL_OUTPUT_MAX_CHARS)
    .default(12_000),
  url: z
    .string()
    .url()
    .refine((url) => {
      const { protocol } = new URL(url)

      return protocol === "http:" || protocol === "https:"
    }, "URL must use http or https.")
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

interface AgentRipgrepMatch {
  lineNumber: number
  path: string
  text: string
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

interface AgentWebExtractOutput {
  content: string
  contentType: string
  title: null | string
  truncated: boolean
  url: string
}

interface CodeAgentTextContent {
  text: string
  type: "text"
}

interface CodeAgentTextOutput {
  content: CodeAgentTextContent[]
  details?: Record<string, unknown>
}

interface AgentRequestAccessOutput {
  actions: string[]
  approved: boolean
  reason: string
  scope: string
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
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  projectPath: string
  sandboxSettings?: AgentSettings["sandbox"]
  stdin?: string
  timeoutMs: number
  workspace?: AgentWorkspace
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
  | AgentRequestAccessOutput
  | CodeAgentTextOutput
  | AgentReadFileOutput
  | AgentSearchFilesOutput
  | AgentWebExtractOutput
  | AgentWebSearchOutput
  | AgentWriteFileOutput

interface BuildAgentToolsOptions {
  approvalMode?: AgentToolApprovalMode
  chatSessionId?: string
  db?: AppDatabase
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  executeDelegation?: ExecuteAgentDelegation
  extensionRunner?: AgentExtensionRunner
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
  | "delete"
  | "edit"
  | "editFile"
  | "fileInfo"
  | "find"
  | "findFiles"
  | "gitDiff"
  | "grep"
  | "inspect"
  | "listDirectory"
  | "listProjectTree"
  | "ls"
  | "memorySearch"
  | "mkdir"
  | "processOutput"
  | "read"
  | "readFile"
  | "requestAccess"
  | "rtkCommand"
  | "runCheck"
  | "searchFiles"
  | "smartEdit"
  | "stat"
  | "stopProcess"
  | "webExtract"
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
  settings?: AgentSettings
  workspace?: AgentWorkspace
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
  "delete",
  "edit",
  "editFile",
  "fileInfo",
  "find",
  "findFiles",
  "gitDiff",
  "grep",
  "inspect",
  "listDirectory",
  "listProjectTree",
  "ls",
  "memorySearch",
  "mkdir",
  "processOutput",
  "read",
  "readFile",
  "requestAccess",
  "rtkCommand",
  "runCheck",
  "searchFiles",
  "smartEdit",
  "stat",
  "stopProcess",
  "webExtract",
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

const canExposeInspectTool = (settings: AgentSettings): boolean =>
  Boolean(settings.lsp?.enabled && settings.sandbox?.enabled)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const createCodeAgentTextOutput = (
  text: string,
  details?: Record<string, unknown>
): CodeAgentTextOutput => ({
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

const executeRequestAccess = (input: unknown): AgentRequestAccessOutput => {
  const request = RequestAccessInputSchema.parse(input)

  return {
    actions: request.actions,
    approved: true,
    reason: request.reason,
    scope: request.scope
  }
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

const extractHtmlText = (html: string): string =>
  normalizeWebExtractText(
    html
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

const isLikelyHtmlContent = (contentType: string, content: string): boolean =>
  /\bhtml\b/iu.test(contentType) ||
  /<html[\s>]|<!doctype html|<body[\s>]/iu.test(content.slice(0, 2048))

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
    case "process-not-found":
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

const emitCommandWorkspaceEvent = (
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
  getFinishedEvent: () => AgentShellEvent | null
  onEvent: (event: AgentShellEvent) => void
} => {
  let finishedEvent: AgentShellEvent | null = null

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
          emitCommandWorkspaceEvent(eventSink, {
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
          emitCommandWorkspaceEvent(eventSink, {
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
        emitCommandWorkspaceEvent(eventSink, {
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
        emitCommandWorkspaceEvent(eventSink, {
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
        emitCommandWorkspaceEvent(eventSink, {
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
  shellFinishedEvent: AgentShellEvent | null
  startedAt: number
}): number => {
  if ("value" in result) {
    return result.value.durationMs
  }

  if (shellFinishedEvent?.type === "finished") {
    return shellFinishedEvent.durationMs
  }

  return Date.now() - startedAt
}

const executeCommandTool = async ({
  abortSignal,
  command,
  cwd,
  eventSink,
  projectPath,
  sandboxSettings,
  stdin,
  timeoutMs,
  workspace
}: ExecuteCommandToolOptions): Promise<AgentCommandOutput> => {
  const env =
    workspace?.executionEnv ??
    createAgentExecutionEnv({
      projectPath,
      sandboxSettings
    })
  const activeEventSink = eventSink ?? workspace?.eventSink
  const startedAt = Date.now()
  const resolvedCwd = env.resolveCwd(cwd)
  const emitSandboxEvents = Boolean(activeEventSink && env.sandbox.enabled)
  const shellWorkspaceEventBridge = createShellWorkspaceEventBridge({
    command,
    emitSandboxEvents,
    eventSink: activeEventSink,
    resolvedCwd
  })

  const result = await env.shell.exec(command, {
    abortSignal,
    cwd,
    onEvent: shellWorkspaceEventBridge.onEvent,
    stdin,
    timeout: timeoutMs
  })
  const shellFinishedEvent = shellWorkspaceEventBridge.getFinishedEvent()
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
  const durationMs = getCommandDurationMs({
    result,
    shellFinishedEvent,
    startedAt
  })
  const outputRef = truncated
    ? await writeAgentCommandOutputArtifact({
        command,
        cwd: resolvedCwd,
        exitCode,
        stderr,
        stdout
      })
    : null
  const status =
    "value" in result && result.value.exitCode === 0 ? "success" : "failed"

  if (emitSandboxEvents) {
    emitCommandWorkspaceEvent(activeEventSink, {
      payload: {
        command,
        cwd: resolvedCwd,
        durationMs,
        exitCode,
        outputRef,
        ...(shellFinishedEvent?.type === "finished"
          ? {
              sandboxed: shellFinishedEvent.sandboxed,
              shellStatus: shellFinishedEvent.status,
              stderrChars: shellFinishedEvent.stderrChars,
              stdoutChars: shellFinishedEvent.stdoutChars
            }
          : {}),
        status,
        truncated
      },
      type: "sandbox_command_finished"
    })
  }

  return {
    durationMs,
    exitCode,
    outputRef,
    stderrPreview: stderrOutput.content,
    stdoutPreview: stdoutOutput.content,
    status,
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
  requestedCwd,
  sandboxSettings,
  workspace
}: {
  abortSignal?: AbortSignal
  args: string[]
  projectPath: string
  requestedCwd: string
  sandboxSettings?: AgentSettings["sandbox"]
  workspace?: AgentWorkspace
}): Promise<string> => {
  const env =
    workspace?.executionEnv ??
    createAgentExecutionEnv({
      projectPath,
      sandboxSettings
    })
  const result = await env.shell.exec(
    ["rg", ...args].map(shellQuoteArgument).join(" "),
    {
      abortSignal,
      cwd: requestedCwd,
      timeout: DEFAULT_TOOL_COMMAND_TIMEOUT_MS
    }
  )

  if ("error" in result) {
    throw new Error(result.error.message)
  }

  if (result.value.exitCode === 0 || result.value.exitCode === 1) {
    return result.value.stdout
  }

  if (result.value.exitCode === 127) {
    throw new Error("ripgrep (rg) is required for file content search.")
  }

  throw new Error(result.value.stderr.trim() || "Failed to execute ripgrep.")
}

const runFdFind = async ({
  abortSignal,
  args,
  projectPath,
  requestedCwd,
  sandboxSettings,
  workspace
}: {
  abortSignal?: AbortSignal
  args: string[]
  projectPath: string
  requestedCwd: string
  sandboxSettings?: AgentSettings["sandbox"]
  workspace?: AgentWorkspace
}): Promise<string> => {
  const env =
    workspace?.executionEnv ??
    createAgentExecutionEnv({
      projectPath,
      sandboxSettings
    })
  const result = await env.shell.exec(
    ["fd", ...args].map(shellQuoteArgument).join(" "),
    {
      abortSignal,
      cwd: requestedCwd,
      timeout: DEFAULT_TOOL_COMMAND_TIMEOUT_MS
    }
  )

  if ("error" in result) {
    throw new Error(result.error.message)
  }

  if (result.value.exitCode === 0) {
    return result.value.stdout
  }

  if (result.value.exitCode === 127) {
    throw new Error("fd is required for file path search.")
  }

  throw new Error(result.value.stderr.trim() || "Failed to execute fd.")
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

const parseRipgrepJsonMatch = (line: string): AgentRipgrepMatch | null => {
  if (!line.trim()) {
    return null
  }

  let event: {
    data?: {
      line_number?: unknown
      lines?: {
        text?: unknown
      }
      path?: {
        text?: unknown
      }
    }
    type?: unknown
  }

  try {
    event = JSON.parse(line) as typeof event
  } catch {
    return null
  }

  if (event.type !== "match") {
    return null
  }

  const pathText = event.data?.path?.text
  const lineNumber = event.data?.line_number
  const lineText = event.data?.lines?.text

  if (
    typeof pathText !== "string" ||
    typeof lineNumber !== "number" ||
    typeof lineText !== "string"
  ) {
    return null
  }

  return {
    lineNumber,
    path: normalizeToolPath(pathText),
    text: lineText.replaceAll("\r\n", "\n").replaceAll("\r", "").trimEnd()
  }
}

const listRipgrepMatches = ({
  limit,
  stdout
}: {
  limit: number
  stdout: string
}): {
  matchLimitReached: boolean
  matches: AgentRipgrepMatch[]
} => {
  const matches: AgentRipgrepMatch[] = []
  let matchCount = 0

  for (const line of stdout.split(/\r?\n/u)) {
    const match = parseRipgrepJsonMatch(line)

    if (!match) {
      continue
    }

    matchCount += 1

    if (matches.length < limit) {
      matches.push(match)
    }
  }

  return {
    matchLimitReached: matchCount > matches.length,
    matches
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
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
): Promise<AgentApplyPatchOutput> => {
  const { patch } = ApplyPatchInputSchema.parse(input)

  assertPatchTargetPaths(patch, projectPath)

  const result = await executeCommandTool({
    abortSignal,
    command: "git apply --whitespace=nowarn",
    cwd: "",
    projectPath,
    sandboxSettings,
    stdin: patch,
    timeoutMs: DEFAULT_TOOL_COMMAND_TIMEOUT_MS,
    workspace
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

const executeCodeAgentStat = async (
  input: unknown,
  projectPath: string
): Promise<CodeAgentTextOutput> => {
  const result = await executeFileInfo(input, projectPath)
  const modifiedAt = new Date(result.mtimeMs).toISOString()

  return createCodeAgentTextOutput(
    [
      `${result.path}: ${result.kind}`,
      `size: ${result.size} bytes`,
      `language: ${result.language ?? "unknown"}`,
      `symlink: ${result.isSymlink ? "yes" : "no"}`,
      `modified: ${modifiedAt}`
    ].join("\n"),
    {
      isSymlink: result.isSymlink,
      kind: result.kind,
      language: result.language,
      mtimeMs: result.mtimeMs,
      path: result.path,
      size: result.size
    }
  )
}

const executeCodeAgentMkdir = async (
  input: unknown,
  projectPath: string
): Promise<CodeAgentTextOutput> => {
  const { path: requestedPath, recursive } =
    CodeAgentMkdirInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })

  assertNonSecretToolPath(requestedPath)

  const createResult = await env.fileSystem.createDir(requestedPath, {
    recursive
  })

  if ("error" in createResult) {
    throwToolFileError(createResult.error)
  }

  const directoryInfo = await env.fileSystem.fileInfo(requestedPath)
  const directoryInfoValue =
    "value" in directoryInfo
      ? directoryInfo.value
      : throwToolFileError(directoryInfo.error)

  return createCodeAgentTextOutput(
    `Created directory ${directoryInfoValue.path}.`,
    {
      path: directoryInfoValue.path,
      recursive
    }
  )
}

const executeCodeAgentDelete = async (
  input: unknown,
  projectPath: string
): Promise<CodeAgentTextOutput> => {
  const { path: requestedPath, recursive } =
    CodeAgentDeleteInputSchema.parse(input)
  const env = createAgentExecutionEnv({
    projectPath
  })

  assertNonSecretToolPath(requestedPath)

  const fileInfo = await env.fileSystem.fileInfo(requestedPath)
  const fileInfoValue =
    "value" in fileInfo ? fileInfo.value : throwToolFileError(fileInfo.error)
  const removeResult = await env.fileSystem.remove(requestedPath, {
    recursive
  })

  if ("error" in removeResult) {
    throwToolFileError(removeResult.error)
  }

  return createCodeAgentTextOutput(
    `Deleted ${fileInfoValue.kind} ${fileInfoValue.path}.`,
    {
      kind: fileInfoValue.kind,
      path: fileInfoValue.path,
      recursive,
      size: fileInfoValue.size
    }
  )
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
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
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
    sandboxSettings,
    timeoutMs: parsedInput.timeoutMs,
    workspace
  })
}

const executeRunCheck = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
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
    sandboxSettings,
    timeoutMs: parsedInput.timeoutMs,
    workspace
  })
}

const executeSearchFiles = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
): Promise<AgentSearchFilesOutput> => {
  const { cwd, glob, limit, maxResults, query } =
    SearchFilesInputSchema.parse(input)
  if (cwd) {
    assertNonSecretToolPath(cwd)
  }

  const env =
    workspace?.executionEnv ??
    createAgentExecutionEnv({
      projectPath,
      sandboxSettings
    })
  const resolvedCwd = env.resolveCwd(cwd)
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
    requestedCwd: cwd,
    sandboxSettings,
    workspace
  })

  return toSearchFilesOutput({
    cwd: resolvedCwd,
    maxResults: effectiveMaxResults,
    projectPath: nodePath.resolve(projectPath),
    query,
    stdout
  })
}

const executeCodeAgentRead = async (
  input: unknown,
  projectPath: string
): Promise<CodeAgentTextOutput> => {
  const { limit, offset, path } = CodeAgentReadInputSchema.parse(input)
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

  return createCodeAgentTextOutput(text, {
    lineCount: result.lineCount,
    path: result.path,
    truncated: result.truncated
  })
}

const executeCodeAgentBash = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const { background, command, timeout } = CodeAgentBashInputSchema.parse(input)

  if (background) {
    if (!workspace) {
      throw new Error("Background bash requires an active Etyon workspace.")
    }

    const result = await workspace.executionEnv.backgroundProcesses.start(
      command,
      {
        cwd: "",
        onEvent: createBackgroundProcessWorkspaceEventBridge({
          eventSink: workspace.eventSink
        })
      }
    )

    if (!result.ok) {
      throw new Error(getCommandErrorPreview(result.error))
    }

    return createCodeAgentTextOutput(
      `Started background process ${result.value.id}. Use processOutput to read output and stopProcess to stop it.`,
      {
        process: result.value,
        processId: result.value.id
      }
    )
  }

  const result = await executeCommandTool({
    abortSignal,
    command,
    cwd: "",
    projectPath,
    sandboxSettings,
    timeoutMs: timeout ? timeout * 1000 : DEFAULT_TOOL_COMMAND_TIMEOUT_MS,
    workspace
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

  return createCodeAgentTextOutput(text, {
    durationMs: result.durationMs,
    fullOutputPath: result.outputRef?.path,
    truncated: result.truncated
  })
}

const formatBackgroundProcessOutput = (
  snapshot: AgentBackgroundProcessSnapshot
): string => {
  const stdoutPreviewChars = [...snapshot.stdoutPreview].length
  const stderrPreviewChars = [...snapshot.stderrPreview].length
  const stdoutAnnotation = formatToolResultSummaryAnnotation(
    {
      content: snapshot.stdoutPreview,
      omittedChars: Math.max(0, snapshot.stdoutChars - stdoutPreviewChars),
      totalChars: snapshot.stdoutChars,
      truncated: snapshot.stdoutChars > stdoutPreviewChars
    },
    {
      label: "stdout"
    }
  )
  const stderrAnnotation = formatToolResultSummaryAnnotation(
    {
      content: snapshot.stderrPreview,
      omittedChars: Math.max(0, snapshot.stderrChars - stderrPreviewChars),
      totalChars: snapshot.stderrChars,
      truncated: snapshot.stderrChars > stderrPreviewChars
    },
    {
      label: "stderr"
    }
  )
  const lines = [
    `processId: ${snapshot.id}`,
    `status: ${snapshot.status}`,
    `exitCode: ${snapshot.exitCode ?? "none"}`,
    `pid: ${snapshot.pid ?? "none"}`,
    `cwd: ${snapshot.cwd}`,
    `command: ${snapshot.command}`
  ]
  const outputSections = [
    snapshot.stdoutPreview ? `stdout:\n${snapshot.stdoutPreview}` : "",
    stdoutAnnotation,
    snapshot.stderrPreview ? `stderr:\n${snapshot.stderrPreview}` : "",
    stderrAnnotation
  ].filter(Boolean)

  if (snapshot.truncated && !stdoutAnnotation && !stderrAnnotation) {
    outputSections.push("[output truncated]")
  }

  return [...lines, outputSections.join("\n\n") || "(no output yet)"].join("\n")
}

interface BackgroundProcessEventLogRecoveryOptions {
  chatSessionId?: string
  db?: AppDatabase
  processId: string
  workspace: AgentWorkspace
}

const getBackgroundProcessEventProcessId = (
  event: AgentEvent
): string | null => {
  if (!isRecord(event.payload) || typeof event.payload.processId !== "string") {
    return null
  }

  return event.payload.processId
}

const getBackgroundProcessRecoveryInput = (
  events: readonly AgentEvent[],
  processId: string
): AgentBackgroundProcessRecoverInput | null => {
  const processEvents = events.filter(
    (event) => getBackgroundProcessEventProcessId(event) === processId
  )
  const startedEvent = processEvents.find(
    (event) =>
      event.type === "background_process_started" && isRecord(event.payload)
  )

  if (!startedEvent || !isRecord(startedEvent.payload)) {
    return null
  }

  const { command, cwd, pid, sandboxed, startedAt } = startedEvent.payload

  if (
    typeof command !== "string" ||
    typeof cwd !== "string" ||
    typeof startedAt !== "string" ||
    typeof sandboxed !== "boolean" ||
    !(typeof pid === "number" || pid === null)
  ) {
    return null
  }

  const stdout = processEvents
    .filter(
      (event) =>
        event.type === "background_process_output" &&
        isRecord(event.payload) &&
        event.payload.channel === "stdout" &&
        typeof event.payload.chunk === "string"
    )
    .toSorted((first, second) => {
      const firstSequence = isRecord(first.payload)
        ? Number(first.payload.sequence)
        : 0
      const secondSequence = isRecord(second.payload)
        ? Number(second.payload.sequence)
        : 0

      return firstSequence - secondSequence
    })
    .map((event) => (isRecord(event.payload) ? event.payload.chunk : ""))
    .join("")
  const stderr = processEvents
    .filter(
      (event) =>
        event.type === "background_process_output" &&
        isRecord(event.payload) &&
        event.payload.channel === "stderr" &&
        typeof event.payload.chunk === "string"
    )
    .toSorted((first, second) => {
      const firstSequence = isRecord(first.payload)
        ? Number(first.payload.sequence)
        : 0
      const secondSequence = isRecord(second.payload)
        ? Number(second.payload.sequence)
        : 0

      return firstSequence - secondSequence
    })
    .map((event) => (isRecord(event.payload) ? event.payload.chunk : ""))
    .join("")
  const finishedEvent = processEvents.findLast(
    (event) =>
      event.type === "background_process_finished" && isRecord(event.payload)
  )
  const finishedPayload = isRecord(finishedEvent?.payload)
    ? finishedEvent.payload
    : null

  return {
    command,
    cwd,
    exitCode:
      typeof finishedPayload?.exitCode === "number"
        ? finishedPayload.exitCode
        : null,
    finishedAt:
      typeof finishedPayload?.finishedAt === "string"
        ? finishedPayload.finishedAt
        : null,
    id: processId,
    pid,
    sandboxed,
    startedAt,
    status:
      finishedPayload &&
      (finishedPayload.status === "exited" ||
        finishedPayload.status === "running" ||
        finishedPayload.status === "spawn_error" ||
        finishedPayload.status === "stopped")
        ? finishedPayload.status
        : undefined,
    stderr,
    stdout
  }
}

const recoverBackgroundProcessFromEventLog = async ({
  chatSessionId,
  db,
  processId,
  workspace
}: BackgroundProcessEventLogRecoveryOptions): Promise<AgentBackgroundProcessSnapshot | null> => {
  if (!db || !chatSessionId) {
    return null
  }

  const runs = await listAgentRuns({
    chatSessionId,
    db,
    limit: 100
  })

  for (const run of runs) {
    const events = await listAgentEvents({
      db,
      runId: run.id
    })
    const input = getBackgroundProcessRecoveryInput(events, processId)

    if (!input) {
      continue
    }

    return workspace.executionEnv.backgroundProcesses.recover(input, {
      onEvent: createBackgroundProcessWorkspaceEventBridge({
        eventSink: workspace.eventSink
      })
    })
  }

  return null
}

const getBackgroundProcessSnapshot = async ({
  chatSessionId,
  db,
  processId,
  workspace
}: BackgroundProcessEventLogRecoveryOptions): Promise<AgentBackgroundProcessSnapshot | null> =>
  workspace.executionEnv.backgroundProcesses.get(processId) ??
  (await recoverBackgroundProcessFromEventLog({
    chatSessionId,
    db,
    processId,
    workspace
  }))

const executeCodeAgentProcessOutput = async (
  input: unknown,
  chatSessionId?: string,
  db?: AppDatabase,
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  if (!workspace) {
    throw new Error("processOutput requires an active Etyon workspace.")
  }

  const { processId } = CodeAgentProcessInputSchema.parse(input)
  const snapshot = await getBackgroundProcessSnapshot({
    chatSessionId,
    db,
    processId,
    workspace
  })

  if (!snapshot) {
    throw new Error(`Background process ${processId} was not found.`)
  }

  return createCodeAgentTextOutput(formatBackgroundProcessOutput(snapshot), {
    process: snapshot,
    processId: snapshot.id
  })
}

const executeCodeAgentStopProcess = async (
  input: unknown,
  chatSessionId?: string,
  db?: AppDatabase,
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  if (!workspace) {
    throw new Error("stopProcess requires an active Etyon workspace.")
  }

  const { processId } = CodeAgentProcessInputSchema.parse(input)
  await getBackgroundProcessSnapshot({
    chatSessionId,
    db,
    processId,
    workspace
  })
  const result =
    await workspace.executionEnv.backgroundProcesses.stop(processId)

  if (!result.ok) {
    throw new Error(getCommandErrorPreview(result.error))
  }

  return createCodeAgentTextOutput(
    `Stopped background process ${result.value.id}.\n\n${formatBackgroundProcessOutput(result.value)}`,
    {
      process: result.value,
      processId: result.value.id
    }
  )
}

const formatLspDiagnostic = (diagnostic: LspDiagnostic): string =>
  `- ${diagnostic.severity} ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`

const formatPostWriteLspDiagnostics = (
  result: LspDiagnosticsResult | null
): string => {
  if (!result) {
    return ""
  }

  if (result.status !== "success") {
    return `LSP diagnostics ${result.status}: ${result.error ?? "no details"}`
  }

  if (result.diagnostics.length === 0) {
    return "LSP diagnostics: none"
  }

  return `LSP diagnostics:\n${result.diagnostics
    .map(formatLspDiagnostic)
    .join("\n")}`
}

const collectPostWriteLspDiagnostics = async ({
  path: editedPath,
  workspace
}: {
  path: string
  workspace?: AgentWorkspace
}): Promise<LspDiagnosticsResult | null> => {
  if (!workspace?.lsp) {
    return null
  }

  try {
    return await workspace.lsp.touchFile(editedPath)
  } catch (error) {
    return {
      diagnostics: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to collect diagnostics.",
      path: editedPath,
      status: "failed"
    }
  }
}

type CodeAgentSmartEditKind = z.infer<typeof CodeAgentSmartEditKindSchema>

interface CodeAgentSmartEditTarget {
  end: number
  endLine: number
  kind: Exclude<CodeAgentSmartEditKind, "any">
  oldText: string
  start: number
  startLine: number
}

const getSmartEditScriptKind = (filePath: string): ts.ScriptKind | null => {
  switch (nodePath.extname(filePath).toLowerCase()) {
    case ".cjs":
    case ".js":
    case ".mjs": {
      return ts.ScriptKind.JS
    }
    case ".jsx": {
      return ts.ScriptKind.JSX
    }
    case ".cts":
    case ".mts":
    case ".ts": {
      return ts.ScriptKind.TS
    }
    case ".tsx": {
      return ts.ScriptKind.TSX
    }
    default: {
      return null
    }
  }
}

const getNamedDeclarationCandidate = ({
  sourceFile,
  statement,
  symbol
}: {
  sourceFile: ts.SourceFile
  statement: ts.Statement
  symbol: string
}): CodeAgentSmartEditTarget | null => {
  const content = sourceFile.text
  let kind: CodeAgentSmartEditTarget["kind"] | null = null
  let nameNode: ts.Identifier | undefined
  let targetNode: ts.Node = statement

  if (ts.isFunctionDeclaration(statement)) {
    kind = "function"
    nameNode = statement.name
  } else if (ts.isClassDeclaration(statement)) {
    kind = "class"
    nameNode = statement.name
  } else if (ts.isInterfaceDeclaration(statement)) {
    kind = "interface"
    nameNode = statement.name
  } else if (ts.isTypeAliasDeclaration(statement)) {
    kind = "type"
    nameNode = statement.name
  } else if (ts.isEnumDeclaration(statement)) {
    kind = "enum"
    nameNode = statement.name
  } else if (ts.isVariableStatement(statement)) {
    const matchingDeclaration = statement.declarationList.declarations.find(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === symbol
    )

    if (!matchingDeclaration) {
      return null
    }

    if (statement.declarationList.declarations.length !== 1) {
      throw new Error(
        "smartEdit only supports variable statements with a single declaration."
      )
    }

    const matchingDeclarationName = matchingDeclaration.name

    if (!ts.isIdentifier(matchingDeclarationName)) {
      return null
    }

    kind = "variable"
    nameNode = matchingDeclarationName
    targetNode = statement
  }

  if (!kind || nameNode?.text !== symbol) {
    return null
  }

  const start = targetNode.getStart(sourceFile)
  const end = targetNode.getEnd()
  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1
  const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1

  return {
    end,
    endLine,
    kind,
    oldText: content.slice(start, end),
    start,
    startLine
  }
}

const findSmartEditTarget = ({
  content,
  filePath,
  kind,
  symbol
}: {
  content: string
  filePath: string
  kind: CodeAgentSmartEditKind
  symbol: string
}): CodeAgentSmartEditTarget => {
  const scriptKind = getSmartEditScriptKind(filePath)

  if (!scriptKind) {
    throw new Error("smartEdit supports TypeScript and JavaScript files only.")
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  )
  const matches = sourceFile.statements
    .map((statement) =>
      getNamedDeclarationCandidate({
        sourceFile,
        statement,
        symbol
      })
    )
    .filter((match): match is CodeAgentSmartEditTarget => {
      if (!match) {
        return false
      }

      return kind === "any" || match.kind === kind
    })

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${kind === "any" ? "declaration" : kind} named ${symbol}, found ${matches.length}.`
    )
  }

  const [match] = matches

  if (!match) {
    throw new Error(
      `Expected exactly one ${kind === "any" ? "declaration" : kind} named ${symbol}, found 0.`
    )
  }

  return match
}

const executeCodeAgentEdit = async (
  input: unknown,
  projectPath: string,
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const parsedInput = CodeAgentEditInputSchema.parse(input)
  const result = await executeEditFile(parsedInput, projectPath)
  const diagnostics = await collectPostWriteLspDiagnostics({
    path: result.path,
    workspace
  })

  return createCodeAgentTextOutput(
    [
      `Successfully replaced ${result.replacements} block(s) in ${result.path}.`,
      formatPostWriteLspDiagnostics(diagnostics)
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      ...(diagnostics ? { diagnostics } : {}),
      diff: result.diff,
      path: result.path,
      replacements: result.replacements,
      truncated: result.truncated
    }
  )
}

const executeCodeAgentSmartEdit = async (
  input: unknown,
  projectPath: string,
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const {
    kind,
    path: requestedPath,
    replacement,
    symbol
  } = CodeAgentSmartEditInputSchema.parse(input)
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

  const fileInfo = await env.fileSystem.fileInfo(requestedPath)
  const fileInfoValue =
    "value" in fileInfo ? fileInfo.value : throwToolFileError(fileInfo.error)

  if (fileInfoValue.kind !== "file") {
    throw new Error("smartEdit target must be a file.")
  }

  const textFile = await env.fileSystem.readTextFile(requestedPath)
  const content =
    "value" in textFile ? textFile.value : throwToolFileError(textFile.error)

  if (!isToolTextContent(fileInfoValue.path, content)) {
    throw new Error("Binary files are not supported.")
  }

  const target = findSmartEditTarget({
    content,
    filePath: fileInfoValue.path,
    kind,
    symbol
  })
  const nextContent = `${content.slice(0, target.start)}${replacement}${content.slice(target.end)}`
  const writeResult = await env.fileSystem.writeFile(requestedPath, nextContent)

  if ("error" in writeResult) {
    throwToolFileError(writeResult.error)
  }

  const diff = clampToolOutput(
    [`-${target.oldText}`, `+${replacement}`].join("\n")
  )
  const diagnostics = await collectPostWriteLspDiagnostics({
    path: fileInfoValue.path,
    workspace
  })

  return createCodeAgentTextOutput(
    [
      `Successfully smart-edited ${target.kind} ${symbol} in ${fileInfoValue.path}.`,
      formatPostWriteLspDiagnostics(diagnostics)
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      ...(diagnostics ? { diagnostics } : {}),
      diff: diff.content,
      endLine: target.endLine,
      kind: target.kind,
      path: fileInfoValue.path,
      startLine: target.startLine,
      symbol,
      truncated: diff.truncated
    }
  )
}

const executeCodeAgentWrite = async (
  input: unknown,
  projectPath: string,
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const result = await executeWriteFile(input, projectPath)
  const diagnostics = await collectPostWriteLspDiagnostics({
    path: result.path,
    workspace
  })

  return createCodeAgentTextOutput(
    [
      `Successfully wrote ${result.bytesWritten} bytes to ${result.path}`,
      formatPostWriteLspDiagnostics(diagnostics)
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      bytesWritten: result.bytesWritten,
      ...(diagnostics ? { diagnostics } : {}),
      path: result.path
    }
  )
}

const executeCodeAgentInspect = async (
  input: unknown,
  projectPath: string,
  settings?: AgentSettings,
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const parsedInput = CodeAgentInspectInputSchema.parse(input)
  const { line, match, path } = parsedInput

  if (!match.includes("<<<")) {
    throw new Error("inspect match must include the <<< cursor marker.")
  }

  const activeWorkspace =
    workspace ??
    (settings
      ? createAgentWorkspace({
          projectPath,
          settings
        })
      : undefined)

  if (!activeWorkspace?.lsp) {
    return createCodeAgentTextOutput("LSP inspect is not enabled.", {
      column: match.indexOf("<<<") + 1,
      definition: [],
      diagnostics: [],
      hover: null,
      implementation: [],
      line,
      path,
      references: [],
      status: "unavailable"
    })
  }

  const result = await activeWorkspace.lsp.inspect(parsedInput)
  const diagnosticText =
    result.diagnostics.length === 0
      ? "diagnostics: none"
      : `diagnostics:\n${result.diagnostics
          .map(
            (diagnostic) =>
              `- ${diagnostic.severity} ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`
          )
          .join("\n")}`
  const definitionText =
    result.definition.length === 0
      ? "definitions: none"
      : `definitions:\n${result.definition
          .map(
            (location) =>
              `- ${location.path}:${location.line}:${location.column}`
          )
          .join("\n")}`
  const implementationText =
    result.implementation.length === 0
      ? "implementations: none"
      : `implementations:\n${result.implementation
          .map(
            (location) =>
              `- ${location.path}:${location.line}:${location.column}`
          )
          .join("\n")}`
  const referencesText =
    result.references.length === 0
      ? "references: none"
      : `references:\n${result.references
          .map(
            (location) =>
              `- ${location.path}:${location.line}:${location.column}`
          )
          .join("\n")}`
  const hoverText = result.hover ? `hover:\n${result.hover}` : "hover: none"
  const statusText =
    result.status === "success"
      ? `LSP inspect ${result.path}:${result.line}:${result.column}`
      : `LSP inspect ${result.status}: ${result.error ?? "no details"}`

  return createCodeAgentTextOutput(
    [
      statusText,
      hoverText,
      definitionText,
      implementationText,
      referencesText,
      diagnosticText
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      column: result.column,
      definition: result.definition,
      diagnostics: result.diagnostics,
      ...(result.error ? { error: result.error } : {}),
      hover: result.hover,
      implementation: result.implementation,
      line: result.line,
      path: result.path,
      references: result.references,
      status: result.status
    }
  )
}

const formatCodeAgentGrepPath = ({
  isSearchDirectory,
  matchPath,
  projectPath,
  resolvedSearchPath
}: {
  isSearchDirectory: boolean
  matchPath: string
  projectPath: string
  resolvedSearchPath: string
}): string => {
  const absoluteMatchPath = nodePath.resolve(projectPath, matchPath)

  if (isSearchDirectory) {
    const relativeSearchPath = nodePath.relative(
      resolvedSearchPath,
      absoluteMatchPath
    )

    if (
      relativeSearchPath &&
      !relativeSearchPath.startsWith("..") &&
      !nodePath.isAbsolute(relativeSearchPath)
    ) {
      return normalizeToolPath(relativeSearchPath)
    }
  }

  const relativeProjectPath = nodePath.relative(projectPath, absoluteMatchPath)

  return normalizeToolPath(relativeProjectPath || nodePath.basename(matchPath))
}

const readCodeAgentGrepContextLines = async ({
  abortSignal,
  env,
  matchPath
}: {
  abortSignal?: AbortSignal
  env: ReturnType<typeof createAgentExecutionEnv>
  matchPath: string
}): Promise<string[] | null> => {
  const fileResult = await env.fileSystem.readTextFile(matchPath, abortSignal)

  if (!fileResult.ok) {
    return null
  }

  return fileResult.value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "")
    .split("\n")
}

const formatCodeAgentGrepMatch = async ({
  abortSignal,
  context,
  env,
  isSearchDirectory,
  match,
  projectPath,
  resolvedSearchPath
}: {
  abortSignal?: AbortSignal
  context: number
  env: ReturnType<typeof createAgentExecutionEnv>
  isSearchDirectory: boolean
  match: AgentRipgrepMatch
  projectPath: string
  resolvedSearchPath: string
}): Promise<string[]> => {
  const formattedPath = formatCodeAgentGrepPath({
    isSearchDirectory,
    matchPath: match.path,
    projectPath,
    resolvedSearchPath
  })

  if (context <= 0) {
    return [`${formattedPath}:${match.lineNumber}: ${match.text}`]
  }

  const fileLines = await readCodeAgentGrepContextLines({
    abortSignal,
    env,
    matchPath: match.path
  })

  if (!fileLines) {
    return [`${formattedPath}:${match.lineNumber}: (unable to read file)`]
  }

  const startLine = Math.max(1, match.lineNumber - context)
  const endLine = Math.min(fileLines.length, match.lineNumber + context)
  const outputLines: string[] = []

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const lineText = fileLines[lineNumber - 1] ?? ""
    const separator = lineNumber === match.lineNumber ? ":" : "-"

    outputLines.push(
      `${formattedPath}${separator}${lineNumber}${separator} ${lineText}`
    )
  }

  return outputLines
}

const executeCodeAgentGrep = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const {
    context,
    glob,
    ignoreCase,
    limit,
    literal,
    path: requestedPath,
    pattern
  } = CodeAgentGrepInputSchema.parse(input)
  const searchPath = requestedPath || "."

  if (requestedPath) {
    assertNonSecretToolPath(requestedPath)
  }

  const env =
    workspace?.executionEnv ??
    createAgentExecutionEnv({
      projectPath,
      sandboxSettings
    })
  const searchInfo = await env.fileSystem.fileInfo(searchPath, abortSignal)

  if (!searchInfo.ok) {
    throw new Error(getToolFileErrorMessage(searchInfo.error))
  }

  const resolvedSearchPath = env.resolveCwd(searchPath)
  const isSearchDirectory = searchInfo.value.kind === "folder"
  const stdout = await runRipgrepJson({
    abortSignal,
    args: [
      "--json",
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
    requestedCwd: "",
    sandboxSettings,
    workspace
  })
  const { matches, matchLimitReached } = listRipgrepMatches({
    limit,
    stdout
  })
  const lineGroups = await Promise.all(
    matches.map((match) =>
      formatCodeAgentGrepMatch({
        abortSignal,
        context: context ?? 0,
        env,
        isSearchDirectory,
        match,
        projectPath,
        resolvedSearchPath
      })
    )
  )
  const lines = lineGroups.flat()
  let rawOutput = lines.length > 0 ? lines.join("\n") : "No matches found"

  if (matchLimitReached) {
    rawOutput += `\n\n[${limit} matches limit reached. Use limit=${Math.min(
      limit * 2,
      1000
    )} for more, or refine pattern]`
  }

  const output = clampToolOutput(rawOutput)

  return createCodeAgentTextOutput(output.content, {
    matchLimitReached,
    truncated: output.truncated
  })
}

const getCodeAgentFindRelativePath = ({
  rawLine,
  searchPath
}: {
  rawLine: string
  searchPath: string
}): string | null => {
  const line = rawLine.replace(/\r$/u, "").trim()

  if (!line) {
    return null
  }

  const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\")
  const absolutePath = nodePath.isAbsolute(line)
    ? line
    : nodePath.resolve(searchPath, line)
  let relativePath = nodePath.relative(searchPath, absolutePath)

  if (hadTrailingSlash && !relativePath.endsWith("/")) {
    relativePath += "/"
  }

  return normalizeToolPath(relativePath)
}

const executeCodeAgentFind = async (
  input: unknown,
  projectPath: string,
  abortSignal?: AbortSignal,
  sandboxSettings?: AgentSettings["sandbox"],
  workspace?: AgentWorkspace
): Promise<CodeAgentTextOutput> => {
  const {
    limit,
    path: requestedPath,
    pattern
  } = CodeAgentFindInputSchema.parse(input)

  if (requestedPath) {
    assertNonSecretToolPath(requestedPath)
  }

  const env =
    workspace?.executionEnv ??
    createAgentExecutionEnv({
      projectPath,
      sandboxSettings
    })
  const searchPath = requestedPath || "."
  const searchInfo = await env.fileSystem.fileInfo(searchPath, abortSignal)

  if (!searchInfo.ok) {
    throw new Error(getToolFileErrorMessage(searchInfo.error))
  }

  const resolvedSearchPath = env.resolveCwd(searchPath)
  const fdArgs: string[] = [
    "--glob",
    "--color=never",
    "--hidden",
    "--no-require-git",
    "--max-results",
    String(limit)
  ]
  let effectivePattern = pattern

  if (pattern.includes("/")) {
    fdArgs.push("--full-path")

    if (
      !pattern.startsWith("/") &&
      !pattern.startsWith("**/") &&
      pattern !== "**"
    ) {
      effectivePattern = `**/${pattern}`
    }
  }

  const stdout = await runFdFind({
    abortSignal,
    args: [...fdArgs, "--", effectivePattern, resolvedSearchPath],
    projectPath,
    requestedCwd: "",
    sandboxSettings,
    workspace
  })
  const matchingPaths = stdout
    .split(/\r?\n/u)
    .map((line) =>
      getCodeAgentFindRelativePath({
        rawLine: line,
        searchPath: resolvedSearchPath
      })
    )
    .filter((relativePath): relativePath is string =>
      Boolean(relativePath && !isSecretAgentPath(relativePath))
    )
    .slice(0, limit)
  const output =
    matchingPaths.length > 0
      ? matchingPaths.join("\n")
      : "No files found matching pattern"
  const truncated = matchingPaths.length >= limit

  return createCodeAgentTextOutput(output, {
    truncated
  })
}

const executeCodeAgentLs = async (
  input: unknown,
  projectPath: string
): Promise<CodeAgentTextOutput> => {
  const { limit, path } = CodeAgentLsInputSchema.parse(input)
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

  return createCodeAgentTextOutput(entries.join("\n") || "(empty directory)", {
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

const executeWebExtract = async (
  input: unknown,
  abortSignal?: AbortSignal
): Promise<AgentWebExtractOutput> => {
  const { maxChars, url } = WebExtractInputSchema.parse(input)
  const response = await fetch(url, {
    headers: {
      accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "user-agent": "Etyon Agent Web Extract"
    },
    signal: abortSignal
  })

  if (!response.ok) {
    throw new Error(`webExtract request failed with HTTP ${response.status}.`)
  }

  const contentType = response.headers.get("content-type") ?? ""
  const rawContent = await response.text()
  const isHtml = isLikelyHtmlContent(contentType, rawContent)
  const content = isHtml
    ? extractHtmlText(rawContent)
    : normalizeWebExtractText(rawContent)
  const truncated = content.length > maxChars

  return {
    content: content.slice(0, maxChars),
    contentType,
    title: isHtml ? extractHtmlTitle(rawContent) : null,
    truncated,
    url
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
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeApplyPatch(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  bash: async ({
    abortSignal,
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentBash(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  delete: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentDelete(input, projectPath),
  edit: async ({
    input,
    projectPath,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentEdit(input, projectPath, workspace),
  editFile: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeEditFile(input, projectPath),
  fileInfo: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeFileInfo(input, projectPath),
  find: async ({
    abortSignal,
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentFind(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  findFiles: ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    executeFindFiles(input, projectPath),
  gitDiff: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeGitDiff(input, projectPath),
  grep: async ({
    abortSignal,
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentGrep(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  inspect: async ({
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentInspect(input, projectPath, settings, workspace),
  listDirectory: async ({
    input,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeListDirectory(input, projectPath),
  listProjectTree: ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    executeListProjectTree(input, projectPath),
  ls: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentLs(input, projectPath),
  memorySearch: async ({
    db,
    input,
    memorySettings,
    projectPath
  }: ExecuteAgentToolHandlerOptions) =>
    await executeMemorySearch(db, input, memorySettings, projectPath),
  mkdir: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentMkdir(input, projectPath),
  processOutput: async ({
    chatSessionId,
    db,
    input,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentProcessOutput(input, chatSessionId, db, workspace),
  read: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentRead(input, projectPath),
  readFile: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeReadFile(input, projectPath),
  requestAccess: ({ input }: ExecuteAgentToolHandlerOptions) =>
    executeRequestAccess(input),
  rtkCommand: async ({
    abortSignal,
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeRtkCommand(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  runCheck: async ({
    abortSignal,
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeRunCheck(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  searchFiles: async ({
    abortSignal,
    input,
    projectPath,
    settings,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeSearchFiles(
      input,
      projectPath,
      abortSignal,
      settings?.sandbox,
      workspace
    ),
  smartEdit: async ({
    input,
    projectPath,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentSmartEdit(input, projectPath, workspace),
  stat: async ({ input, projectPath }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentStat(input, projectPath),
  stopProcess: async ({
    chatSessionId,
    db,
    input,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentStopProcess(input, chatSessionId, db, workspace),
  webExtract: async ({ abortSignal, input }: ExecuteAgentToolHandlerOptions) =>
    await executeWebExtract(input, abortSignal),
  webSearch: async ({ abortSignal, input }: ExecuteAgentToolHandlerOptions) =>
    await executeWebSearch(input, abortSignal),
  write: async ({
    input,
    projectPath,
    workspace
  }: ExecuteAgentToolHandlerOptions) =>
    await executeCodeAgentWrite(input, projectPath, workspace),
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
  projectPath,
  settings,
  workspace
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
    projectPath,
    settings,
    workspace
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
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.bash.etyonName}. Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide timeout in seconds. Set background=true for a long-running Etyon-managed process, then use processOutput and stopProcess with the returned processId.`,
    inputSchema: CodeAgentBashInputSchema
  },
  delete: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.delete.etyonName}. Delete one project file or directory. Directory deletion requires recursive=true. This always requires approval before execution.`,
    inputSchema: CodeAgentDeleteInputSchema
  },
  processOutput: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.processOutput.etyonName}. Read bounded stdout and stderr from an Etyon-managed background process.`,
    inputSchema: CodeAgentProcessInputSchema
  },
  stopProcess: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.stopProcess.etyonName}. Stop an Etyon-managed background process by processId.`,
    inputSchema: CodeAgentProcessInputSchema
  },
  edit: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.edit.etyonName}. Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file.`,
    inputSchema: CodeAgentEditInputSchema
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
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.find.etyonName}. Search for files by glob pattern. Returns matching file paths relative to the search directory.`,
    inputSchema: CodeAgentFindInputSchema
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
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.grep.etyonName}. Search file contents with ripgrep (rg). Returns matching lines with file paths and line numbers.`,
    inputSchema: CodeAgentGrepInputSchema
  },
  inspect: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.inspect.etyonName}. Inspect a source position with sandboxed LSP hover, definition, implementation, references, and current-line diagnostics.`,
    inputSchema: CodeAgentInspectInputSchema
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
    description: `Model-facing alias over Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.ls.etyonName}. List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories.`,
    inputSchema: CodeAgentLsInputSchema
  },
  memorySearch: {
    description:
      "Search enabled long-term memory entries for relevant project and user context. This is read-only and respects memory scope settings.",
    inputSchema: MemorySearchInputSchema
  },
  mkdir: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.mkdir.etyonName}. Create one project directory, optionally including missing parents. This always requires approval before execution.`,
    inputSchema: CodeAgentMkdirInputSchema
  },
  read: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.read.etyonName}. Read the contents of a file. For text files, output is bounded; use offset and limit for large files.`,
    inputSchema: CodeAgentReadInputSchema
  },
  readFile: {
    description:
      "Read a UTF-8 text file inside the active project by relative path. Output is bounded.",
    inputSchema: ReadFileInputSchema
  },
  requestAccess: {
    description:
      "Ask the user to approve a narrow access checkpoint before continuing. This does not execute any filesystem, shell, network, or delegation action by itself.",
    inputSchema: RequestAccessInputSchema
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
  smartEdit: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.smartEdit.etyonName}. Replace one uniquely named top-level TypeScript or JavaScript declaration using AST-bounded source ranges. This always requires approval before execution.`,
    inputSchema: CodeAgentSmartEditInputSchema
  },
  stat: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.stat.etyonName}. Read structured metadata for one project path without following symlinks.`,
    inputSchema: FileInfoInputSchema
  },
  webExtract: {
    description:
      "Fetch a public web page and extract bounded readable text. This requires approval because the URL leaves the local workspace.",
    inputSchema: WebExtractInputSchema
  },
  webSearch: {
    description:
      "Search the public web for current external information. This requires approval because the query leaves the local workspace.",
    inputSchema: WebSearchInputSchema
  },
  write: {
    description: `Model-facing alias of Etyon workspace ${ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES.write.etyonName}. Write content to a file. Creates the file if it does not exist, overwrites if it does, and automatically creates parent directories.`,
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
  "delete",
  "edit",
  "editFile",
  "mkdir",
  "requestAccess",
  "rtkCommand",
  "runCheck",
  "smartEdit",
  "webExtract",
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
  projectPath: string,
  settings: AgentSettings | undefined,
  workspace: AgentWorkspace | undefined
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
      projectPath,
      settings,
      workspace
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

const createAgentExtensionToolContext = ({
  chatSessionId,
  db,
  memorySettings,
  options,
  projectPath,
  settings,
  workspace
}: {
  chatSessionId: string | undefined
  db: AppDatabase | undefined
  memorySettings: MemorySettings | undefined
  options: ToolExecutionOptions
  projectPath: string
  settings: AgentSettings
  workspace: AgentWorkspace
}): AgentExtensionToolExecutionContext => ({
  abortSignal: options.abortSignal,
  chatSessionId,
  db,
  memorySettings,
  messages: options.messages,
  projectPath,
  settings,
  toolCallId: options.toolCallId,
  workspace
})

const getAgentExtensionToolNeedsApprovalConfig = ({
  chatSessionId,
  db,
  definition,
  memorySettings,
  projectPath,
  settings,
  workspace
}: {
  chatSessionId: string | undefined
  db: AppDatabase | undefined
  definition: AgentExtensionRegisteredTool
  memorySettings: MemorySettings | undefined
  projectPath: string
  settings: AgentSettings
  workspace: AgentWorkspace
}): Pick<ToolSet[string], "needsApproval"> => {
  const requiresApproval =
    definition.requiresApproval ?? definition.riskLevel !== "safe"

  if (!requiresApproval) {
    return {}
  }

  if (requiresApproval === true) {
    return {
      needsApproval: () => true
    }
  }

  return {
    needsApproval: (input: unknown, options: ToolExecutionOptions) =>
      requiresApproval(
        input,
        createAgentExtensionToolContext({
          chatSessionId,
          db,
          memorySettings,
          options,
          projectPath,
          settings,
          workspace
        })
      )
  }
}

const createAgentExtensionTool = ({
  chatSessionId,
  db,
  definition,
  memorySettings,
  projectPath,
  runner,
  settings,
  workspace
}: {
  chatSessionId: string | undefined
  db: AppDatabase | undefined
  definition: AgentExtensionRegisteredTool
  memorySettings: MemorySettings | undefined
  projectPath: string
  runner: AgentExtensionRunner
  settings: AgentSettings
  workspace: AgentWorkspace
}): ToolSet[string] =>
  tool({
    description: definition.description,
    execute: async (input, options: ToolExecutionOptions) => {
      const context = createAgentExtensionToolContext({
        chatSessionId,
        db,
        memorySettings,
        options,
        projectPath,
        settings,
        workspace
      })

      await runner.emit({
        extensionId: definition.extensionId,
        input,
        toolCallId: options.toolCallId,
        toolName: definition.name,
        type: "tool_call_started"
      })

      try {
        const output = await definition.execute(input, context)

        await runner.emit({
          extensionId: definition.extensionId,
          output,
          toolCallId: options.toolCallId,
          toolName: definition.name,
          type: "tool_call_finished"
        })

        return output
      } catch (error) {
        await runner.emit({
          error: toAgentExtensionErrorMessage(error),
          extensionId: definition.extensionId,
          toolCallId: options.toolCallId,
          toolName: definition.name,
          type: "tool_call_failed"
        })

        throw error
      }
    },
    inputSchema: definition.inputSchema,
    ...getAgentExtensionToolNeedsApprovalConfig({
      chatSessionId,
      db,
      definition,
      memorySettings,
      projectPath,
      settings,
      workspace
    })
  })

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

const SKILL_CAPABILITY_SUPPLEMENTAL_TOOL_NAMES = [
  "webExtract",
  "webSearch"
] as const satisfies readonly AgentToolName[]

const getSkillCapabilitySupplementalToolNames = ({
  includeApprovalTools,
  skillCapabilities
}: {
  includeApprovalTools: boolean
  skillCapabilities?: readonly string[]
}): AgentToolName[] => {
  if (skillCapabilities === undefined) {
    return []
  }

  return compileAgentToolNames({
    allowedToolNames: SKILL_CAPABILITY_SUPPLEMENTAL_TOOL_NAMES,
    restrictToSafeTools: !includeApprovalTools,
    skillCapabilities
  })
}

export const buildAgentTools = ({
  approvalMode = "default",
  chatSessionId,
  db,
  eventSink,
  executeDelegation,
  extensionRunner,
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
  const workspace = createAgentWorkspace({
    chatSessionId,
    eventSink,
    projectPath,
    settings
  })
  const allowedToolNames = compileAgentToolNames({
    allowedToolNames: profile.toolPolicy.allowedToolNames,
    restrictToSafeTools: !includeApprovalTools,
    skillCapabilities
  })
  const supplementalToolNames = getSkillCapabilitySupplementalToolNames({
    includeApprovalTools,
    skillCapabilities
  })
  const tools: ToolSet = {}

  for (const toolName of new Set([
    ...allowedToolNames,
    ...supplementalToolNames
  ])) {
    if (
      toolName === "memorySearch" &&
      !canExposeMemorySearchTool({ db, memorySettings })
    ) {
      continue
    }

    if (toolName === "inspect" && !canExposeInspectTool(settings)) {
      continue
    }

    if (isExecutableAgentToolName(toolName)) {
      tools[toolName] = createAgentTool(
        approvalMode,
        chatSessionId,
        db,
        memorySettings,
        toolName,
        projectPath,
        settings,
        workspace
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

  if (extensionRunner) {
    for (const extensionToolDefinition of extensionRunner.listTools({
      includeApprovalTools,
      profileId: profile.id,
      skillCapabilities
    })) {
      tools[extensionToolDefinition.name] = createAgentExtensionTool({
        chatSessionId,
        db,
        definition: extensionToolDefinition,
        memorySettings,
        projectPath,
        runner: extensionRunner,
        settings,
        workspace
      })
    }
  }

  return tools
}
