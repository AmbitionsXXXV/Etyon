import fsPromises from "node:fs/promises"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { asc, eq } from "drizzle-orm"

import type { AgentEvent } from "@/main/agents/agent-event-store"
import {
  listAgentEvents,
  subscribeAgentEvents
} from "@/main/agents/agent-event-store"
import { streamAgentChat } from "@/main/agents/agent-runtime"
import type { StreamAgentChatOptions } from "@/main/agents/agent-runtime"
import { createChatSession } from "@/main/chat-sessions"
import type { AppDatabase } from "@/main/db"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentRuns } from "@/main/db/schema"

import { createFauxProvider } from "./faux-provider"
import type { FauxProvider } from "./faux-provider"

export interface AgentRuntimeHarness {
  db: AppDatabase
  faux: FauxProvider
  listEvents: () => Promise<AgentEvent[]>
  modelId: string
  projectPath: string
  rootPath: string
  session: Awaited<ReturnType<typeof createChatSession>>
  settings: StreamAgentChatOptions["settings"]
  stream: (
    options?: AgentRuntimeHarnessStreamOptions
  ) => ReturnType<typeof streamAgentChat>
  subscribeEvents: (listener: (event: AgentEvent) => void) => () => void
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
  messages?: ModelMessage[]
  settings?: StreamAgentChatOptions["settings"]
  skillCapabilities?: readonly string[]
  streamHooks?: StreamAgentChatOptions["streamHooks"]
  streamOptions?: StreamAgentChatOptions["streamOptions"]
  systemPrompts?: string[]
}

const DEFAULT_MODEL_ID = "mock-model"

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

  const session = await createChatSession({
    db,
    projectPath: resolvedProjectPath
  })
  const faux = createFauxProvider({ modelId })

  return {
    db,
    faux,
    listEvents: () =>
      listHarnessEvents({
        db,
        sessionId: session.id
      }),
    modelId,
    projectPath: resolvedProjectPath,
    rootPath,
    session,
    settings,
    subscribeEvents: (listener) =>
      subscribeHarnessEvents({
        listener,
        sessionId: session.id
      }),
    stream: ({
      abortSignal,
      activeToolNames,
      messages = [],
      settings: streamSettings = settings,
      skillCapabilities,
      streamHooks,
      streamOptions,
      systemPrompts = []
    } = {}) =>
      streamAgentChat({
        abortSignal,
        activeToolNames,
        db,
        messages,
        model: faux.model,
        modelId,
        projectPath: resolvedProjectPath,
        sessionId: session.id,
        settings: streamSettings,
        skillCapabilities,
        streamHooks,
        streamOptions,
        systemPrompts
      })
  }
}
