import { randomUUID } from "node:crypto"

import type { AppSettings } from "@etyon/rpc"
import type {
  FinishReason,
  InferUIMessageChunk,
  LanguageModel,
  ModelMessage,
  ToolExecutionOptions,
  ToolSet,
  UIMessage,
  UIMessageStreamOptions
} from "ai"
import {
  createUIMessageStream,
  generateText,
  stepCountIs,
  streamText
} from "ai"

import { registerActiveAgentRun } from "@/main/agents/active-agent-runs"
import { recordAgentToolOutputArtifacts } from "@/main/agents/agent-artifacts"
import {
  AgentRuntimeError,
  getAgentRuntimeErrorMessage,
  toAgentRuntimeError
} from "@/main/agents/agent-errors"
import {
  createAgentRun,
  getLatestCompletedAgentRunForSession,
  getAgentRunForToolApproval,
  listAgentEvents,
  listPendingAgentApprovals,
  listAgentToolCalls,
  recordAgentToolCall,
  updateAgentRun,
  updateAgentToolCall
} from "@/main/agents/agent-event-store"
import type { AgentEvent, AgentRun } from "@/main/agents/agent-event-store"
import type {
  AgentLoopExecutedToolResult,
  AgentLoopMessage,
  AgentLoopStopReason,
  AgentLoopToolCall,
  AgentLoopToolRetryPolicy,
  AgentLoopUserMessage
} from "@/main/agents/agent-loop"
import { runAgentLoop } from "@/main/agents/agent-loop"
import {
  convertAgentLoopMessagesToModelMessages,
  convertModelMessagesToAgentLoopMessages,
  createAiSdkAgentLoopModel,
  createAiSdkAgentLoopTools
} from "@/main/agents/agent-loop-ai-sdk"
import {
  completeUnresolvedToolCallsInModelMessages,
  convertAgentMessagesToLlm
} from "@/main/agents/agent-messages"
import {
  isRetryableAgentFailure,
  parseStructuredPlanFromText,
  stripPlanProgressMarkers,
  summarizePlanProgress
} from "@/main/agents/agent-plan-progress"
import {
  appendAgentSessionSavePointEvent,
  appendAgentSessionPlanModeEvent,
  appendAgentSessionModelMessageEvents,
  buildAgentSessionModelContextFromLatestSavePoint,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"
import type { AgentSessionQueuedMessageQueue } from "@/main/agents/agent-session-events"
import type { AgentRuntimeState as AgentPhaseRuntimeState } from "@/main/agents/agent-state"
import {
  applyAgentStreamResponseHooks,
  prepareAgentStreamRequest
} from "@/main/agents/agent-stream-hooks"
import type { AgentStreamHooks } from "@/main/agents/agent-stream-hooks"
import { createAgentTurnState } from "@/main/agents/agent-turn-state"
import { resolveActiveAgentProfile } from "@/main/agents/profiles"
import { buildAgentTools } from "@/main/agents/tool-registry"
import type { ExecuteAgentDelegation } from "@/main/agents/tool-registry"
import type { AppDatabase } from "@/main/db"

export interface AgentRuntimeStreamOptions {
  headers?: Readonly<Record<string, string>>
  metadata?: Readonly<Record<string, unknown>>
}

export interface StreamAgentChatOptions {
  abortSignal?: AbortSignal
  activeToolNames?: readonly string[]
  db: AppDatabase
  messages: ModelMessage[]
  model: LanguageModel
  modelId?: string | null
  projectPath: string
  runtimeState?: AgentPhaseRuntimeState
  sessionId: string
  settings: AppSettings
  skillCapabilities?: readonly string[]
  streamHooks?: AgentStreamHooks
  streamOptions?: AgentRuntimeStreamOptions
  systemPrompts: string[]
}

interface AgentToolCallEvent {
  toolCall: {
    input: unknown
    toolCallId: string
    toolName: string
  }
}

interface AgentToolCallFinishEvent extends AgentToolCallEvent {
  error?: unknown
  output?: unknown
  success: boolean
}

interface AgentStepFinishEvent {
  content: unknown[]
}

interface AgentToolLifecycleHandlers {
  onToolCallFinish: (event: AgentToolCallFinishEvent) => Promise<void>
  onToolCallStart: (event: AgentToolCallEvent) => Promise<void>
}

interface ToolApprovalRequestRecord {
  approvalId: string
  input?: unknown
  toolCallId: string
  toolName?: string
}

interface ToolApprovalResponseRecord {
  approvalId: string
  approved: boolean
  input?: unknown
  reason?: string
  toolCallId: string
  toolName?: string
}

interface ToolApprovalResumeMatch {
  responseRecords: ToolApprovalResponseRecord[]
  run: AgentRun
}

interface AgentRunRuntimeState {
  hasPendingApproval: boolean
}

interface PersistedAgentSessionContext {
  messages: ModelMessage[]
  queuedMessages: ModelMessage[]
}

interface AgentRequestModelMessagesContext {
  modelMessages: ModelMessage[]
  persistedSessionContext: PersistedAgentSessionContext
}

type AgentRunFinishStatus = "failed" | "succeeded" | "suspended"
type AgentUiStreamChunk = InferUIMessageChunk<UIMessage>

interface PendingLoopApprovalRequest {
  approvalId: string
  toolCall: AgentLoopToolCall
}

interface MainAgentLoopExecutionResult {
  finishReason: FinishReason
  generatedMessages: ModelMessage[]
  status: AgentRunFinishStatus
  text: string
}

interface AgentChatStreamResult {
  consumeStream: (options?: {
    onError?: (error: unknown) => void
  }) => PromiseLike<void>
  toUIMessageStream: <UI_MESSAGE extends UIMessage>(
    options?: UIMessageStreamOptions<UI_MESSAGE>
  ) => ReadableStream<InferUIMessageChunk<UI_MESSAGE>>
}

const DELEGATION_SUMMARY_MAX_CHARS = 6_000
const AGENT_RUN_STOPPED_MESSAGE = "Agent run was stopped."
const ANT_THINKING_BLOCK_PATTERN = /<antThinking>[\s\S]*?<\/antThinking>/gu
const COMMAND_TRANSCRIPT_BLOCK_PATTERN =
  /(?:^|\n)Executed in [^\n]*(?:\r?\n)(?:bash|fish|sh|zsh)(?:\r?\n)[\s\S]*?(?:\r?\n)-?\d+(?=\r?\n|$)/gu
const EXCESS_BLANK_LINES_PATTERN = /\n{3,}/gu
const FUNCTION_CALLS_BLOCK_PATTERN =
  /<function_calls>[\s\S]*?<\/function_calls>/gu
const MODEL_MESSAGE_ROLES = new Set(["assistant", "system", "tool", "user"])

interface AgentUiStreamWaiter {
  reject: (reason?: unknown) => void
  resolve: (value: IteratorResult<AgentUiStreamChunk>) => void
}

interface AgentUiStreamBridge {
  close: () => void
  fail: (error: unknown) => void
  read: () => AsyncIterable<AgentUiStreamChunk>
  write: (chunk: AgentUiStreamChunk) => void
}

interface AgentUiLiveSink {
  finishText: () => void
  writeApprovalRequest: (request: PendingLoopApprovalRequest) => void
  writeTextDelta: (text: string) => void
  writeToolCall: (toolCall: AgentLoopToolCall) => void
  writeToolResult: (result: {
    isError: boolean
    output: unknown
    toolCall: AgentLoopToolCall
  }) => void
}

const filterActiveAgentTools = <TTool>({
  activeToolNames,
  tools
}: {
  activeToolNames?: readonly string[]
  tools: Record<string, TTool>
}): Record<string, TTool> => {
  if (!activeToolNames) {
    return tools
  }

  const activeToolNameSet = new Set(activeToolNames)

  return Object.fromEntries(
    Object.entries(tools).filter(([toolName]) =>
      activeToolNameSet.has(toolName)
    )
  ) as Record<string, TTool>
}

const AGENT_TOOL_PROMPT_SNIPPETS: Record<string, string> = {
  agentCoder: "Delegate approved implementation work to a coder child agent",
  agentEventsSearch: "Search append-only agent runtime events",
  agentExplore: "Delegate focused read-only exploration to a child agent",
  agentPlan: "Delegate read-only planning to a child agent",
  agentReview: "Delegate code review to a child agent",
  agentRunInspect: "Inspect an agent run trace",
  applyPatch: "Apply a unified patch inside the active project",
  bash: "Execute bash commands",
  edit: "Make surgical edits to files with exact replacements",
  editFile: "Apply exact oldText/newText replacements",
  fileInfo: "Read file metadata without following symlinks",
  find: "Find files by glob pattern",
  findFiles: "Find project files by path query",
  gitDiff: "Read the current git diff",
  grep: "Search file contents with ripgrep",
  inspect: "Inspect source positions with sandboxed LSP",
  listDirectory: "List direct directory children",
  listProjectTree: "List project files and folders",
  ls: "List directory contents",
  memorySearch: "Search enabled long-term memory",
  read: "Read file contents",
  readFile: "Read a UTF-8 text file",
  rtkCommand: "Run a command through the project RTK wrapper",
  runCheck: "Run a bounded project check command",
  searchFiles: "Search project file contents with ripgrep",
  webSearch: "Search the public web",
  write: "Create or overwrite files",
  writeFile: "Create or overwrite a UTF-8 text file"
}

const getToolPromptSnippet = (toolName: string): string =>
  AGENT_TOOL_PROMPT_SNIPPETS[toolName] ?? "Use this tool only when needed"

const buildAgentToolPromptSection = (toolNames: readonly string[]): string => {
  if (toolNames.length === 0) {
    return "- none"
  }

  return toolNames
    .map((toolName) => `- ${toolName}: ${getToolPromptSnippet(toolName)}`)
    .join("\n")
}

const buildAgentToolGuidelines = (toolNames: readonly string[]): string[] => {
  const toolNameSet = new Set(toolNames)
  const hasBash = toolNameSet.has("bash")
  const hasEdit = toolNameSet.has("edit")
  const hasFind = toolNameSet.has("find")
  const hasGrep = toolNameSet.has("grep")
  const hasLs = toolNameSet.has("ls")
  const hasRead = toolNameSet.has("read")
  const hasWrite = toolNameSet.has("write")
  const guidelines: string[] = []

  if (!(hasBash || hasEdit || hasWrite)) {
    guidelines.push(
      "You are in READ-ONLY mode - you cannot modify files or execute arbitrary commands."
    )
  }

  if (hasBash && !(hasEdit || hasWrite)) {
    guidelines.push(
      "Use bash only for read-only operations; do not modify files."
    )
  }

  if (hasBash && (hasGrep || hasFind || hasLs)) {
    guidelines.push("Prefer grep/find/ls tools over bash for file exploration.")
  } else if (hasBash) {
    guidelines.push("Use bash for file operations like ls, grep, and find.")
  }

  if (hasRead && hasEdit) {
    guidelines.push("Use read to examine files before editing.")
  }

  if (hasEdit) {
    guidelines.push(
      "Use edit for precise changes; each oldText must match exactly."
    )
  }

  if (hasWrite) {
    guidelines.push("Use write only for new files or complete rewrites.")
  }

  if (hasEdit || hasWrite) {
    guidelines.push(
      "When summarizing your actions, output plain text directly; do not run commands only to display what you did."
    )
  }

  guidelines.push("Be concise in your responses.")
  guidelines.push("Show file paths clearly when working with files.")

  return guidelines
}

const buildAgentSystemPrompt = ({
  profileId,
  toolNames
}: {
  profileId: string
  toolNames: string[]
}): string =>
  [
    `Active agent profile: ${profileId}.`,
    "",
    "Available tools:",
    buildAgentToolPromptSection(toolNames),
    "",
    "Guidelines:",
    ...buildAgentToolGuidelines(toolNames).map((guideline) => `- ${guideline}`),
    "- Use tools only when they reduce uncertainty, and ground final answers in tool results."
  ].join("\n")

const getErrorMessage = getAgentRuntimeErrorMessage

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toRejectionError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(getErrorMessage(error))

const getToolRetryErrorMessage = (output: unknown): string => {
  if (isRecord(output) && typeof output.error === "string") {
    return output.error
  }

  if (typeof output === "string") {
    return output
  }

  return getErrorMessage(output)
}

const createAgentLoopToolRetryPolicy = (
  retry: AppSettings["agents"]["retry"]
): AgentLoopToolRetryPolicy => ({
  maxRetries: retry.maxAutomaticRetries,
  shouldRetry: ({ result }) =>
    retry.retryTransientFailures &&
    isRetryableAgentFailure(getToolRetryErrorMessage(result.output))
})

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  isRecord(value) && Symbol.asyncIterator in value

const collectAsyncIterable = async (
  iterable: AsyncIterable<unknown>
): Promise<unknown[]> => {
  const values: unknown[] = []

  for await (const value of iterable) {
    values.push(value)
  }

  return values
}

const createCombinedAbortSignal = (
  signals: readonly (AbortSignal | undefined)[]
): AbortSignal | undefined => {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined
  )

  if (activeSignals.length <= 1) {
    return activeSignals[0]
  }

  const abortSignal = AbortSignal as typeof AbortSignal & {
    any: (signals: readonly AbortSignal[]) => AbortSignal
  }

  return abortSignal.any(activeSignals)
}

const isModelMessage = (value: unknown): value is ModelMessage =>
  isRecord(value) &&
  "content" in value &&
  typeof value.role === "string" &&
  MODEL_MESSAGE_ROLES.has(value.role)

const isModelMessageArray = (value: unknown): value is ModelMessage[] =>
  Array.isArray(value) && value.every(isModelMessage)

const getModelMessageText = (message: ModelMessage): string => {
  if (typeof message.content === "string") {
    return message.content
  }

  if (!Array.isArray(message.content)) {
    return ""
  }

  const contentParts: unknown[] = message.content

  return contentParts
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("")
}

const getProviderResponseText = ({
  event,
  messages
}: {
  event: unknown
  messages: readonly ModelMessage[]
}): string => {
  if (isRecord(event) && typeof event.text === "string") {
    return event.text
  }

  return messages
    .filter((message) => message.role === "assistant")
    .map(getModelMessageText)
    .filter(Boolean)
    .join("\n")
}

const toMainLoopFinishReason = (
  stopReason: AgentLoopStopReason
): FinishReason => {
  if (stopReason === "aborted" || stopReason === "error") {
    return "error"
  }

  if (stopReason === "max_turns") {
    return "length"
  }

  if (stopReason === "suspended") {
    return "tool-calls"
  }

  return "stop"
}

const isMainLoopSuspended = (stopReason: AgentLoopStopReason): boolean =>
  stopReason === "suspended"

const toMainLoopRunStatus = (
  stopReason: AgentLoopStopReason
): AgentRunFinishStatus => {
  if (stopReason === "aborted" || stopReason === "error") {
    return "failed"
  }

  if (isMainLoopSuspended(stopReason)) {
    return "suspended"
  }

  return "succeeded"
}

const getMainLoopFailureMessage = (
  stopReason: AgentLoopStopReason
): string | null => {
  if (stopReason === "aborted") {
    return AGENT_RUN_STOPPED_MESSAGE
  }

  if (stopReason === "error") {
    return "Agent loop stopped with an error."
  }

  return null
}

const getToolResultOutputValue = (output: unknown): unknown => {
  if (!isRecord(output) || typeof output.type !== "string") {
    return output
  }

  if ("value" in output) {
    return output.value
  }

  return output
}

const getToolResultErrorText = (output: unknown): string => {
  const value = getToolResultOutputValue(output)

  return typeof value === "string" ? value : JSON.stringify(value)
}

const injectApprovalRequestsIntoModelMessages = ({
  approvalRequests,
  messages
}: {
  approvalRequests: readonly PendingLoopApprovalRequest[]
  messages: readonly ModelMessage[]
}): ModelMessage[] => {
  if (approvalRequests.length === 0) {
    return [...messages]
  }

  const approvalByToolCallId = new Map(
    approvalRequests.map((request) => [request.toolCall.toolCallId, request])
  )

  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message
    }

    const contentParts: unknown[] = [...message.content]
    const nextContent: unknown[] = []

    for (const part of contentParts) {
      nextContent.push(part)

      if (
        !isRecord(part) ||
        part.type !== "tool-call" ||
        typeof part.toolCallId !== "string"
      ) {
        continue
      }

      const approval = approvalByToolCallId.get(part.toolCallId)

      if (!approval) {
        continue
      }

      nextContent.push({
        approvalId: approval.approvalId,
        input: approval.toolCall.input,
        toolCallId: approval.toolCall.toolCallId,
        toolName: approval.toolCall.toolName,
        type: "tool-approval-request"
      })
    }

    return {
      ...message,
      content: nextContent as ModelMessage["content"]
    } as ModelMessage
  })
}

interface UiMessageChunkWriter<UI_MESSAGE extends UIMessage> {
  write: (part: InferUIMessageChunk<UI_MESSAGE>) => void
}

const writeTextToUiStream = <UI_MESSAGE extends UIMessage>({
  text,
  writer
}: {
  text: string
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  if (text.length === 0) {
    return
  }

  const textId = `agent-text-${randomUUID()}`

  writer.write({
    id: textId,
    type: "text-start"
  } as InferUIMessageChunk<UI_MESSAGE>)
  writer.write({
    delta: text,
    id: textId,
    type: "text-delta"
  } as InferUIMessageChunk<UI_MESSAGE>)
  writer.write({
    id: textId,
    type: "text-end"
  } as InferUIMessageChunk<UI_MESSAGE>)
}

const writeAssistantPartToUiStream = <UI_MESSAGE extends UIMessage>({
  part,
  writer
}: {
  part: unknown
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  if (
    isRecord(part) &&
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    writer.write({
      input: part.input,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      type: "tool-input-available"
    } as InferUIMessageChunk<UI_MESSAGE>)
    return
  }

  if (
    isRecord(part) &&
    part.type === "tool-approval-request" &&
    typeof part.approvalId === "string" &&
    typeof part.toolCallId === "string"
  ) {
    writer.write({
      approvalId: part.approvalId,
      toolCallId: part.toolCallId,
      type: "tool-approval-request"
    } as InferUIMessageChunk<UI_MESSAGE>)
  }
}

const writeAssistantMessageToUiStream = <UI_MESSAGE extends UIMessage>({
  message,
  writer
}: {
  message: ModelMessage
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  writeTextToUiStream({
    text: getModelMessageText(message),
    writer
  })

  if (!Array.isArray(message.content)) {
    return
  }

  for (const part of message.content) {
    writeAssistantPartToUiStream({
      part,
      writer
    })
  }
}

const writeToolPartToUiStream = <UI_MESSAGE extends UIMessage>({
  part,
  writer
}: {
  part: unknown
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  if (
    !isRecord(part) ||
    part.type !== "tool-result" ||
    typeof part.toolCallId !== "string"
  ) {
    return
  }

  if (
    isRecord(part.output) &&
    typeof part.output.type === "string" &&
    part.output.type.startsWith("error-")
  ) {
    writer.write({
      errorText: getToolResultErrorText(part.output),
      toolCallId: part.toolCallId,
      type: "tool-output-error"
    } as InferUIMessageChunk<UI_MESSAGE>)
    return
  }

  writer.write({
    output: getToolResultOutputValue(part.output),
    toolCallId: part.toolCallId,
    type: "tool-output-available"
  } as InferUIMessageChunk<UI_MESSAGE>)
}

const writeToolMessageToUiStream = <UI_MESSAGE extends UIMessage>({
  message,
  writer
}: {
  message: ModelMessage
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  if (!Array.isArray(message.content)) {
    return
  }

  for (const part of message.content) {
    writeToolPartToUiStream({
      part,
      writer
    })
  }
}

const writeModelMessageToUiStream = <UI_MESSAGE extends UIMessage>({
  message,
  writer
}: {
  message: ModelMessage
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  if (message.role === "assistant") {
    writeAssistantMessageToUiStream({
      message,
      writer
    })
    return
  }

  if (message.role === "tool") {
    writeToolMessageToUiStream({
      message,
      writer
    })
  }
}

const writeModelMessagesToUiStream = <UI_MESSAGE extends UIMessage>({
  finishReason,
  messages,
  options,
  writer
}: {
  finishReason: FinishReason
  messages: readonly ModelMessage[]
  options?: UIMessageStreamOptions<UI_MESSAGE>
  writer: UiMessageChunkWriter<UI_MESSAGE>
}): void => {
  if (options?.sendStart !== false) {
    writer.write({ type: "start" } as InferUIMessageChunk<UI_MESSAGE>)
  }

  for (const message of messages) {
    writeModelMessageToUiStream({
      message,
      writer
    })
  }

  if (options?.sendFinish !== false) {
    writer.write({
      finishReason,
      type: "finish"
    } as InferUIMessageChunk<UI_MESSAGE>)
  }
}

const createAgentUiStreamBridge = (): AgentUiStreamBridge => {
  const chunks: AgentUiStreamChunk[] = []
  const waiters: AgentUiStreamWaiter[] = []
  let closed = false
  let error: Error | undefined

  return {
    close: () => {
      if (closed) {
        return
      }

      closed = true

      for (const waiter of waiters.splice(0)) {
        waiter.resolve({
          done: true,
          value: undefined
        })
      }
    },
    fail: (nextError) => {
      if (closed) {
        return
      }

      closed = true
      error = toRejectionError(nextError)

      if (chunks.length > 0) {
        return
      }

      for (const waiter of waiters.splice(0)) {
        waiter.reject(error)
      }
    },
    read: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: (): Promise<IteratorResult<AgentUiStreamChunk>> => {
            const chunk = chunks.shift()

            if (chunk) {
              return Promise.resolve({
                done: false,
                value: chunk
              })
            }

            if (error) {
              const { promise, reject } =
                Promise.withResolvers<IteratorResult<AgentUiStreamChunk>>()

              reject(error)

              return promise
            }

            if (closed) {
              return Promise.resolve({
                done: true,
                value: undefined
              })
            }

            const { promise, reject, resolve } =
              Promise.withResolvers<IteratorResult<AgentUiStreamChunk>>()

            waiters.push({
              reject,
              resolve
            })

            return promise
          }
        }
      }
    }),
    write: (chunk) => {
      if (closed) {
        return
      }

      const waiter = waiters.shift()

      if (waiter) {
        waiter.resolve({
          done: false,
          value: chunk
        })
        return
      }

      chunks.push(chunk)
    }
  }
}

const createAgentUiLiveSink = (
  stream: AgentUiStreamBridge
): AgentUiLiveSink => {
  let activeTextId: string | null = null

  const ensureTextId = (): string => {
    if (activeTextId) {
      return activeTextId
    }

    activeTextId = `agent-text-${randomUUID()}`
    stream.write({
      id: activeTextId,
      type: "text-start"
    } as AgentUiStreamChunk)

    return activeTextId
  }

  const finishText = (): void => {
    if (!activeTextId) {
      return
    }

    stream.write({
      id: activeTextId,
      type: "text-end"
    } as AgentUiStreamChunk)
    activeTextId = null
  }

  return {
    finishText,
    writeApprovalRequest: ({ approvalId, toolCall }) => {
      finishText()
      stream.write({
        approvalId,
        toolCallId: toolCall.toolCallId,
        type: "tool-approval-request"
      } as AgentUiStreamChunk)
    },
    writeTextDelta: (text) => {
      if (text.length === 0) {
        return
      }

      stream.write({
        delta: text,
        id: ensureTextId(),
        type: "text-delta"
      } as AgentUiStreamChunk)
    },
    writeToolCall: (toolCall) => {
      finishText()
      stream.write({
        input: toolCall.input,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        type: "tool-input-available"
      } as AgentUiStreamChunk)
    },
    writeToolResult: ({ isError, output, toolCall }) => {
      finishText()

      if (isError) {
        stream.write({
          errorText: getToolRetryErrorMessage(output),
          toolCallId: toolCall.toolCallId,
          type: "tool-output-error"
        } as AgentUiStreamChunk)
        return
      }

      stream.write({
        output,
        toolCallId: toolCall.toolCallId,
        type: "tool-output-available"
      } as AgentUiStreamChunk)
    }
  }
}

const writeToolMessageToLiveSink = ({
  liveSink,
  message
}: {
  liveSink: AgentUiLiveSink
  message: ModelMessage
}): void => {
  if (message.role !== "tool" || !Array.isArray(message.content)) {
    return
  }

  const contentParts: unknown[] = [...message.content]

  for (const part of contentParts) {
    if (
      !isRecord(part) ||
      part.type !== "tool-result" ||
      typeof part.toolCallId !== "string" ||
      typeof part.toolName !== "string"
    ) {
      continue
    }

    const isError =
      isRecord(part.output) &&
      typeof part.output.type === "string" &&
      part.output.type.startsWith("error-")

    liveSink.writeToolResult({
      isError,
      output: getToolResultOutputValue(part.output),
      toolCall: {
        input: undefined,
        toolCallId: part.toolCallId,
        toolName: part.toolName
      }
    })
  }
}

const createMainLoopStreamResult = (
  execution: Promise<MainAgentLoopExecutionResult>,
  liveStream?: AgentUiStreamBridge
): AgentChatStreamResult => {
  void (async () => {
    try {
      await execution
      liveStream?.close()
    } catch (error) {
      liveStream?.fail(error)
      // Consumers observe the same promise through consumeStream() or the UI stream.
    }
  })()

  return {
    consumeStream: async (options) => {
      try {
        await execution
      } catch (error) {
        options?.onError?.(error)
      }
    },
    toUIMessageStream: <UI_MESSAGE extends UIMessage>(
      options?: UIMessageStreamOptions<UI_MESSAGE>
    ) =>
      createUIMessageStream<UI_MESSAGE>({
        execute: async ({ writer }) => {
          try {
            if (liveStream) {
              if (options?.sendStart !== false) {
                writer.write({
                  type: "start"
                } as InferUIMessageChunk<UI_MESSAGE>)
              }

              for await (const chunk of liveStream.read()) {
                writer.write(chunk as InferUIMessageChunk<UI_MESSAGE>)
              }

              const result = await execution

              if (options?.sendFinish !== false) {
                writer.write({
                  finishReason: result.finishReason,
                  type: "finish"
                } as InferUIMessageChunk<UI_MESSAGE>)
              }
              return
            }

            const result = await execution

            writeModelMessagesToUiStream({
              finishReason: result.finishReason,
              messages: result.generatedMessages,
              options,
              writer
            })
          } catch (error) {
            writer.write({
              errorText: options?.onError?.(error) ?? getErrorMessage(error),
              type: "error"
            } as InferUIMessageChunk<UI_MESSAGE>)
          }
        },
        onError: options?.onError,
        onFinish: options?.onFinish,
        originalMessages: options?.originalMessages
      })
  }
}

const stripPlanProgressFromModelMessages = ({
  executionMode,
  messages
}: {
  executionMode: string
  messages: readonly ModelMessage[]
}): ModelMessage[] => {
  if (executionMode !== "plan") {
    return [...messages]
  }

  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message
    }

    if (typeof message.content === "string") {
      return {
        ...message,
        content: stripPlanProgressMarkers(message.content).trim()
      }
    }

    if (!Array.isArray(message.content)) {
      return message
    }

    const contentParts: unknown[] = message.content
    const content = contentParts.map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
        ? {
            ...part,
            text: stripPlanProgressMarkers(part.text).trim()
          }
        : part
    ) as ModelMessage["content"]

    return {
      ...message,
      content
    } as ModelMessage
  })
}

const appendPlanModeSessionEvents = async ({
  executionMode,
  responseText,
  run
}: {
  executionMode: string
  responseText: string
  run: AgentRun
}): Promise<void> => {
  if (executionMode !== "plan") {
    return
  }

  const summary = summarizePlanProgress(responseText)
  const structuredPlan = parseStructuredPlanFromText(responseText)

  if (summary.completedCount === 0 && !structuredPlan) {
    return
  }

  for (const stepNumber of summary.completedStepNumbers) {
    await run.appendEvent({
      payload: {
        mode: "plan",
        stepNumber
      },
      type: "plan_step_completed"
    })
  }

  if (structuredPlan) {
    await run.appendEvent({
      payload: {
        plan: structuredPlan
      },
      type: "plan_validated"
    })
  }

  await appendAgentSessionPlanModeEvent({
    completedStepNumbers: summary.completedStepNumbers,
    mode: "plan",
    run,
    ...(structuredPlan ? { structuredPlan } : {})
  })
}

const clampDelegationSummary = (
  text: string
): {
  summary: string
  truncated: boolean
} => ({
  summary: text.slice(0, DELEGATION_SUMMARY_MAX_CHARS),
  truncated: text.length > DELEGATION_SUMMARY_MAX_CHARS
})

const sanitizeDelegationSummary = (text: string): string =>
  text
    .replace(ANT_THINKING_BLOCK_PATTERN, "")
    .replace(FUNCTION_CALLS_BLOCK_PATTERN, "")
    .replace(COMMAND_TRANSCRIPT_BLOCK_PATTERN, "\n")
    .replace(EXCESS_BLANK_LINES_PATTERN, "\n\n")
    .trim()

const buildDelegationPrompt = ({
  context,
  expectedOutput,
  task
}: {
  context: string
  expectedOutput: string
  task: string
}): string =>
  [
    "You are a delegated child agent. Work only on the bounded task below.",
    "Do not assume access to the parent conversation beyond the provided context.",
    "Return a concise summary with concrete evidence and any remaining uncertainty.",
    "",
    `Task:\n${task}`,
    context ? `Context:\n${context}` : "",
    expectedOutput ? `Expected output:\n${expectedOutput}` : ""
  ]
    .filter(Boolean)
    .join("\n\n")

const getMessageContentParts = (message: ModelMessage): unknown[] =>
  Array.isArray(message.content) ? message.content : []

const getToolApprovalRequestRecord = (
  part: unknown
): ToolApprovalRequestRecord | undefined => {
  if (!isRecord(part) || part.type !== "tool-approval-request") {
    return undefined
  }

  if (typeof part.approvalId !== "string") {
    return undefined
  }

  if (typeof part.toolCallId === "string") {
    return {
      approvalId: part.approvalId,
      ...(part.input === undefined ? {} : { input: part.input }),
      toolCallId: part.toolCallId,
      ...(typeof part.toolName === "string" ? { toolName: part.toolName } : {})
    }
  }

  if (!isRecord(part.toolCall)) {
    return undefined
  }

  const { input, toolCallId, toolName } = part.toolCall

  if (typeof toolCallId !== "string") {
    return undefined
  }

  return {
    approvalId: part.approvalId,
    input,
    toolCallId,
    toolName: typeof toolName === "string" ? toolName : undefined
  }
}

const collectToolApprovalRequestRecords = (
  messages: ModelMessage[]
): Map<string, ToolApprovalRequestRecord> => {
  const records = new Map<string, ToolApprovalRequestRecord>()

  for (const message of messages) {
    for (const part of getMessageContentParts(message)) {
      const record = getToolApprovalRequestRecord(part)

      if (record) {
        records.set(record.approvalId, record)
      }
    }
  }

  return records
}

const collectToolApprovalResponseRecords = (
  messages: ModelMessage[]
): ToolApprovalResponseRecord[] => {
  const requestRecords = collectToolApprovalRequestRecords(messages)
  const responseRecords: ToolApprovalResponseRecord[] = []

  for (const message of messages) {
    if (message.role !== "tool") {
      continue
    }

    for (const part of getMessageContentParts(message)) {
      if (
        !isRecord(part) ||
        part.type !== "tool-approval-response" ||
        typeof part.approvalId !== "string" ||
        typeof part.approved !== "boolean"
      ) {
        continue
      }

      const request = requestRecords.get(part.approvalId)

      if (!request) {
        continue
      }

      responseRecords.push({
        approvalId: part.approvalId,
        approved: part.approved,
        ...(request.input === undefined ? {} : { input: request.input }),
        reason: typeof part.reason === "string" ? part.reason : undefined,
        toolCallId: request.toolCallId,
        ...(request.toolName ? { toolName: request.toolName } : {})
      })
    }
  }

  return responseRecords
}

const collectToolApprovalResponseIds = (
  messages: ModelMessage[]
): Set<string> => {
  const approvalIds = new Set<string>()

  for (const message of messages) {
    if (message.role !== "tool") {
      continue
    }

    for (const part of getMessageContentParts(message)) {
      if (
        isRecord(part) &&
        part.type === "tool-approval-response" &&
        typeof part.approvalId === "string"
      ) {
        approvalIds.add(part.approvalId)
      }
    }
  }

  return approvalIds
}

const collectToolCallIdsForApprovalIds = ({
  approvalIds,
  messages
}: {
  approvalIds: Set<string>
  messages: ModelMessage[]
}): Set<string> => {
  const toolCallIds = new Set<string>()

  for (const message of messages) {
    for (const part of getMessageContentParts(message)) {
      const record = getToolApprovalRequestRecord(part)

      if (record && approvalIds.has(record.approvalId)) {
        toolCallIds.add(record.toolCallId)
      }
    }
  }

  return toolCallIds
}

const getPartToolCallId = (part: Record<string, unknown>): string | null =>
  typeof part.toolCallId === "string" ? part.toolCallId : null

const shouldKeepApprovalResumePart = ({
  blockedApprovalIds,
  blockedToolCallIds,
  part
}: {
  blockedApprovalIds: Set<string>
  blockedToolCallIds: Set<string>
  part: unknown
}): boolean => {
  if (!isRecord(part)) {
    return true
  }

  if (
    part.type === "tool-approval-response" &&
    typeof part.approvalId === "string" &&
    blockedApprovalIds.has(part.approvalId)
  ) {
    return false
  }

  const requestRecord = getToolApprovalRequestRecord(part)

  if (requestRecord && blockedApprovalIds.has(requestRecord.approvalId)) {
    return false
  }

  const toolCallId = getPartToolCallId(part)

  if (
    toolCallId &&
    blockedToolCallIds.has(toolCallId) &&
    (part.type === "tool-call" ||
      part.type === "tool-error" ||
      part.type === "tool-result")
  ) {
    return false
  }

  return true
}

const filterUnmatchedApprovalResumeMessages = ({
  allowedApprovalIds,
  messages
}: {
  allowedApprovalIds: Set<string>
  messages: ModelMessage[]
}): ModelMessage[] => {
  const respondedApprovalIds = collectToolApprovalResponseIds(messages)
  const blockedApprovalIds = new Set(
    [...respondedApprovalIds].filter(
      (approvalId) => !allowedApprovalIds.has(approvalId)
    )
  )

  if (blockedApprovalIds.size === 0) {
    return messages
  }

  const blockedToolCallIds = collectToolCallIdsForApprovalIds({
    approvalIds: blockedApprovalIds,
    messages
  })

  return messages.flatMap((message) => {
    const content = getMessageContentParts(message)

    if (content.length === 0) {
      return [message]
    }

    const nextContent = content.filter((part) =>
      shouldKeepApprovalResumePart({
        blockedApprovalIds,
        blockedToolCallIds,
        part
      })
    )

    if (nextContent.length === content.length) {
      return [message]
    }

    if (nextContent.length === 0) {
      return []
    }

    return [
      {
        ...message,
        content: nextContent
      } as ModelMessage
    ]
  })
}

const recordToolApprovalResponses = async ({
  db,
  responseRecords,
  run
}: {
  db: AppDatabase
  responseRecords: ToolApprovalResponseRecord[]
  run: AgentRun
}): Promise<void> => {
  for (const response of responseRecords) {
    const errorMessage = response.approved
      ? null
      : (response.reason ?? "Tool approval denied.")

    await updateAgentToolCall({
      approvalState: response.approved ? "approved" : "denied",
      db,
      errorMessage,
      id: response.toolCallId,
      runId: run.id,
      state: response.approved ? "requested" : "failed"
    })
    await run.appendEvent({
      payload: {
        approvalId: response.approvalId,
        approved: response.approved,
        ...(response.reason === undefined ? {} : { reason: response.reason }),
        toolCallId: response.toolCallId,
        ...(response.toolName ? { toolName: response.toolName } : {})
      },
      type: response.approved ? "tool_call_approved" : "tool_call_denied"
    })
  }
}

const executeApprovedToolApprovalResponses = async ({
  abortSignal,
  agentTools,
  db,
  lifecycleHandlers,
  messages,
  metadata,
  responseRecords,
  run
}: {
  abortSignal?: AbortSignal
  agentTools: ToolSet
  db: AppDatabase
  lifecycleHandlers: AgentToolLifecycleHandlers
  messages: readonly ModelMessage[]
  metadata?: Readonly<Record<string, unknown>>
  responseRecords: readonly ToolApprovalResponseRecord[]
  run: AgentRun
}): Promise<ModelMessage[]> => {
  const resultMessages: ModelMessage[] = []

  for (const response of responseRecords) {
    if (!response.approved) {
      continue
    }

    const toolName = response.toolName ?? "unknown"
    const toolCall = {
      input: response.input,
      toolCallId: response.toolCallId,
      toolName
    }
    const execute = agentTools[toolName]?.execute

    await updateAgentToolCall({
      db,
      id: response.toolCallId,
      runId: run.id,
      state: "running"
    })

    if (!execute) {
      const error = toAgentRuntimeError({
        cause: `Tool is not executable: ${toolName}`,
        code: "tool"
      })
      const errorMessage = getErrorMessage(error)

      await lifecycleHandlers.onToolCallFinish({
        error,
        success: false,
        toolCall
      })
      resultMessages.push({
        content: [
          {
            output: {
              type: "error-text",
              value: errorMessage
            },
            toolCallId: response.toolCallId,
            toolName,
            type: "tool-result"
          }
        ],
        role: "tool"
      })
      continue
    }

    try {
      const outputOrStream = await execute(response.input, {
        abortSignal,
        experimental_context: {
          approvalId: response.approvalId,
          approved: true,
          ...metadata,
          ...(response.reason === undefined ? {} : { reason: response.reason }),
          toolName
        },
        messages: [...messages],
        toolCallId: response.toolCallId
      } satisfies ToolExecutionOptions)
      const output = isAsyncIterable(outputOrStream)
        ? await collectAsyncIterable(outputOrStream)
        : outputOrStream

      await lifecycleHandlers.onToolCallFinish({
        output,
        success: true,
        toolCall
      })
      resultMessages.push({
        content: [
          {
            output: {
              type: "json",
              value: output
            },
            toolCallId: response.toolCallId,
            toolName,
            type: "tool-result"
          }
        ],
        role: "tool"
      })
    } catch (error) {
      const runtimeError = toAgentRuntimeError({
        cause: error,
        code: "tool"
      })
      const errorMessage = getErrorMessage(runtimeError)

      await lifecycleHandlers.onToolCallFinish({
        error: runtimeError,
        success: false,
        toolCall
      })
      resultMessages.push({
        content: [
          {
            output: {
              type: "error-text",
              value: errorMessage
            },
            toolCallId: response.toolCallId,
            toolName,
            type: "tool-result"
          }
        ],
        role: "tool"
      })
    }
  }

  return resultMessages
}

const getMainLoopToolNeedsApproval = async ({
  input,
  messages,
  metadata,
  toolCallId,
  toolName,
  tools
}: {
  input: unknown
  messages: readonly AgentLoopMessage[]
  metadata?: Readonly<Record<string, unknown>>
  toolCallId: string
  toolName: string
  tools: ToolSet
}): Promise<boolean> => {
  const needsApproval = tools[toolName]?.needsApproval

  if (!needsApproval) {
    return false
  }

  if (typeof needsApproval === "boolean") {
    return needsApproval
  }

  return Boolean(
    await needsApproval(input, {
      experimental_context: metadata,
      messages: convertAgentLoopMessagesToModelMessages(messages),
      toolCallId
    })
  )
}

const buildApprovalResponseModelMessages = (
  responseRecords: ToolApprovalResponseRecord[]
): ModelMessage[] =>
  responseRecords
    .filter((response) => !response.approved)
    .map((response) => ({
      content: [
        {
          output: {
            ...(response.reason === undefined
              ? {}
              : { reason: response.reason }),
            type: "execution-denied"
          },
          toolCallId: response.toolCallId,
          toolName: response.toolName ?? "unknown",
          type: "tool-result"
        }
      ],
      role: "tool"
    }))

const getPreparedMessages = ({
  fallbackMessages,
  payload
}: {
  fallbackMessages: ModelMessage[]
  payload: Record<string, unknown>
}): ModelMessage[] =>
  isModelMessageArray(payload.messages) ? payload.messages : fallbackMessages

const getPreparedSystemPrompt = ({
  fallbackSystemPrompt,
  payload
}: {
  fallbackSystemPrompt: string
  payload: Record<string, unknown>
}): string =>
  typeof payload.system === "string" ? payload.system : fallbackSystemPrompt

const normalizeComparableModelMessageValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableModelMessageValue)
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, normalizeComparableModelMessageValue(value[key])])
  )
}

const getComparableModelMessageSignature = (message: ModelMessage): string =>
  JSON.stringify(normalizeComparableModelMessageValue(message))

const mergeResumedModelMessages = ({
  persistedMessages,
  requestMessages
}: {
  persistedMessages: readonly ModelMessage[]
  requestMessages: readonly ModelMessage[]
}): ModelMessage[] => {
  if (persistedMessages.length === 0) {
    return [...requestMessages]
  }

  const seenPersistedMessages = new Set(
    persistedMessages.map(getComparableModelMessageSignature)
  )
  const missingRequestMessages = requestMessages.filter((message) => {
    const signature = getComparableModelMessageSignature(message)

    if (seenPersistedMessages.has(signature)) {
      return false
    }

    seenPersistedMessages.add(signature)

    return true
  })

  return [...persistedMessages, ...missingRequestMessages]
}

const buildQueuedSessionModelMessages = (
  events: readonly AgentEvent[]
): ModelMessage[] =>
  listPendingAgentSessionQueuedMessages(events).map(({ message }) => ({
    content: message,
    role: "user"
  }))

const createRunQueuedMessageDrainer = ({
  db,
  queue,
  run
}: {
  db: AppDatabase
  queue: AgentSessionQueuedMessageQueue
  run: AgentRun
}): (() => Promise<AgentLoopUserMessage[]>) => {
  const consumedMessageIds = new Set<string>()

  return async () => {
    const events = await listAgentEvents({
      db,
      runId: run.id
    })
    const pendingMessages = listPendingAgentSessionQueuedMessages(events)
      .filter(
        (message) =>
          message.queue === queue && !consumedMessageIds.has(message.id)
      )
      .toSorted((left, right) => left.sequence - right.sequence)

    for (const message of pendingMessages) {
      consumedMessageIds.add(message.id)
    }

    return pendingMessages.map((message) => ({
      content: message.message,
      role: "user"
    }))
  }
}

const loadPersistedAgentSessionContext = async ({
  db,
  run
}: {
  db: AppDatabase
  run: AgentRun
}): Promise<PersistedAgentSessionContext> => {
  const events = await listAgentEvents({
    db,
    runId: run.id
  })

  return {
    messages: convertAgentMessagesToLlm(
      buildAgentSessionModelContextFromLatestSavePoint(events)
    ),
    queuedMessages: buildQueuedSessionModelMessages(events)
  }
}

const loadLatestCompletedRunQueuedMessages = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<ModelMessage[]> => {
  const run = await getLatestCompletedAgentRunForSession({
    chatSessionId: sessionId,
    db
  })

  if (!run) {
    return []
  }

  const events = await listAgentEvents({
    db,
    runId: run.id
  })

  return buildQueuedSessionModelMessages(events)
}

const loadAgentRequestModelMessages = async ({
  approvalResumeMatch,
  db,
  messages,
  resumedRun,
  run,
  sessionId
}: {
  approvalResumeMatch: ToolApprovalResumeMatch | null
  db: AppDatabase
  messages: ModelMessage[]
  resumedRun: AgentRun | null
  run: AgentRun
  sessionId: string
}): Promise<AgentRequestModelMessagesContext> => {
  const matchedApprovalIds = new Set(
    (approvalResumeMatch?.responseRecords ?? []).map(
      (response) => response.approvalId
    )
  )
  const approvalFilteredMessages = filterUnmatchedApprovalResumeMessages({
    allowedApprovalIds: matchedApprovalIds,
    messages
  })
  const persistedSessionContext = resumedRun
    ? await loadPersistedAgentSessionContext({
        db,
        run
      })
    : {
        messages: [],
        queuedMessages: []
      }
  const latestCompletedRunQueuedMessages = resumedRun
    ? []
    : await loadLatestCompletedRunQueuedMessages({
        db,
        sessionId
      })

  const modelMessages = mergeResumedModelMessages({
    persistedMessages: persistedSessionContext.messages,
    requestMessages: [
      ...approvalFilteredMessages,
      ...buildApprovalResponseModelMessages(
        approvalResumeMatch?.responseRecords ?? []
      ),
      ...persistedSessionContext.queuedMessages,
      ...latestCompletedRunQueuedMessages
    ]
  })

  return {
    modelMessages: completeUnresolvedToolCallsInModelMessages(modelMessages),
    persistedSessionContext
  }
}

const applyMainProviderResponseHooks = async ({
  finishReason,
  runId,
  status,
  streamHooks,
  usage
}: {
  finishReason: unknown
  runId: string
  status: AgentRunFinishStatus
  streamHooks?: AgentStreamHooks
  usage: unknown
}): Promise<void> => {
  await applyAgentStreamResponseHooks({
    hooks: streamHooks,
    response: {
      finishReason,
      runId,
      status,
      usage
    }
  })
}

const markAgentRunFailed = async ({
  db,
  error,
  run
}: {
  db: AppDatabase
  error: unknown
  run: AgentRun
}): Promise<void> => {
  const errorMessage = getErrorMessage(error)
  const errorCode = error instanceof AgentRuntimeError ? error.code : undefined

  await updateAgentRun({
    db,
    errorMessage,
    id: run.id,
    status: "failed"
  })
  await run.appendEvent({
    payload: {
      ...(errorCode ? { code: errorCode } : {}),
      error: errorMessage
    },
    type: "agent_run_failed"
  })
}

const hasPendingApprovalsForRun = async ({
  db,
  runId,
  sessionId
}: {
  db: AppDatabase
  runId: string
  sessionId: string
}): Promise<boolean> => {
  const approvals = await listPendingAgentApprovals({
    chatSessionId: sessionId,
    db
  })

  return approvals.some((approval) => approval.runId === runId)
}

const findRunForApprovalResponses = async ({
  db,
  sessionId,
  responseRecords
}: {
  db: AppDatabase
  sessionId: string
  responseRecords: ToolApprovalResponseRecord[]
}): Promise<ToolApprovalResumeMatch | null> => {
  let matchedRun: AgentRun | null = null
  let matchedRunToolCalls: Awaited<
    ReturnType<typeof listAgentToolCalls>
  > | null = null
  const matchedResponses: ToolApprovalResponseRecord[] = []

  for (const response of responseRecords) {
    const run = await getAgentRunForToolApproval({
      approvalId: response.approvalId,
      chatSessionId: sessionId,
      db,
      pendingApprovalOnly: true,
      toolCallId: response.toolCallId
    })

    if (!run) {
      continue
    }

    if (!matchedRun) {
      matchedRun = run
    }

    if (run.id === matchedRun.id) {
      if (!response.toolName && !matchedRunToolCalls) {
        matchedRunToolCalls = await listAgentToolCalls({
          db,
          runId: run.id
        })
      }

      const toolName =
        response.toolName ??
        matchedRunToolCalls?.find(
          (toolCall) => toolCall.id === response.toolCallId
        )?.toolName
      const input =
        response.input ??
        matchedRunToolCalls?.find(
          (toolCall) => toolCall.id === response.toolCallId
        )?.input

      matchedResponses.push({
        ...response,
        ...(input === undefined ? {} : { input }),
        ...(toolName ? { toolName } : {})
      })
    }
  }

  return matchedRun
    ? {
        responseRecords: matchedResponses,
        run: matchedRun
      }
    : null
}

const createAgentStepFinishHandler =
  ({
    db,
    run,
    state
  }: {
    db: AppDatabase
    run: AgentRun
    state: AgentRunRuntimeState
  }) =>
  async ({ content }: AgentStepFinishEvent): Promise<void> => {
    for (const part of content) {
      const record = getToolApprovalRequestRecord(part)

      if (!record) {
        continue
      }

      state.hasPendingApproval = true
      await recordAgentToolCall({
        approvalState: "pending",
        db,
        id: record.toolCallId,
        input: record.input,
        runId: run.id,
        state: "approval_requested",
        toolName: record.toolName ?? "unknown"
      })
      await run.appendEvent({
        payload: {
          approvalId: record.approvalId,
          ...(record.input === undefined ? {} : { input: record.input }),
          toolCallId: record.toolCallId,
          ...(record.toolName ? { toolName: record.toolName } : {})
        },
        type: "tool_call_approval_requested"
      })
      await updateAgentRun({
        db,
        id: run.id,
        status: "suspended"
      })
    }
  }

const createAgentToolLifecycleHandlers = ({
  db,
  parentToolCallId = null,
  run
}: {
  db: AppDatabase
  parentToolCallId?: string | null
  run: AgentRun
}): AgentToolLifecycleHandlers => {
  const parentToolPayload = parentToolCallId ? { parentToolCallId } : {}
  const onToolCallStart = async ({
    toolCall
  }: AgentToolCallEvent): Promise<void> => {
    await recordAgentToolCall({
      approvalState: "not_required",
      db,
      id: toolCall.toolCallId,
      input: toolCall.input,
      ...parentToolPayload,
      runId: run.id,
      state: "running",
      toolName: toolCall.toolName
    })
    await run.appendEvent({
      payload: {
        input: toolCall.input,
        ...parentToolPayload,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName
      },
      type: "tool_call_started"
    })
  }

  const onToolCallFinish = async ({
    error,
    output,
    success,
    toolCall
  }: AgentToolCallFinishEvent): Promise<void> => {
    if (success) {
      const artifacts = await recordAgentToolOutputArtifacts({
        db,
        output,
        runId: run.id,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName
      })

      await updateAgentToolCall({
        db,
        id: toolCall.toolCallId,
        output,
        runId: run.id,
        state: "finished"
      })
      await run.appendEvent({
        payload: {
          output,
          ...(artifacts.length > 0
            ? { artifactIds: artifacts.map((artifact) => artifact.id) }
            : {}),
          ...parentToolPayload,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        },
        type: "tool_call_finished"
      })
      return
    }

    const runtimeError = toAgentRuntimeError({
      cause: error,
      code: "tool"
    })
    const errorMessage = getErrorMessage(runtimeError)

    await updateAgentToolCall({
      db,
      errorMessage,
      id: toolCall.toolCallId,
      runId: run.id,
      state: "failed"
    })
    await run.appendEvent({
      payload: {
        code: runtimeError.code,
        error: errorMessage,
        ...parentToolPayload,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName
      },
      type: "tool_call_failed"
    })
  }

  return {
    onToolCallFinish,
    onToolCallStart
  }
}

export const streamAgentChat = async ({
  abortSignal: requestAbortSignal,
  activeToolNames,
  db,
  messages,
  model,
  modelId = null,
  projectPath,
  runtimeState: phaseRuntimeState,
  sessionId,
  settings,
  skillCapabilities,
  streamHooks,
  streamOptions,
  systemPrompts
}: StreamAgentChatOptions): Promise<AgentChatStreamResult> => {
  if (!settings.agents.enabled) {
    return streamText({
      abortSignal: requestAbortSignal,
      ...(systemPrompts.length > 0
        ? { system: systemPrompts.join("\n\n") }
        : {}),
      messages,
      model
    })
  }

  const approvalResponseRecords = collectToolApprovalResponseRecords(messages)
  const approvalResumeMatch = await findRunForApprovalResponses({
    db,
    sessionId,
    responseRecords: approvalResponseRecords
  })
  const resumedRun = approvalResumeMatch?.run ?? null
  const profile = resolveActiveAgentProfile(
    settings.agents,
    resumedRun?.profileId
  )
  const runtimeAgentSettings = {
    ...settings.agents,
    defaultProfileId: profile.id
  }
  const run =
    resumedRun ??
    (await createAgentRun({
      chatSessionId: sessionId,
      db,
      modelId,
      profileId: profile.id
    }))
  const runAbortController = new AbortController()
  const agentAbortSignal = createCombinedAbortSignal([
    requestAbortSignal,
    runAbortController.signal
  ])
  const unregisterActiveAgentRun = registerActiveAgentRun({
    abortController: runAbortController,
    runId: run.id,
    sessionId
  })
  let activeSubagentCount = 0
  const executeDelegation: ExecuteAgentDelegation = async ({
    abortSignal,
    includeApprovalTools = false,
    input,
    parentToolCallId,
    profileId
  }) => {
    const childProfile = resolveActiveAgentProfile(settings.agents, profileId)

    if (childProfile.id !== profileId) {
      return {
        profileId,
        runId: null,
        status: "rejected",
        subRunId: null,
        summary: `Agent profile is unavailable: ${profileId}`,
        truncated: false
      }
    }

    if (activeSubagentCount >= settings.agents.maxConcurrentSubagents) {
      return {
        profileId,
        runId: null,
        status: "rejected",
        subRunId: null,
        summary: "Sub-agent concurrency budget is exhausted.",
        truncated: false
      }
    }

    activeSubagentCount += 1

    const childRun = await createAgentRun({
      chatSessionId: sessionId,
      db,
      modelId,
      parentRunId: run.id,
      profileId: childProfile.id
    })
    const childSettings = {
      ...settings.agents,
      allowSubagentDelegation: false,
      defaultProfileId: childProfile.id,
      maxSteps: Math.min(
        settings.agents.maxSteps,
        childProfile.budgetPolicy.maxSteps
      )
    }
    const childTools = buildAgentTools({
      approvalMode: includeApprovalTools ? "preapproved" : "default",
      chatSessionId: sessionId,
      db,
      eventSink: async (event) => {
        await childRun.appendEvent(event)
      },
      includeApprovalTools,
      memorySettings: settings.memory,
      projectPath,
      settings: childSettings,
      skillCapabilities
    })
    const childToolNames = Object.keys(childTools)
    const childLifecycleHandlers = createAgentToolLifecycleHandlers({
      db,
      parentToolCallId,
      run: childRun
    })

    await run.appendEvent({
      payload: {
        childRunId: childRun.id,
        parentToolCallId,
        profileId: childProfile.id,
        task: input.task
      },
      type: "subagent_started"
    })
    await childRun.appendEvent({
      payload: {
        parentRunId: run.id,
        parentToolCallId,
        profileId: childProfile.id,
        task: input.task,
        toolNames: childToolNames
      },
      type: "agent_run_started"
    })

    try {
      const childMessages: ModelMessage[] = [
        {
          content: buildDelegationPrompt(input),
          role: "user"
        }
      ]
      const childSystemPrompt = [
        childProfile.instructions,
        buildAgentSystemPrompt({
          profileId: childProfile.id,
          toolNames: childToolNames
        })
      ]
        .filter(Boolean)
        .join("\n\n")
      const childTurnState = await createAgentTurnState<
        ModelMessage,
        ToolSet[string]
      >({
        messages: childMessages,
        model: modelId ?? "",
        streamOptions: {
          headers: streamOptions?.headers,
          metadata: {
            ...streamOptions?.metadata,
            parentRunId: run.id,
            parentToolCallId,
            profileId: childProfile.id,
            runId: childRun.id,
            sessionId
          }
        },
        systemPrompt: childSystemPrompt,
        tools: childTools
      })
      const preparedChildProviderRequest = await prepareAgentStreamRequest({
        hooks: streamHooks,
        payload: {
          messages: childTurnState.messages,
          modelId: childTurnState.model,
          parentRunId: run.id,
          parentToolCallId,
          profileId: childProfile.id,
          runId: childRun.id,
          system: childTurnState.systemPrompt,
          toolNames: childToolNames
        },
        requestOptions: {
          headers: {
            ...childTurnState.streamOptions.headers
          },
          metadata: {
            ...childTurnState.streamOptions.metadata
          }
        }
      })
      const childPreparedMessages = getPreparedMessages({
        fallbackMessages: childMessages,
        payload: preparedChildProviderRequest.payload
      })
      const childPreparedSystemPrompt = getPreparedSystemPrompt({
        fallbackSystemPrompt: childSystemPrompt,
        payload: preparedChildProviderRequest.payload
      })

      await appendAgentSessionModelMessageEvents({
        messages: childPreparedMessages,
        run: childRun
      })
      await appendAgentSessionSavePointEvent({
        label: "provider-request-prepared",
        messages: childPreparedMessages,
        run: childRun
      })

      const result = await generateText({
        abortSignal,
        experimental_onToolCallFinish: childLifecycleHandlers.onToolCallFinish,
        experimental_onToolCallStart: childLifecycleHandlers.onToolCallStart,
        experimental_context:
          preparedChildProviderRequest.requestOptions.metadata,
        headers: preparedChildProviderRequest.requestOptions.headers,
        messages: childPreparedMessages,
        model,
        stopWhen: stepCountIs(childSettings.maxSteps),
        system: childPreparedSystemPrompt,
        tools: childTools
      })
      const summary = clampDelegationSummary(
        sanitizeDelegationSummary(result.text)
      )

      await applyAgentStreamResponseHooks({
        hooks: streamHooks,
        response: {
          finishReason: result.finishReason,
          parentRunId: run.id,
          parentToolCallId,
          profileId: childProfile.id,
          runId: childRun.id,
          status: "succeeded",
          usage: result.usage
        }
      })

      await updateAgentRun({
        db,
        id: childRun.id,
        status: "succeeded"
      })
      await childRun.appendEvent({
        payload: {
          finishReason: result.finishReason,
          usage: result.usage
        },
        type: "agent_run_finished"
      })
      await run.appendEvent({
        payload: {
          childRunId: childRun.id,
          parentToolCallId,
          profileId: childProfile.id,
          status: "succeeded"
        },
        type: "subagent_finished"
      })

      return {
        profileId: childProfile.id,
        runId: childRun.id,
        status: "succeeded",
        subRunId: childRun.id,
        ...summary
      }
    } catch (error) {
      const message = getErrorMessage(error)

      await updateAgentRun({
        db,
        errorMessage: message,
        id: childRun.id,
        status: "failed"
      })
      await childRun.appendEvent({
        payload: {
          error: message
        },
        type: "agent_run_failed"
      })
      await run.appendEvent({
        payload: {
          childRunId: childRun.id,
          error: message,
          parentToolCallId,
          profileId: childProfile.id,
          status: "failed"
        },
        type: "subagent_finished"
      })

      return {
        profileId: childProfile.id,
        runId: childRun.id,
        status: "failed",
        subRunId: childRun.id,
        summary: message,
        truncated: false
      }
    } finally {
      activeSubagentCount -= 1
    }
  }
  const agentTools = filterActiveAgentTools({
    activeToolNames,
    tools: buildAgentTools({
      chatSessionId: sessionId,
      db,
      eventSink: async (event) => {
        await run.appendEvent(event)
      },
      executeDelegation,
      memorySettings: settings.memory,
      projectPath,
      settings: runtimeAgentSettings,
      skillCapabilities
    })
  })
  const toolNames = Object.keys(agentTools)
  const { modelMessages, persistedSessionContext } =
    await loadAgentRequestModelMessages({
      approvalResumeMatch,
      db,
      messages,
      resumedRun,
      run,
      sessionId
    })

  await (resumedRun
    ? updateAgentRun({
        db,
        id: run.id,
        status: "running"
      })
    : run.appendEvent({
        payload: {
          profileId: profile.id,
          toolNames
        },
        type: "agent_run_started"
      }))

  await recordToolApprovalResponses({
    db,
    responseRecords: approvalResumeMatch?.responseRecords ?? [],
    run
  })

  if (modelMessages.length === 0) {
    const finishReason: FinishReason = "stop"

    unregisterActiveAgentRun()
    await updateAgentRun({
      db,
      id: run.id,
      status: "succeeded"
    })
    await run.appendEvent({
      payload: {
        finishReason,
        usage: null
      },
      type: "agent_run_finished"
    })
    await applyMainProviderResponseHooks({
      finishReason,
      runId: run.id,
      status: "succeeded",
      streamHooks,
      usage: null
    })

    return createMainLoopStreamResult(
      Promise.resolve({
        finishReason,
        generatedMessages: [],
        status: "succeeded",
        text: ""
      })
    )
  }

  const runtimeState: AgentRunRuntimeState = {
    hasPendingApproval: false
  }

  const lifecycleHandlers = createAgentToolLifecycleHandlers({
    db,
    run
  })
  const onStepFinish = createAgentStepFinishHandler({
    db,
    run,
    state: runtimeState
  })
  const phaseHandle = phaseRuntimeState?.beginPhase("turn")
  const systemPrompt = [
    profile.instructions,
    buildAgentSystemPrompt({
      profileId: profile.id,
      toolNames
    }),
    ...systemPrompts
  ]
    .filter(Boolean)
    .join("\n\n")
  const preparedProviderRequest = await (async () => {
    try {
      const turnState = await createAgentTurnState<
        ModelMessage,
        ToolSet[string]
      >({
        messages: modelMessages,
        model: modelId ?? "",
        streamOptions: {
          headers: streamOptions?.headers,
          metadata: {
            ...streamOptions?.metadata,
            profileId: profile.id,
            runId: run.id,
            sessionId
          }
        },
        systemPrompt,
        tools: agentTools
      })

      return await prepareAgentStreamRequest({
        hooks: streamHooks,
        payload: {
          messages: turnState.messages,
          modelId: turnState.model,
          profileId: profile.id,
          runId: run.id,
          system: turnState.systemPrompt,
          toolNames
        },
        requestOptions: {
          headers: {
            ...turnState.streamOptions.headers
          },
          metadata: {
            ...turnState.streamOptions.metadata
          }
        }
      })
    } catch (error) {
      await markAgentRunFailed({
        db,
        error,
        run
      })
      phaseHandle?.end()
      unregisterActiveAgentRun()
      throw error
    }
  })()
  const preparedMessages = getPreparedMessages({
    fallbackMessages: modelMessages,
    payload: preparedProviderRequest.payload
  })
  const preparedSystemPrompt = getPreparedSystemPrompt({
    fallbackSystemPrompt: systemPrompt,
    payload: preparedProviderRequest.payload
  })
  const liveStream = createAgentUiStreamBridge()
  const liveSink = createAgentUiLiveSink(liveStream)

  const execution = (async (): Promise<MainAgentLoopExecutionResult> => {
    try {
      await appendAgentSessionModelMessageEvents({
        existingMessages: persistedSessionContext.messages,
        messages: preparedMessages,
        run
      })
      await appendAgentSessionSavePointEvent({
        label: "provider-request-prepared",
        messages: preparedMessages,
        run
      })

      const approvedToolResultMessages =
        await executeApprovedToolApprovalResponses({
          abortSignal: agentAbortSignal,
          agentTools,
          db,
          lifecycleHandlers,
          messages: preparedMessages,
          metadata: preparedProviderRequest.requestOptions.metadata,
          responseRecords: approvalResumeMatch?.responseRecords ?? [],
          run
        })

      for (const message of approvedToolResultMessages) {
        writeToolMessageToLiveSink({
          liveSink,
          message
        })
      }

      const initialModelMessages = [
        ...preparedMessages,
        ...approvedToolResultMessages
      ]
      const initialLoopMessages =
        convertModelMessagesToAgentLoopMessages(initialModelMessages)
      const pendingApprovalRequests: PendingLoopApprovalRequest[] = []
      const loopModel = createAiSdkAgentLoopModel({
        headers: preparedProviderRequest.requestOptions.headers,
        metadata: preparedProviderRequest.requestOptions.metadata,
        mode: "stream",
        model,
        streamCallbacks: {
          onFinish: liveSink.finishText,
          onTextDelta: liveSink.writeTextDelta,
          onToolCall: liveSink.writeToolCall
        },
        system: preparedSystemPrompt,
        tools: agentTools
      })
      const drainQueuedFollowUpMessages = createRunQueuedMessageDrainer({
        db,
        queue: "follow-up",
        run
      })
      const drainQueuedSteeringMessages = createRunQueuedMessageDrainer({
        db,
        queue: "steer",
        run
      })
      const loopResult = await runAgentLoop({
        abortSignal: agentAbortSignal,
        activeToolNames: toolNames,
        afterToolCall: async (result: AgentLoopExecutedToolResult) => {
          const toolError = result.isError
            ? toAgentRuntimeError({
                cause: result.output,
                code: "tool"
              })
            : null

          await lifecycleHandlers.onToolCallFinish({
            ...(toolError ? { error: toolError } : { output: result.output }),
            success: !result.isError,
            toolCall: result.toolCall
          })
          liveSink.writeToolResult({
            isError: result.isError,
            output: result.output,
            toolCall: result.toolCall
          })

          return {}
        },
        beforeToolCall: async (toolCall, context) => {
          if (
            await getMainLoopToolNeedsApproval({
              input: toolCall.input,
              messages: context.messages,
              metadata: preparedProviderRequest.requestOptions.metadata,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              tools: agentTools
            })
          ) {
            const approvalId = `tool-approval-${randomUUID()}`

            pendingApprovalRequests.push({
              approvalId,
              toolCall
            })
            liveSink.writeApprovalRequest({
              approvalId,
              toolCall
            })
            await onStepFinish({
              content: [
                {
                  approvalId,
                  input: toolCall.input,
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  type: "tool-approval-request"
                }
              ]
            })

            return {
              reason: `${toolCall.toolName} requires approval before execution.`,
              suspend: true
            }
          }

          await lifecycleHandlers.onToolCallStart({
            toolCall
          })

          return {}
        },
        getFollowUpMessages: drainQueuedFollowUpMessages,
        getSteeringMessages: drainQueuedSteeringMessages,
        maxTurns: settings.agents.maxSteps,
        messages: initialLoopMessages,
        model: loopModel,
        onEvent: async (event) => {
          await run.appendEvent({
            payload: {
              event
            },
            type: "agent_loop_event"
          })
        },
        toolRetry: createAgentLoopToolRetryPolicy(settings.agents.retry),
        tools: createAiSdkAgentLoopTools({
          metadata: preparedProviderRequest.requestOptions.metadata,
          tools: agentTools
        })
      })
      const loopResponseMessages = loopResult.messages.slice(
        initialLoopMessages.length
      )
      const providerResponseMessages = injectApprovalRequestsIntoModelMessages({
        approvalRequests: pendingApprovalRequests,
        messages: convertAgentLoopMessagesToModelMessages(loopResponseMessages)
      })
      const generatedMessages = stripPlanProgressFromModelMessages({
        executionMode: profile.executionMode,
        messages: [...approvedToolResultMessages, ...providerResponseMessages]
      })
      const providerResponseText = getProviderResponseText({
        event: {},
        messages: providerResponseMessages
      })
      const finishReason = toMainLoopFinishReason(loopResult.stopReason)
      const hasPendingApproval =
        runtimeState.hasPendingApproval ||
        (await hasPendingApprovalsForRun({
          db,
          runId: run.id,
          sessionId
        }))
      const status = hasPendingApproval
        ? "suspended"
        : toMainLoopRunStatus(loopResult.stopReason)
      const failureMessage = getMainLoopFailureMessage(loopResult.stopReason)

      await appendAgentSessionModelMessageEvents({
        messages: generatedMessages,
        run
      })
      await appendPlanModeSessionEvents({
        executionMode: profile.executionMode,
        responseText: providerResponseText,
        run
      })
      await appendAgentSessionSavePointEvent({
        label: "provider-response-committed",
        messages: [...preparedMessages, ...generatedMessages],
        run
      })
      await updateAgentRun({
        db,
        ...(failureMessage ? { errorMessage: failureMessage } : {}),
        id: run.id,
        status
      })
      await (status === "failed"
        ? run.appendEvent({
            payload: {
              error: failureMessage ?? "Agent run failed."
            },
            type: "agent_run_failed"
          })
        : run.appendEvent({
            payload: {
              finishReason,
              ...(status === "suspended" ? { status } : {}),
              usage: null
            },
            type: "agent_run_finished"
          }))
      await applyMainProviderResponseHooks({
        finishReason,
        runId: run.id,
        status,
        streamHooks,
        usage: null
      })

      return {
        finishReason,
        generatedMessages,
        status,
        text: providerResponseText
      }
    } catch (error) {
      const runtimeError = toAgentRuntimeError({
        cause: error,
        code: "provider",
        message: "Agent provider stream failed."
      })

      await markAgentRunFailed({
        db,
        error: runtimeError,
        run
      })
      throw runtimeError
    } finally {
      phaseHandle?.end()
      liveSink.finishText()
      unregisterActiveAgentRun()
    }
  })()

  return createMainLoopStreamResult(execution, liveStream)
}
