import type { AppSettings } from "@etyon/rpc"
import type { LanguageModel, ModelMessage, ToolSet } from "ai"
import { generateText, stepCountIs, streamText } from "ai"

import { AgentRuntimeError } from "@/main/agents/agent-errors"
import type { AgentRuntimeErrorCode } from "@/main/agents/agent-errors"
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
import {
  completeUnresolvedToolCallsInModelMessages,
  convertAgentMessagesToLlm
} from "@/main/agents/agent-messages"
import {
  parseStructuredPlanFromText,
  stripPlanProgressMarkers,
  summarizePlanProgress
} from "@/main/agents/agent-plan-progress"
import {
  appendAgentSessionPlanModeEvent,
  appendAgentSessionModelMessageEvents,
  buildAgentSessionTreeFromEvents,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"
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

type AgentRunFinishStatus = "succeeded" | "suspended"

const DELEGATION_SUMMARY_MAX_CHARS = 6_000
const ANT_THINKING_BLOCK_PATTERN = /<antThinking>[\s\S]*?<\/antThinking>/gu
const COMMAND_TRANSCRIPT_BLOCK_PATTERN =
  /(?:^|\n)Executed in [^\n]*(?:\r?\n)(?:bash|fish|sh|zsh)(?:\r?\n)[\s\S]*?(?:\r?\n)-?\d+(?=\r?\n|$)/gu
const EXCESS_BLANK_LINES_PATTERN = /\n{3,}/gu
const FUNCTION_CALLS_BLOCK_PATTERN =
  /<function_calls>[\s\S]*?<\/function_calls>/gu
const MODEL_MESSAGE_ROLES = new Set(["assistant", "system", "tool", "user"])

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

const buildAgentSystemPrompt = ({
  profileId,
  toolNames
}: {
  profileId: string
  toolNames: string[]
}): string =>
  [
    `Active agent profile: ${profileId}.`,
    `Available agent tools: ${toolNames.length > 0 ? toolNames.join(", ") : "none"}.`,
    "Use tools only when they reduce uncertainty. Keep the final response concise and grounded in tool results."
  ].join("\n")

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toAgentRuntimeError = ({
  cause,
  code,
  message
}: {
  cause: unknown
  code: AgentRuntimeErrorCode
  message: string
}): AgentRuntimeError => {
  if (cause instanceof AgentRuntimeError) {
    return cause
  }

  return new AgentRuntimeError(code, message, {
    cause
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isModelMessage = (value: unknown): value is ModelMessage =>
  isRecord(value) &&
  "content" in value &&
  typeof value.role === "string" &&
  MODEL_MESSAGE_ROLES.has(value.role)

const isModelMessageArray = (value: unknown): value is ModelMessage[] =>
  Array.isArray(value) && value.every(isModelMessage)

const getProviderResponseModelMessages = (event: unknown): ModelMessage[] => {
  if (!isRecord(event)) {
    return []
  }

  if (isRecord(event.response) && Array.isArray(event.response.messages)) {
    return event.response.messages.filter(isModelMessage)
  }

  if (typeof event.text === "string" && event.text.length > 0) {
    return [
      {
        content: event.text,
        role: "assistant"
      }
    ]
  }

  return []
}

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
      buildAgentSessionTreeFromEvents(events).buildContext()
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

  await updateAgentRun({
    db,
    errorMessage,
    id: run.id,
    status: "failed"
  })
  await run.appendEvent({
    payload: {
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

      matchedResponses.push({
        ...response,
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
          ...parentToolPayload,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        },
        type: "tool_call_finished"
      })
      return
    }

    await updateAgentToolCall({
      db,
      errorMessage: getErrorMessage(error),
      id: toolCall.toolCallId,
      runId: run.id,
      state: "failed"
    })
    await run.appendEvent({
      payload: {
        error: getErrorMessage(error),
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
}: StreamAgentChatOptions): Promise<ReturnType<typeof streamText>> => {
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

  try {
    await appendAgentSessionModelMessageEvents({
      existingMessages: persistedSessionContext.messages,
      messages: preparedMessages,
      run
    })

    try {
      return streamText({
        abortSignal: requestAbortSignal,
        experimental_onToolCallFinish: lifecycleHandlers.onToolCallFinish,
        experimental_onToolCallStart: lifecycleHandlers.onToolCallStart,
        experimental_context: preparedProviderRequest.requestOptions.metadata,
        headers: preparedProviderRequest.requestOptions.headers,
        messages: preparedMessages,
        model,
        onError: async ({ error }) => {
          try {
            await markAgentRunFailed({
              db,
              error,
              run
            })
          } finally {
            phaseHandle?.end()
          }
        },
        onFinish: async (event) => {
          const { finishReason, usage } = event

          try {
            const providerResponseMessages =
              getProviderResponseModelMessages(event)
            const providerResponseText = getProviderResponseText({
              event,
              messages: providerResponseMessages
            })

            await appendAgentSessionModelMessageEvents({
              messages: stripPlanProgressFromModelMessages({
                executionMode: profile.executionMode,
                messages: providerResponseMessages
              }),
              run
            })
            await appendPlanModeSessionEvents({
              executionMode: profile.executionMode,
              responseText: providerResponseText,
              run
            })

            if (
              runtimeState.hasPendingApproval ||
              (await hasPendingApprovalsForRun({
                db,
                runId: run.id,
                sessionId
              }))
            ) {
              await updateAgentRun({
                db,
                id: run.id,
                status: "suspended"
              })
              await run.appendEvent({
                payload: {
                  finishReason,
                  status: "suspended",
                  usage
                },
                type: "agent_run_finished"
              })
              await applyMainProviderResponseHooks({
                finishReason,
                runId: run.id,
                status: "suspended",
                streamHooks,
                usage
              })
              return
            }

            await updateAgentRun({
              db,
              id: run.id,
              status: "succeeded"
            })
            await run.appendEvent({
              payload: {
                finishReason,
                usage
              },
              type: "agent_run_finished"
            })
            await applyMainProviderResponseHooks({
              finishReason,
              runId: run.id,
              status: "succeeded",
              streamHooks,
              usage
            })
          } finally {
            phaseHandle?.end()
          }
        },
        onStepFinish,
        stopWhen: stepCountIs(settings.agents.maxSteps),
        system: preparedSystemPrompt,
        tools: agentTools
      })
    } catch (error) {
      throw toAgentRuntimeError({
        cause: error,
        code: "provider",
        message: "Agent provider stream failed."
      })
    }
  } catch (error) {
    await markAgentRunFailed({
      db,
      error,
      run
    })
    phaseHandle?.end()
    throw error
  }
}
