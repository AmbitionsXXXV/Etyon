import path from "node:path"

import type { AgentSettings } from "@etyon/rpc"

import {
  createAgentBackgroundProcessStore,
  createAgentExecutionEnv
} from "@/main/agents/execution-env"
import type {
  AgentBackgroundProcessStore,
  AgentExecutionEnv,
  AgentFileSystem
} from "@/main/agents/execution-env"
import { createAgentLspManager } from "@/main/agents/lsp-manager"
import type { AgentLspEvent, AgentLspManager } from "@/main/agents/lsp-manager"
import type { WorkspaceSandbox } from "@/main/agents/workspace-sandbox"

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

export interface AgentWorkspace {
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  executionEnv: AgentExecutionEnv
  fileSystem: AgentFileSystem
  lsp: AgentLspManager | null
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

const getBackgroundProcessStoreKey = ({
  chatSessionId,
  projectPath
}: {
  chatSessionId?: string
  projectPath: string
}): string => `${path.resolve(projectPath)}\0${chatSessionId ?? ""}`

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

export const createAgentWorkspace = ({
  chatSessionId,
  eventSink,
  projectPath,
  settings
}: CreateAgentWorkspaceOptions): AgentWorkspace => {
  const executionEnv = createAgentExecutionEnv({
    backgroundProcessStore: getAgentWorkspaceBackgroundProcessStore({
      chatSessionId,
      projectPath
    }),
    projectPath,
    sandboxSettings: settings.sandbox
  })
  const lsp = settings.lsp.enabled
    ? createAgentLspManager({
        eventSink: eventSink ? (event) => eventSink(event) : undefined,
        fileSystem: executionEnv.fileSystem,
        projectPath: executionEnv.projectPath,
        sandbox: executionEnv.sandbox,
        settings: settings.lsp
      })
    : null

  return {
    ...(eventSink ? { eventSink } : {}),
    executionEnv,
    fileSystem: executionEnv.fileSystem,
    lsp,
    projectPath: executionEnv.projectPath,
    sandbox: executionEnv.sandbox
  }
}
