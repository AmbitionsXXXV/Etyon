import {
  ComputerTerminal02Icon,
  FileCodeIcon,
  SearchCodeIcon,
  ToolsIcon,
  WorkflowSquare02Icon
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type { DynamicToolUIPart, ToolUIPart } from "ai"
import { getToolName } from "ai"

import {
  getBoolean,
  getNumber,
  getPathBaseName,
  getString,
  isRecord
} from "@/renderer/lib/utils"
import { isDangerousShellCommand } from "@/shared/agents/permission-mode"

export type ChatToolPart = DynamicToolUIPart | ToolUIPart
export type ChatToolState = ChatToolPart["state"]

export interface CommandOutputView {
  durationMs?: number
  exitCode?: number | null
  status?: string
  stderrPreview?: string
  stdoutPreview?: string
  truncated?: boolean
}

export interface CompactedStructuredToolTracePart {
  part: ChatToolPart
  repeatCount: number
}

const TOOL_TRACE_PREVIEW_MAX_LENGTH = 220
const TOOL_TRACE_DETAIL_MAX_LENGTH = 2_400
const TOOL_TRACE_HEADER_PREVIEW_MAX_LENGTH = 160
const COMMAND_TITLE_TOKEN_LIMIT = 4
const SHELL_COMMAND_SEPARATOR_PATTERN = /\s*(?:&&|\|\||[;|])\s*/u
const TEST_FILE_PATTERN =
  /(?:^|\s)([^\s"'`]+)\.test\.[cm]?[tj]sx?(?=$|\s|["'])/u
const REMEMBERABLE_COMMAND_APPROVAL_TOOLS = new Set([
  "bash",
  "rtkCommand",
  "runCheck"
])

export const TOOL_TRACE_STATE_LABEL_KEY_BY_STATE = {
  "approval-requested": "chat.toolTrace.state.approvalRequested",
  "approval-responded": "chat.toolTrace.state.approvalResponded",
  "input-available": "chat.toolTrace.state.inputAvailable",
  "input-streaming": "chat.toolTrace.state.inputStreaming",
  "output-available": "chat.toolTrace.state.outputAvailable",
  "output-denied": "chat.toolTrace.state.outputDenied",
  "output-error": "chat.toolTrace.state.outputError"
} as const

export const EMPTY_TOOL_TRACE_META_ITEMS: string[] = []

const isTerminalStructuredToolState = (state: ChatToolState): boolean =>
  state === "output-available" ||
  state === "output-denied" ||
  state === "output-error"

const canonicalizeStructuredValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeStructuredValue(item))
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, childValue]) => [
        key,
        canonicalizeStructuredValue(childValue)
      ])
  )
}

const getStructuredToolPartCompactionKey = (part: ChatToolPart): string =>
  JSON.stringify({
    input: canonicalizeStructuredValue(part.input),
    state: part.state,
    toolName: getToolName(part)
  })

export const compactStructuredToolTraceParts = (
  parts: readonly ChatToolPart[]
): CompactedStructuredToolTracePart[] => {
  const compactedParts: CompactedStructuredToolTracePart[] = []

  for (const part of parts) {
    const lastPart = compactedParts.at(-1)

    if (
      lastPart &&
      isTerminalStructuredToolState(part.state) &&
      isTerminalStructuredToolState(lastPart.part.state) &&
      getStructuredToolPartCompactionKey(part) ===
        getStructuredToolPartCompactionKey(lastPart.part)
    ) {
      lastPart.repeatCount += 1
      continue
    }

    compactedParts.push({
      part,
      repeatCount: 1
    })
  }

  return compactedParts
}

const formatToolTracePreview = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }

  if (typeof value === "string") {
    return value.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  try {
    return JSON.stringify(value).slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  } catch {
    return String(value).slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }
}

export const formatToolTraceDetail = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }

  if (typeof value === "string") {
    return value.slice(0, TOOL_TRACE_DETAIL_MAX_LENGTH)
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, TOOL_TRACE_DETAIL_MAX_LENGTH)
  } catch {
    return String(value).slice(0, TOOL_TRACE_DETAIL_MAX_LENGTH)
  }
}

export const getCommandTitleSubject = (command: string): string => {
  const testFileMatch = command.match(TEST_FILE_PATTERN)
  const testFilePath = testFileMatch?.[1]

  if (testFilePath) {
    return `${getPathBaseName(testFilePath)} tests`
  }

  const commandHead =
    command.split(SHELL_COMMAND_SEPARATOR_PATTERN)[0]?.trim() ?? command.trim()
  const tokens = commandHead.split(/\s+/u).filter(Boolean)
  const visibleTokens = tokens.slice(0, COMMAND_TITLE_TOKEN_LIMIT)
  const suffix = tokens.length > visibleTokens.length ? " ..." : ""

  return `${visibleTokens.join(" ")}${suffix}`.trim() || command.trim()
}

export const getShellSummary = ({
  command,
  cwd
}: {
  command: string
  cwd?: string
}): string => {
  const commandParts = command
    .split(SHELL_COMMAND_SEPARATOR_PATTERN)
    .filter((part) => part.trim().length > 0)
  const commandCount = commandParts.length + (cwd ? 1 : 0)

  if (commandCount === 0) {
    return ""
  }

  const firstCommand = cwd
    ? "cd"
    : (commandParts[0]?.split(/\s+/u).find(Boolean) ?? "")

  if (commandCount === 1) {
    return firstCommand
  }

  return `${firstCommand}, ${commandCount - 1}+`
}

export const getCollapsedOutputPreview = (output: string): string =>
  output.trim().slice(0, TOOL_TRACE_HEADER_PREVIEW_MAX_LENGTH)

export const getToolTraceStateClassName = (state: ChatToolState): string => {
  switch (state) {
    case "output-available": {
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
    }
    case "output-denied":
    case "output-error": {
      return "bg-destructive/10 text-destructive"
    }
    case "approval-requested": {
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
    }
    default: {
      return "bg-muted text-muted-foreground"
    }
  }
}

export const getToolIcon = (toolName: string): IconSvgElement => {
  if (toolName === "bash" || toolName === "shell") {
    return ComputerTerminal02Icon
  }

  if (
    toolName === "bash" ||
    toolName === "runCheck" ||
    toolName === "rtkCommand"
  ) {
    return ComputerTerminal02Icon
  }

  if (
    toolName === "read" ||
    toolName === "fileInfo" ||
    toolName === "gitDiff" ||
    toolName === "readFile"
  ) {
    return FileCodeIcon
  }

  if (
    toolName === "find" ||
    toolName === "grep" ||
    toolName === "ls" ||
    toolName === "findFiles" ||
    toolName === "listDirectory" ||
    toolName === "listProjectTree" ||
    toolName === "searchFiles"
  ) {
    return SearchCodeIcon
  }

  if (toolName === "workflow" || toolName.startsWith("agent")) {
    return WorkflowSquare02Icon
  }

  return ToolsIcon
}

export const getToolTracePreview = (part: ChatToolPart): string => {
  switch (part.state) {
    case "approval-responded":
    case "output-denied": {
      return part.approval.reason ?? ""
    }
    case "output-available": {
      return formatToolTracePreview(part.output)
    }
    case "output-error": {
      return part.errorText
    }
    default: {
      return ""
    }
  }
}

export const getCommandOutputView = (
  output: unknown
): CommandOutputView | null => {
  if (!isRecord(output)) {
    return null
  }

  const stdoutPreview = getString(output, "stdoutPreview")
  const stderrPreview = getString(output, "stderrPreview")
  const status = getString(output, "status")
  const exitCode =
    typeof output.exitCode === "number" || output.exitCode === null
      ? output.exitCode
      : undefined

  if (!(stdoutPreview || stderrPreview || status || exitCode !== undefined)) {
    return null
  }

  return {
    durationMs: getNumber(output, "durationMs"),
    exitCode,
    status,
    stderrPreview,
    stdoutPreview,
    truncated: getBoolean(output, "truncated")
  }
}

export const getCommandOutputContent = (
  commandOutput: CommandOutputView | null
): string =>
  [commandOutput?.stdoutPreview, commandOutput?.stderrPreview]
    .filter(Boolean)
    .join("\n")

export const isRtkApplied = (output: unknown): boolean => {
  if (!isRecord(output) || !isRecord(output.details)) {
    return false
  }

  return getBoolean(output.details, "rtkApplied") === true
}

export const getCommandExitCodeMeta = ({
  commandOutput,
  label
}: {
  commandOutput: CommandOutputView | null
  label: string
}): string => {
  if (commandOutput?.exitCode === undefined) {
    return ""
  }

  return `${label}: ${commandOutput.exitCode ?? "-"}`
}

export const getStructuredToolTraceMetaItems = ({
  commandDuration,
  commandExitCodeMeta,
  commandOutput,
  durationLabel,
  inputMeta,
  statusLabel,
  truncatedLabel
}: {
  commandDuration: string
  commandExitCodeMeta: string
  commandOutput: CommandOutputView | null
  durationLabel: string
  inputMeta: string
  statusLabel: string
  truncatedLabel: string
}): string[] => [
  inputMeta,
  commandOutput?.status ? `${statusLabel}: ${commandOutput.status}` : "",
  commandExitCodeMeta,
  commandDuration ? `${durationLabel}: ${commandDuration}` : "",
  commandOutput?.truncated ? truncatedLabel : ""
]

export const getToolInputCommand = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "command") ?? ""
}

export const getToolInputCwd = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "cwd") ?? ""
}

export const getToolInputPath = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "path") ?? ""
}

export const getToolInputMeta = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  const cwd = getString(input, "cwd")
  const reason = getString(input, "reason")

  return [cwd ? `cwd: ${cwd}` : "", reason].filter(Boolean).join(" · ")
}

export const getToolOutputSummary = (output: unknown): string => {
  if (!isRecord(output)) {
    return formatToolTracePreview(output)
  }

  const commandOutput = getCommandOutputView(output)

  if (commandOutput) {
    return (
      commandOutput.stderrPreview ||
      commandOutput.stdoutPreview ||
      commandOutput.status ||
      ""
    ).slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  const summary = getString(output, "summary")

  if (summary) {
    return summary.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  const content = getString(output, "content")

  if (content) {
    return content.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  const patch = getString(output, "patch")

  if (patch) {
    return patch.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  return formatToolTracePreview(output)
}

export const canRememberCommandApproval = (part: ChatToolPart): boolean =>
  part.state === "approval-requested" &&
  REMEMBERABLE_COMMAND_APPROVAL_TOOLS.has(getToolName(part)) &&
  getToolInputCommand(part.input).trim().length > 0 &&
  !isDangerousShellCommand(getToolInputCommand(part.input))
