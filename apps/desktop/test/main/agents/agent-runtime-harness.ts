import fsPromises from "node:fs/promises"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { asc, eq } from "drizzle-orm"

import {
  createAgentRun,
  listAgentEvents,
  listPendingAgentApprovals,
  listAgentToolCalls,
  recordAgentToolCall,
  subscribeAgentEvents,
  updateAgentRun
} from "@/main/agents/agent-event-store"
import type { AgentModelMessage } from "@/main/agents/agent-messages"
import { streamAgentChat } from "@/main/agents/agent-runtime"
import type { StreamAgentChatOptions } from "@/main/agents/agent-runtime"
import type { AgentProfileId, AgentToolName } from "@/main/agents/types"
import { createChatSession } from "@/main/chat-sessions"
import type { AppDatabase } from "@/main/db"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentRuns } from "@/main/db/schema"

import { createFauxProvider } from "./faux-provider"
import type { FauxProvider } from "./faux-provider"

type AgentEvent = Awaited<ReturnType<typeof listAgentEvents>>[number]
type AgentPendingApproval = Awaited<
  ReturnType<typeof listPendingAgentApprovals>
>[number]
type AgentRun = Awaited<ReturnType<typeof createAgentRun>>
type AgentToolCall = Awaited<ReturnType<typeof listAgentToolCalls>>[number]

export type AgentRuntimeHarnessSession = Awaited<
  ReturnType<typeof createChatSession>
> & {
  listEvents: () => Promise<AgentEvent[]>
  listModelMessages: () => Promise<AgentModelMessage[]>
  listPendingApprovals: () => Promise<AgentPendingApproval[]>
  listRuns: () => Promise<AgentRuntimeHarnessRunSummary[]>
  listToolCalls: () => Promise<AgentToolCall[]>
  suspendForToolApproval: (
    options: AgentRuntimeHarnessSuspendToolApprovalOptions
  ) => Promise<AgentRuntimeHarnessSuspendedToolApproval>
  subscribe: (listener: (event: AgentEvent) => void) => () => void
}

export interface AgentRuntimeHarnessApprovalMessagesOptions {
  approved: boolean
  reason?: string
}

export interface AgentRuntimeHarnessSuspendToolApprovalOptions {
  approvalId?: string
  input?: unknown
  profileId?: AgentProfileId
  toolCallId?: string
  toolName: AgentToolName
}

export interface AgentRuntimeHarnessSuspendedToolApproval {
  approvalId: string
  run: AgentRun
  toModelMessages: (
    options: AgentRuntimeHarnessApprovalMessagesOptions
  ) => ModelMessage[]
  toolCallId: string
}

export interface AgentRuntimeHarness {
  db: AppDatabase
  faux: FauxProvider
  listEvents: () => Promise<AgentEvent[]>
  modelId: string
  projectPath: string
  rootPath: string
  session: AgentRuntimeHarnessSession
  settings: StreamAgentChatOptions["settings"]
  stream: (
    options?: AgentRuntimeHarnessStreamOptions
  ) => ReturnType<typeof streamAgentChat>
  subscribeEvents: (listener: (event: AgentEvent) => void) => () => void
}

export interface AgentRuntimeHarnessRunSummary {
  chatSessionId: string
  errorMessage: string | null
  finishedAt: string | null
  id: string
  modelId: string | null
  parentRunId: string | null
  profileId: string
  startedAt: string
  status: AgentRun["status"]
}

export interface AgentRuntimeHarnessOptions {
  modelId?: string
  projectPath?: string
  rootPath: string
  settings?: StreamAgentChatOptions["settings"]
}

export interface AgentRuntimeHarnessStreamOptions {
  abortSignal?: AbortSignal
  activeToolNames?: readonly string[]
  chatLifecycleBranch?: StreamAgentChatOptions["chatLifecycleBranch"]
  extensionRunner?: StreamAgentChatOptions["extensionRunner"]
  messages?: ModelMessage[]
  runtimeState?: StreamAgentChatOptions["runtimeState"]
  settings?: StreamAgentChatOptions["settings"]
  skillCapabilities?: readonly string[]
  streamHooks?: StreamAgentChatOptions["streamHooks"]
  streamOptions?: StreamAgentChatOptions["streamOptions"]
  systemPrompts?: string[]
  toolPackages?: StreamAgentChatOptions["toolPackages"]
}

const DEFAULT_MODEL_ID = "mock-model"
const MODEL_MESSAGE_ROLES = new Set(["assistant", "system", "tool", "user"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isAgentModelMessage = (value: unknown): value is AgentModelMessage => {
  if (!isRecord(value)) {
    return false
  }

  return (
    "content" in value &&
    typeof value.role === "string" &&
    MODEL_MESSAGE_ROLES.has(value.role) &&
    value.type === "model"
  )
}

const getModelMessageFromSessionEvent = (
  event: AgentEvent
): AgentModelMessage | null => {
  const { payload } = event

  if (!isRecord(payload) || payload.action !== "appendMessage") {
    return null
  }

  return isAgentModelMessage(payload.message) ? payload.message : null
}

const listHarnessEvents = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<AgentEvent[]> => {
  const runs = await db
    .select({
      id: agentRuns.id
    })
    .from(agentRuns)
    .where(eq(agentRuns.chatSessionId, sessionId))
    .orderBy(asc(agentRuns.startedAt))
  const eventsByRun = await Promise.all(
    runs.map((run) =>
      listAgentEvents({
        db,
        runId: run.id
      })
    )
  )

  return eventsByRun.flat()
}

const listHarnessModelMessages = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<AgentModelMessage[]> => {
  const events = await listHarnessEvents({ db, sessionId })
  const messages: AgentModelMessage[] = []

  for (const event of events) {
    const message = getModelMessageFromSessionEvent(event)

    if (message) {
      messages.push(message)
    }
  }

  return messages
}

const listHarnessToolCalls = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<AgentToolCall[]> => {
  const runs = await db
    .select({
      id: agentRuns.id
    })
    .from(agentRuns)
    .where(eq(agentRuns.chatSessionId, sessionId))
    .orderBy(asc(agentRuns.startedAt))
  const toolCallsByRun = await Promise.all(
    runs.map((run) =>
      listAgentToolCalls({
        db,
        runId: run.id
      })
    )
  )

  return toolCallsByRun.flat()
}

const listHarnessRuns = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}): Promise<AgentRuntimeHarnessRunSummary[]> => {
  const runs = await db
    .select({
      chatSessionId: agentRuns.chatSessionId,
      errorMessage: agentRuns.errorMessage,
      finishedAt: agentRuns.finishedAt,
      id: agentRuns.id,
      modelId: agentRuns.modelId,
      parentRunId: agentRuns.parentRunId,
      profileId: agentRuns.profileId,
      startedAt: agentRuns.startedAt,
      status: agentRuns.status
    })
    .from(agentRuns)
    .where(eq(agentRuns.chatSessionId, sessionId))
    .orderBy(asc(agentRuns.startedAt))

  return runs
}

const subscribeHarnessEvents = ({
  listener,
  sessionId
}: {
  listener: (event: AgentEvent) => void
  sessionId: string
}): (() => void) =>
  subscribeAgentEvents((event) => {
    if (event.chatSessionId === sessionId) {
      listener(event)
    }
  })

export const createAgentRuntimeHarness = async ({
  modelId = DEFAULT_MODEL_ID,
  projectPath,
  rootPath,
  settings = AppSettingsSchema.parse({
    agents: {
      enabled: true
    }
  })
}: AgentRuntimeHarnessOptions): Promise<AgentRuntimeHarness> => {
  await ensureDatabaseReady()

  const db = getDb()
  const resolvedProjectPath = path.resolve(
    projectPath ?? path.join(rootPath, "project")
  )

  await fsPromises.mkdir(resolvedProjectPath, { recursive: true })

  const baseSession = await createChatSession({
    db,
    projectPath: resolvedProjectPath
  })
  const faux = createFauxProvider({ modelId })
  const listEvents = (): Promise<AgentEvent[]> =>
    listHarnessEvents({
      db,
      sessionId: baseSession.id
    })
  const listModelMessages = (): Promise<AgentModelMessage[]> =>
    listHarnessModelMessages({
      db,
      sessionId: baseSession.id
    })
  const listPendingApprovals = (): Promise<AgentPendingApproval[]> =>
    listPendingAgentApprovals({
      chatSessionId: baseSession.id,
      db
    })
  const listRuns = (): Promise<AgentRuntimeHarnessRunSummary[]> =>
    listHarnessRuns({
      db,
      sessionId: baseSession.id
    })
  const listToolCalls = (): Promise<AgentToolCall[]> =>
    listHarnessToolCalls({
      db,
      sessionId: baseSession.id
    })
  const subscribe = (listener: (event: AgentEvent) => void): (() => void) =>
    subscribeHarnessEvents({
      listener,
      sessionId: baseSession.id
    })
  const suspendForToolApproval = async ({
    approvalId = "approval-1",
    input = {},
    profileId = "coder",
    toolCallId = "tool-call-1",
    toolName
  }: AgentRuntimeHarnessSuspendToolApprovalOptions): Promise<AgentRuntimeHarnessSuspendedToolApproval> => {
    const run = await createAgentRun({
      chatSessionId: baseSession.id,
      db,
      modelId,
      profileId
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db,
      id: toolCallId,
      input,
      runId: run.id,
      state: "approval_requested",
      toolName
    })
    await run.appendEvent({
      payload: {
        approvalId,
        toolCallId
      },
      type: "tool_call_approval_requested"
    })

    const suspendedRun = await updateAgentRun({
      db,
      id: run.id,
      status: "suspended"
    })

    return {
      approvalId,
      run: suspendedRun,
      toModelMessages: ({ approved, reason }) =>
        [
          {
            content: [
              {
                input,
                toolCallId,
                toolName,
                type: "tool-call"
              },
              {
                approvalId,
                toolCallId,
                type: "tool-approval-request"
              }
            ],
            role: "assistant"
          },
          {
            content: [
              {
                approvalId,
                approved,
                ...(reason === undefined ? {} : { reason }),
                type: "tool-approval-response"
              }
            ],
            role: "tool"
          }
        ] satisfies ModelMessage[],
      toolCallId
    }
  }
  const session: AgentRuntimeHarnessSession = {
    ...baseSession,
    listEvents,
    listModelMessages,
    listPendingApprovals,
    listRuns,
    listToolCalls,
    suspendForToolApproval,
    subscribe
  }

  return {
    db,
    faux,
    listEvents,
    modelId,
    projectPath: resolvedProjectPath,
    rootPath,
    session,
    settings,
    subscribeEvents: subscribe,
    stream: ({
      abortSignal,
      activeToolNames,
      chatLifecycleBranch,
      extensionRunner,
      messages = [],
      runtimeState,
      settings: streamSettings = settings,
      skillCapabilities,
      streamHooks,
      streamOptions,
      systemPrompts = [],
      toolPackages
    } = {}) =>
      streamAgentChat({
        abortSignal,
        activeToolNames,
        chatLifecycleBranch,
        db,
        extensionRunner,
        messages,
        model: faux.model,
        modelId,
        projectPath: resolvedProjectPath,
        runtimeState,
        sessionId: session.id,
        settings: streamSettings,
        skillCapabilities,
        streamHooks,
        streamOptions,
        systemPrompts,
        toolPackages
      })
  }
}
