import type { UIMessage } from "@ai-sdk/react"
import { getToolName, isToolUIPart } from "ai"

import { isArtifactToolPart } from "@/renderer/lib/chat/artifact-panel"
import { isImagenToolPart } from "@/renderer/lib/chat/imagen-message"
import type { ChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import {
  compactStructuredToolTraceParts,
  getToolInputPath
} from "@/renderer/lib/chat/message-tool-trace"
import { getPathBaseName, isRecord } from "@/renderer/lib/utils"
import { isChatRunLimitDataPart } from "@/shared/chat/stream-data"
import type {
  ChatRunLimitData,
  ChatStreamDataTypes,
  ChatTodoItem,
  ChatTodoStatus
} from "@/shared/chat/stream-data"

export type ChatUiMessage = UIMessage<ChatMessageMetadata, ChatStreamDataTypes>

export type ChatToolPart = Extract<
  ChatUiMessage["parts"][number],
  { toolCallId: string }
>

export type ReasoningChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "reasoning" }
>

export type SourceDocumentChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "source-document" }
>

export type SourceUrlChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "source-url" }
>

export type TextChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "text" }
>

export type FileChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "file" }
>

/**
 * One entry in the assistant work timeline, in streaming part order. Text
 * entries are the *intermediate* narration between tool/thinking steps — the
 * trailing summary text is split off into the message body (see
 * `getAssistantBodyText`).
 */
export type ChainEntry =
  | {
      index: number
      key: string
      kind: "reasoning"
      streaming: boolean
      text: string
    }
  | {
      key: string
      kind: "text"
      text: string
    }
  | {
      key: string
      kind: "tool"
      part: ChatToolPart
      repeatCount: number
    }

export interface ChainToolGroupItem {
  part: ChatToolPart
  repeatCount: number
}

/**
 * Semantic label for an aggregated run of tool calls. The renderer maps each
 * kind to an i18n key; keeping the string keys out of this layer lets the
 * label rules stay pure and node-testable.
 */
export type ToolGroupLabel =
  | { count: number; kind: "editedFiles" }
  | { count: number; kind: "exploredFiles" }
  | { count: number; kind: "ranCommands" }
  | { count: number; kind: "usedTools" }
  | { kind: "editedFile"; name: string }
  | { kind: "exploredFile" }
  | { kind: "exploredProject" }
  | { kind: "ranCommand" }
  | { kind: "readFile"; name: string }
  | { kind: "usedTool" }

/** Tool names that spawn nested sub-agent runs and get their own live row. */
export type SubagentToolName = "delegate" | "workflow"

export type GroupedChainEntry =
  | {
      index: number
      key: string
      kind: "reasoning"
      streaming: boolean
      text: string
    }
  | {
      hasApproval: boolean
      key: string
      kind: "tool-group"
      label: ToolGroupLabel
      tools: ChainToolGroupItem[]
    }
  | {
      key: string
      kind: "subagent-call"
      part: ChatToolPart
      toolName: SubagentToolName
    }
  | {
      key: string
      kind: "text"
      text: string
    }
  | {
      key: string
      kind: "todo"
      part: ChatToolPart
    }

const COMMAND_TOOL_NAMES = new Set(["bash", "rtkCommand", "runCheck", "shell"])
const READ_TOOL_NAMES = new Set([
  "fileInfo",
  "find",
  "findFiles",
  "gitDiff",
  "glob",
  "grep",
  "listDirectory",
  "listProjectTree",
  "ls",
  "read",
  "readFile",
  "searchFiles"
])
const WRITE_TOOL_NAMES = new Set(["edit", "write"])

type ToolTraceCategory = "command" | "other" | "read" | "write"

export const getToolTraceCategory = (toolName: string): ToolTraceCategory => {
  if (COMMAND_TOOL_NAMES.has(toolName)) {
    return "command"
  }

  if (READ_TOOL_NAMES.has(toolName)) {
    return "read"
  }

  if (WRITE_TOOL_NAMES.has(toolName)) {
    return "write"
  }

  return "other"
}

const TODO_STATUSES = new Set<ChatTodoStatus>([
  "completed",
  "in_progress",
  "pending"
])

const isChatTodoItem = (value: unknown): value is ChatTodoItem =>
  isRecord(value) &&
  typeof value.content === "string" &&
  typeof value.status === "string" &&
  TODO_STATUSES.has(value.status as ChatTodoStatus) &&
  (value.activeForm === undefined || typeof value.activeForm === "string")

/**
 * Validated todo list from a `todo_write` tool call's input. The work-section
 * todo entry uses this as the settled-run fallback once the live `data-todo`
 * store is cleared — the persisted tool-call input is that final snapshot.
 */
export const getTodoPartTodos = (part: ChatToolPart): ChatTodoItem[] => {
  const { input } = part as { input?: unknown }

  if (!isRecord(input) || !Array.isArray(input.todos)) {
    return []
  }

  return input.todos.filter(isChatTodoItem)
}

const isExcludedToolPart = (part: ChatUiMessage["parts"][number]): boolean =>
  isArtifactToolPart(part) || isImagenToolPart(part)

const isChainToolPart = (part: ChatUiMessage["parts"][number]): boolean =>
  isToolUIPart(part as never) && !isExcludedToolPart(part)

const isNonEmptyReasoningPart = (
  part: ChatUiMessage["parts"][number]
): boolean =>
  part.type === "reasoning" &&
  (part as ReasoningChatPart).text.trim().length > 0

/**
 * Index of the last "chain part" — a rendered tool call or non-empty thinking
 * block. Text before it is intermediate narration (chain); text after it is
 * the trailing summary (body). Returns -1 for a message with no chain parts.
 */
const getLastChainPartIndex = (message: ChatUiMessage): number => {
  let lastIndex = -1

  for (const [index, part] of message.parts.entries()) {
    if (isChainToolPart(part) || isNonEmptyReasoningPart(part)) {
      lastIndex = index
    }
  }

  return lastIndex
}

/** Whether the message renders a work section (any tool call or thinking). */
export const messageHasWorkSection = (message: ChatUiMessage): boolean =>
  getLastChainPartIndex(message) >= 0

export const buildAssistantChainEntries = (
  message: ChatUiMessage
): ChainEntry[] => {
  const entries: ChainEntry[] = []
  const lastChainPartIndex = getLastChainPartIndex(message)
  let toolRun: ChatToolPart[] = []
  let reasoningIndex = 0

  const flushToolRun = () => {
    if (toolRun.length === 0) {
      return
    }

    for (const { part, repeatCount } of compactStructuredToolTraceParts(
      toolRun
    )) {
      entries.push({
        key: `tool-${(part as ChatToolPart).toolCallId}`,
        kind: "tool",
        part: part as ChatToolPart,
        repeatCount
      })
    }

    toolRun = []
  }

  for (const [index, part] of message.parts.entries()) {
    // Artifact publishes render as standalone cards, and generated images
    // render inline — both after the message body, not as chain steps.
    if (isExcludedToolPart(part)) {
      continue
    }

    if (isToolUIPart(part as never)) {
      toolRun.push(part as ChatToolPart)
      continue
    }

    if (part.type === "reasoning") {
      const reasoningText = (part as ReasoningChatPart).text.trim()

      if (reasoningText.length === 0) {
        continue
      }

      flushToolRun()
      entries.push({
        index: reasoningIndex,
        key: `reasoning-${reasoningIndex}`,
        kind: "reasoning",
        streaming: (part as ReasoningChatPart).state !== "done",
        text: reasoningText
      })
      reasoningIndex += 1
      continue
    }

    if (part.type === "text") {
      // Trailing text (at/after the last chain part) is the message body; only
      // intermediate narration belongs in the timeline.
      if (lastChainPartIndex < 0 || index >= lastChainPartIndex) {
        continue
      }

      const text = (part as TextChatPart).text.trim()

      if (text.length === 0) {
        continue
      }

      flushToolRun()
      entries.push({
        key: `text-${index}`,
        kind: "text",
        text
      })
    }
  }

  flushToolRun()

  return entries
}

/** Label for a single read-category call: a listing browses the project, a read
 * with a path names the file, anything else is a generic file exploration. */
const describeSingleReadLabel = (part: ChatToolPart): ToolGroupLabel => {
  if (getToolName(part) === "ls") {
    return { kind: "exploredProject" }
  }

  const path = getToolInputPath(part.input)

  return path
    ? { kind: "readFile", name: getPathBaseName(path) }
    : { kind: "exploredFile" }
}

/**
 * Chooses the aggregated label for a run of tool calls. Consecutive calls of
 * the same category collapse to one count ("Ran 2 commands"); a lone read/edit
 * with a path gets the concrete file name ("Read foo.ts"); anything mixed or
 * uncategorized falls back to "Used N tools".
 */
export const describeToolGroup = (
  tools: readonly ChainToolGroupItem[]
): ToolGroupLabel => {
  let command = 0
  let read = 0
  let write = 0
  let other = 0

  for (const { part, repeatCount } of tools) {
    const category = getToolTraceCategory(getToolName(part))

    if (category === "command") {
      command += repeatCount
    } else if (category === "read") {
      read += repeatCount
    } else if (category === "write") {
      write += repeatCount
    } else {
      other += repeatCount
    }
  }

  const total = command + read + write + other
  const distinctCategories = [command, read, write, other].filter(
    (count) => count > 0
  ).length

  if (distinctCategories === 1 && command > 0) {
    return command === 1
      ? { kind: "ranCommand" }
      : { count: command, kind: "ranCommands" }
  }

  if (distinctCategories === 1 && read > 0) {
    const [lone] = tools

    if (read === 1 && lone) {
      return describeSingleReadLabel(lone.part)
    }

    return { count: read, kind: "exploredFiles" }
  }

  if (distinctCategories === 1 && write > 0) {
    if (write === 1) {
      const path = getToolInputPath(tools[0]?.part.input)

      if (path) {
        return { kind: "editedFile", name: getPathBaseName(path) }
      }
    }

    return { count: write, kind: "editedFiles" }
  }

  return total === 1
    ? { kind: "usedTool" }
    : { count: total, kind: "usedTools" }
}

/**
 * Collapses consecutive tool entries into one tool-group row (a disclosure that
 * expands to the individual trace cards); reasoning and text entries pass
 * through in place, preserving streaming order.
 */
export const groupChainEntries = (
  entries: readonly ChainEntry[]
): GroupedChainEntry[] => {
  const grouped: GroupedChainEntry[] = []
  let toolRun: ChainToolGroupItem[] = []

  const flushToolRun = () => {
    if (toolRun.length === 0) {
      return
    }

    const tools = toolRun
    toolRun = []

    grouped.push({
      hasApproval: tools.some(
        (item) => item.part.state === "approval-requested"
      ),
      key: `tool-group-${tools[0]?.part.toolCallId}`,
      kind: "tool-group",
      label: describeToolGroup(tools),
      tools
    })
  }

  for (const entry of entries) {
    if (entry.kind === "tool") {
      const toolName = getToolName(entry.part)

      // delegate/workflow spawn nested sub-agents — pull them out of the generic
      // Ran/Explored buckets into their own live rows.
      if (toolName === "delegate" || toolName === "workflow") {
        flushToolRun()
        grouped.push({
          key: `subagent-${entry.part.toolCallId}`,
          kind: "subagent-call",
          part: entry.part,
          toolName
        })
        continue
      }

      // todo_write maintains one run-wide checklist; collapse repeated updates
      // to a single entry at the latest call so the fold shows the current list,
      // not one card per revision.
      if (toolName === "todo_write") {
        flushToolRun()
        const existingIndex = grouped.findIndex(
          (candidate) => candidate.kind === "todo"
        )

        if (existingIndex !== -1) {
          grouped.splice(existingIndex, 1)
        }

        grouped.push({
          key: `todo-${entry.part.toolCallId}`,
          kind: "todo",
          part: entry.part
        })
        continue
      }

      toolRun.push({ part: entry.part, repeatCount: entry.repeatCount })
      continue
    }

    flushToolRun()
    grouped.push(entry)
  }

  flushToolRun()

  return grouped
}

export const hasPendingApproval = (
  entries: readonly GroupedChainEntry[]
): boolean =>
  entries.some((entry) => entry.kind === "tool-group" && entry.hasApproval)

/** Whether a compact tool group still contains a tool receiving or awaiting input. */
export const isToolGroupRunning = (
  tools: readonly ChainToolGroupItem[]
): boolean =>
  tools.some(
    ({ part }) =>
      part.state === "input-available" || part.state === "input-streaming"
  )

export type WorkSectionStatus =
  | "failed"
  | "stopped"
  | "waiting"
  | "worked"
  | "working"

/**
 * Header status for the work section. A live run is `working` (or `waiting`
 * while an approval is pending); a settled run reflects how it ended, defaulting
 * to `worked` when there is no explicit outcome (plain chat / legacy history).
 */
export const getWorkSectionStatus = ({
  exitReason,
  hasApprovalPending,
  isRunActive
}: {
  exitReason?: string | null
  hasApprovalPending: boolean
  isRunActive: boolean
}): WorkSectionStatus => {
  // An unresolved approval is always actionable — surface it (and force the
  // section open) even after the stream suspended and the run went inactive.
  if (hasApprovalPending) {
    return "waiting"
  }

  if (isRunActive) {
    return "working"
  }

  if (exitReason === "aborted") {
    return "stopped"
  }

  if (exitReason === "model-error") {
    return "failed"
  }

  return "worked"
}

/** A live run keeps the section pinned open regardless of user toggles. */
export const isWorkSectionForcedExpanded = (
  status: WorkSectionStatus
): boolean => status === "working" || status === "waiting"

/**
 * Only a normal completion self-collapses when the run settles. Interrupted and
 * failed runs stay open so the stopping point remains visible.
 */
export const isWorkSectionSelfCollapsing = (
  status: WorkSectionStatus
): boolean => status === "worked"

/**
 * Expansion for a message that first mounts already in a terminal state (chat
 * history load): stopped/failed stay open, normal completions default collapsed.
 */
export const getWorkSectionInitialExpanded = (
  status: WorkSectionStatus
): boolean => status !== "worked"

/**
 * On the error path the outcome metadata lands via a late resync, so a mounted
 * section can flip straight from settled-idle to stopped/failed without ever
 * passing through the forced-open live phase. Reopen once on that transition
 * so the stopping point is visible.
 */
export const shouldReopenWorkSection = (
  previousStatus: WorkSectionStatus,
  status: WorkSectionStatus
): boolean =>
  status !== previousStatus && (status === "failed" || status === "stopped")

export const getAssistantBodyText = (message: ChatUiMessage): string => {
  const lastChainPartIndex = getLastChainPartIndex(message)
  const bodyParts: string[] = []

  for (const [index, part] of message.parts.entries()) {
    if (part.type !== "text") {
      continue
    }

    // With chain parts present, only text at/after the last one is the body;
    // without any, every text part is the body (plain chat, unchanged).
    if (lastChainPartIndex >= 0 && index < lastChainPartIndex) {
      continue
    }

    bodyParts.push((part as TextChatPart).text)
  }

  return bodyParts.join("\n\n")
}

/** Step-limit marker the agent loop appends when a run is truncated. */
export const getRunLimitData = (
  message: ChatUiMessage
): ChatRunLimitData | null => {
  for (const part of message.parts) {
    if (isChatRunLimitDataPart(part)) {
      return part.data
    }
  }

  return null
}

export const openExternalUrl = (url: string): void => {
  window.electron.ipcRenderer.invoke("open-external-url", url)
}

export const getUrlHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const isReferencePart = (
  part: ChatUiMessage["parts"][number]
): boolean =>
  part.type === "file" ||
  part.type === "source-document" ||
  part.type === "source-url"
