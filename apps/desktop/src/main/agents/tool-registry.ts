import { spawn } from "node:child_process"
import { once } from "node:events"

import type { AgentSettings, ListProjectSnapshotFilesOutput } from "@etyon/rpc"
import type { ModelMessage, ToolExecutionOptions, ToolSet } from "ai"
import { tool } from "ai"
import * as z from "zod"

import {
  listAgentEvents,
  listAgentToolCalls
} from "@/main/agents/agent-event-store"
import { evaluateAgentToolPermission } from "@/main/agents/permission-engine"
import { resolveActiveAgentProfile } from "@/main/agents/profiles"
import type { AgentToolName } from "@/main/agents/types"
import type { AppDatabase } from "@/main/db"
import { getGitProjectDiff } from "@/main/git-project-status"
import {
  listProjectSnapshotFiles,
  readProjectFile
} from "@/main/project-snapshot"

export const AGENT_TOOL_OUTPUT_MAX_CHARS = 12_000

const DEFAULT_FILE_SEARCH_LIMIT = 20
const DEFAULT_TOOL_COMMAND_TIMEOUT_MS = 120_000
const DEFAULT_TREE_LIMIT = 80

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

const ApplyPatchInputSchema = z.object({
  patch: z.string().min(1),
  reason: z.string().default("")
})

const GitDiffInputSchema = z.object({
  maxChars: z
    .number()
    .int()
    .min(1_000)
    .max(AGENT_TOOL_OUTPUT_MAX_CHARS)
    .optional()
})

const ListProjectTreeInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(DEFAULT_TREE_LIMIT)
})

const ReadFileInputSchema = z.object({
  maxChars: z
    .number()
    .int()
    .min(1_000)
    .max(AGENT_TOOL_OUTPUT_MAX_CHARS)
    .optional(),
  path: z.string().min(1)
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
  limit: z.number().int().min(1).max(100).default(DEFAULT_FILE_SEARCH_LIMIT),
  query: z.string().default("")
})

interface AgentApplyPatchOutput {
  applied: boolean
  exitCode: number | null
  stderrPreview: string
  stdoutPreview: string
  truncated: boolean
}

interface AgentCommandOutput {
  durationMs: number
  exitCode: number | null
  stderrPreview: string
  stdoutPreview: string
  status: "approval_required" | "failed" | "success"
  truncated: boolean
}

interface AgentFileItem {
  kind: "file" | "folder"
  language?: string | null
  relativePath: string
  size?: number
}

interface AgentGitDiffOutput {
  hasPatch: boolean
  patch: string
  projectPath: string
  truncated: boolean
}

interface AgentListFilesOutput {
  files: AgentFileItem[]
  snapshotId: string
  truncated: boolean
}

interface AgentEventsSearchOutput {
  events: Awaited<ReturnType<typeof listAgentEvents>>
  runId: string
  truncated: boolean
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
  summary: string
  truncated: boolean
}

interface AgentReadFileOutput {
  content: string
  language: string | null
  path: string
  truncated: boolean
}

type AgentToolExecutionOutput =
  | AgentEventsSearchOutput
  | AgentRunInspectOutput
  | AgentApplyPatchOutput
  | AgentCommandOutput
  | AgentGitDiffOutput
  | AgentListFilesOutput
  | AgentReadFileOutput

interface BuildAgentToolsOptions {
  db?: AppDatabase
  executeDelegation?: ExecuteAgentDelegation
  includeApprovalTools?: boolean
  projectPath: string
  settings: AgentSettings
}

export interface ExecuteAgentDelegationOptions {
  abortSignal?: AbortSignal
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
  | "gitDiff"
  | "listProjectTree"
  | "readFile"
  | "rtkCommand"
  | "runCheck"
  | "searchFiles"

type DelegationAgentToolName = "agentExplore" | "agentPlan" | "agentReview"

interface ExecuteAgentToolOptions {
  db?: AppDatabase
  input: unknown
  name: ExecutableAgentToolName
  projectPath: string
}

const EXECUTABLE_AGENT_TOOL_NAMES = [
  "agentEventsSearch",
  "agentRunInspect",
  "applyPatch",
  "gitDiff",
  "listProjectTree",
  "readFile",
  "rtkCommand",
  "runCheck",
  "searchFiles"
] as const satisfies readonly ExecutableAgentToolName[]

const executableToolNameSet = new Set<string>(EXECUTABLE_AGENT_TOOL_NAMES)

const APPROVAL_TOOL_NAMES = new Set<AgentToolName>([
  "applyPatch",
  "rtkCommand",
  "runCheck"
])

const DELEGATION_PROFILE_ID_BY_TOOL = {
  agentExplore: "explore",
  agentPlan: "plan",
  agentReview: "review"
} as const satisfies Record<DelegationAgentToolName, string>

const clampToolOutput = (
  content: string,
  maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS
): { content: string; truncated: boolean } => ({
  content: content.slice(0, maxChars),
  truncated: content.length > maxChars
})

const normalizeRtkCommand = (command: string): string =>
  command.trim().startsWith("rtk ") ? command.trim() : `rtk ${command.trim()}`

const requireAgentDatabase = (db?: AppDatabase): AppDatabase => {
  if (!db) {
    throw new Error("Agent event tools require a database handle.")
  }

  return db
}

const resolveToolCwd = (cwd: string, projectPath: string): string =>
  cwd ? `${projectPath}/${cwd}` : projectPath

const runShellCommand = async ({
  command,
  cwd,
  stdin,
  timeoutMs
}: {
  command: string
  cwd: string
  stdin?: string
  timeoutMs: number
}): Promise<AgentCommandOutput> => {
  const startedAt = Date.now()
  let stderr = ""
  let stdout = ""
  let timedOut = false
  const child = spawn("/bin/zsh", ["-lc", command], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"]
  })
  const appendStderr = (chunk: Buffer): void => {
    stderr = `${stderr}${chunk.toString("utf-8")}`.slice(
      -AGENT_TOOL_OUTPUT_MAX_CHARS * 2
    )
  }
  const appendStdout = (chunk: Buffer): void => {
    stdout = `${stdout}${chunk.toString("utf-8")}`.slice(
      -AGENT_TOOL_OUTPUT_MAX_CHARS * 2
    )
  }
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
  }, timeoutMs)

  child.stderr.on("data", appendStderr)
  child.stdout.on("data", appendStdout)

  if (stdin) {
    child.stdin.write(stdin)
  }

  child.stdin.end()

  const [exitCode] = (await once(child, "close")) as [number | null]
  clearTimeout(timeout)

  const stderrOutput = clampToolOutput(
    timedOut ? `${stderr}\nCommand timed out.` : stderr
  )
  const stdoutOutput = clampToolOutput(stdout)

  return {
    durationMs: Date.now() - startedAt,
    exitCode,
    stderrPreview: stderrOutput.content,
    stdoutPreview: stdoutOutput.content,
    status: exitCode === 0 && !timedOut ? "success" : "failed",
    truncated: stderrOutput.truncated || stdoutOutput.truncated
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

const executeAgentEventsSearch = async (
  db: AppDatabase | undefined,
  input: unknown
): Promise<AgentEventsSearchOutput> => {
  const { limit, runId, type } = AgentEventsSearchInputSchema.parse(input)
  const events = await listAgentEvents({
    db: requireAgentDatabase(db),
    runId
  })
  const filteredEvents = type
    ? events.filter((event) => event.type.includes(type))
    : events
  const limitedEvents = filteredEvents.slice(0, limit)

  return {
    events: limitedEvents,
    runId,
    truncated: filteredEvents.length > limitedEvents.length
  }
}

const executeAgentRunInspect = async (
  db: AppDatabase | undefined,
  input: unknown
): Promise<AgentRunInspectOutput> => {
  const { runId } = AgentRunInspectInputSchema.parse(input)
  const database = requireAgentDatabase(db)
  const [events, toolCalls] = await Promise.all([
    listAgentEvents({
      db: database,
      runId
    }),
    listAgentToolCalls({
      db: database,
      runId
    })
  ])

  return {
    events,
    runId,
    toolCalls
  }
}

const executeApplyPatch = async (
  input: unknown,
  projectPath: string
): Promise<AgentApplyPatchOutput> => {
  const { patch } = ApplyPatchInputSchema.parse(input)
  const result = await runShellCommand({
    command: "git apply --whitespace=nowarn",
    cwd: projectPath,
    stdin: patch,
    timeoutMs: DEFAULT_TOOL_COMMAND_TIMEOUT_MS
  })

  return {
    applied: result.status === "success",
    exitCode: result.exitCode,
    stderrPreview: result.stderrPreview,
    stdoutPreview: result.stdoutPreview,
    truncated: result.truncated
  }
}

const executeGitDiff = async (
  input: unknown,
  projectPath: string
): Promise<AgentGitDiffOutput> => {
  const { maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS } =
    GitDiffInputSchema.parse(input)
  const result = await getGitProjectDiff(projectPath)
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

const executeReadFile = (
  input: unknown,
  projectPath: string
): AgentReadFileOutput => {
  const { maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS, path } =
    ReadFileInputSchema.parse(input)
  const result = readProjectFile({
    filePath: path,
    projectPath
  })
  const content = clampToolOutput(result.content, maxChars)

  return {
    content: content.content,
    language: result.language,
    path: result.relativePath,
    truncated: content.truncated
  }
}

const executeRtkCommand = async (
  input: unknown,
  projectPath: string
): Promise<AgentCommandOutput> => {
  const parsedInput = RtkCommandInputSchema.parse(input)
  const decision = evaluateAgentToolPermission({
    input: parsedInput,
    name: "rtkCommand",
    workspaceRoot: projectPath
  })

  if (decision.action !== "allow") {
    return {
      durationMs: 0,
      exitCode: null,
      stderrPreview: decision.reason,
      stdoutPreview: "",
      status: "approval_required",
      truncated: false
    }
  }

  return await runShellCommand({
    command: normalizeRtkCommand(parsedInput.command),
    cwd: resolveToolCwd(parsedInput.cwd, projectPath),
    timeoutMs: parsedInput.timeoutMs
  })
}

const executeRunCheck = async (
  input: unknown,
  projectPath: string
): Promise<AgentCommandOutput> => {
  const parsedInput = RunCheckInputSchema.parse(input)
  const decision = evaluateAgentToolPermission({
    input: parsedInput,
    name: "runCheck",
    workspaceRoot: projectPath
  })

  if (decision.action !== "allow") {
    return {
      durationMs: 0,
      exitCode: null,
      stderrPreview: decision.reason,
      stdoutPreview: "",
      status: "approval_required",
      truncated: false
    }
  }

  return await runShellCommand({
    command: normalizeRtkCommand(parsedInput.command),
    cwd: resolveToolCwd(parsedInput.cwd, projectPath),
    timeoutMs: parsedInput.timeoutMs
  })
}

const executeSearchFiles = (
  input: unknown,
  projectPath: string
): AgentListFilesOutput => {
  const { limit, query } = SearchFilesInputSchema.parse(input)
  const result = listProjectSnapshotFiles({
    limit,
    projectPath,
    query
  })

  return toListFilesOutput(result, limit)
}

const isExecutableAgentToolName = (
  toolName: AgentToolName
): toolName is ExecutableAgentToolName => executableToolNameSet.has(toolName)

const isDelegationAgentToolName = (
  toolName: AgentToolName
): toolName is DelegationAgentToolName =>
  toolName in DELEGATION_PROFILE_ID_BY_TOOL

export const executeAgentTool = async ({
  db,
  input,
  name,
  projectPath
}: ExecuteAgentToolOptions): Promise<AgentToolExecutionOutput> => {
  switch (name) {
    case "agentEventsSearch": {
      return await executeAgentEventsSearch(db, input)
    }
    case "agentRunInspect": {
      return await executeAgentRunInspect(db, input)
    }
    case "applyPatch": {
      return await executeApplyPatch(input, projectPath)
    }
    case "gitDiff": {
      return await executeGitDiff(input, projectPath)
    }
    case "listProjectTree": {
      return await executeListProjectTree(input, projectPath)
    }
    case "readFile": {
      return await executeReadFile(input, projectPath)
    }
    case "rtkCommand": {
      return await executeRtkCommand(input, projectPath)
    }
    case "runCheck": {
      return await executeRunCheck(input, projectPath)
    }
    case "searchFiles": {
      return await executeSearchFiles(input, projectPath)
    }
    default: {
      const exhaustiveToolName: never = name

      throw new Error(`Unsupported agent tool: ${exhaustiveToolName}`)
    }
  }
}

const needsApprovalForTool =
  (name: ExecutableAgentToolName, projectPath: string) =>
  (input: unknown): boolean =>
    evaluateAgentToolPermission({
      input,
      name,
      workspaceRoot: projectPath
    }).action !== "allow"

const createAgentTool = (
  db: AppDatabase | undefined,
  name: ExecutableAgentToolName,
  projectPath: string
): ToolSet[string] => {
  switch (name) {
    case "agentEventsSearch": {
      return tool({
        description:
          "Search append-only agent runtime events for a known agent run id. This is read-only harness inspection.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: AgentEventsSearchInputSchema
      })
    }
    case "agentRunInspect": {
      return tool({
        description:
          "Inspect events and tool calls for a known agent run id. This is read-only harness diagnostics.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: AgentRunInspectInputSchema
      })
    }
    case "applyPatch": {
      return tool({
        description:
          "Apply a unified patch inside the active project. This always requires approval before execution.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: ApplyPatchInputSchema,
        needsApproval: true
      })
    }
    case "gitDiff": {
      return tool({
        description:
          "Read the current git diff for the active project. Use this for change review and implementation context.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: GitDiffInputSchema
      })
    }
    case "listProjectTree": {
      return tool({
        description:
          "List project files and folders from the local snapshot. Use this to understand project structure.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: ListProjectTreeInputSchema
      })
    }
    case "readFile": {
      return tool({
        description:
          "Read a UTF-8 text file inside the active project by relative path. Output is bounded.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: ReadFileInputSchema
      })
    }
    case "rtkCommand": {
      return tool({
        description:
          "Run a bounded local command through the project RTK wrapper. Risky commands require approval.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: RtkCommandInputSchema,
        needsApproval: needsApprovalForTool(name, projectPath)
      })
    }
    case "runCheck": {
      return tool({
        description:
          "Run a bounded project check command such as a targeted test, lint, or typecheck.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: RunCheckInputSchema,
        needsApproval: needsApprovalForTool(name, projectPath)
      })
    }
    case "searchFiles": {
      return tool({
        description:
          "Search project snapshot paths by query and return matching relative file or folder paths.",
        execute: (input) => executeAgentTool({ db, input, name, projectPath }),
        inputSchema: SearchFilesInputSchema
      })
    }
    default: {
      const exhaustiveToolName: never = name

      throw new Error(`Unsupported agent tool: ${exhaustiveToolName}`)
    }
  }
}

const createAgentDelegationTool = (
  executeDelegation: ExecuteAgentDelegation,
  name: DelegationAgentToolName
): ToolSet[string] => {
  const profileId = DELEGATION_PROFILE_ID_BY_TOOL[name]

  return tool({
    description: `Delegate a bounded task to the ${profileId} agent. The child run receives only the task and supplied context, then returns a concise summary.`,
    execute: (input, options: ToolExecutionOptions) =>
      executeDelegation({
        abortSignal: options.abortSignal,
        input: AgentDelegationInputSchema.parse(input),
        messages: options.messages,
        parentToolCallId: options.toolCallId,
        profileId
      }),
    inputSchema: AgentDelegationInputSchema
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
  db,
  executeDelegation,
  includeApprovalTools = true,
  projectPath,
  settings
}: BuildAgentToolsOptions): ToolSet => {
  if (!settings.enabled) {
    return {}
  }

  const profile = resolveActiveAgentProfile(settings)
  const tools: ToolSet = {}

  for (const toolName of profile.toolPolicy.allowedToolNames) {
    if (!includeApprovalTools && APPROVAL_TOOL_NAMES.has(toolName)) {
      continue
    }

    if (isExecutableAgentToolName(toolName)) {
      tools[toolName] = createAgentTool(db, toolName, projectPath)
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
