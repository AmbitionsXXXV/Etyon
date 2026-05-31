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
const backgroundProcessCleanups = new Map<string, () => Promise<void>>()
const lspManagers = new Map<string, AgentLspManager>()
const lspEventSinks = new Map<
  string,
  ((event: AgentWorkspaceEvent) => Promise<void> | void) | undefined
>()

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

const getAgentWorkspaceLspManagerKey = ({
  chatSessionId,
  projectPath,
  settings
}: {
  chatSessionId?: string
  projectPath: string
  settings: AgentSettings
}): string =>
  [
    getBackgroundProcessStoreKey({
      chatSessionId,
      projectPath
    }),
    JSON.stringify({
      lsp: settings.lsp,
      sandbox: settings.sandbox
    })
  ].join("\0")

const getAgentWorkspaceLspManager = ({
  chatSessionId,
  eventSink,
  executionEnv,
  settings
}: {
  chatSessionId?: string
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  executionEnv: AgentExecutionEnv
  settings: AgentSettings
}): AgentLspManager | null => {
  if (!settings.lsp.enabled) {
    return null
  }

  const key = getAgentWorkspaceLspManagerKey({
    chatSessionId,
    projectPath: executionEnv.projectPath,
    settings
  })
  const existingManager = lspManagers.get(key)

  lspEventSinks.set(key, eventSink)

  if (existingManager) {
    return existingManager
  }

  const manager = createAgentLspManager({
    eventSink: (event) => lspEventSinks.get(key)?.(event),
    fileSystem: executionEnv.fileSystem,
    projectPath: executionEnv.projectPath,
    sandbox: executionEnv.sandbox,
    settings: settings.lsp
  })

  lspManagers.set(key, manager)

  return manager
}

export const cleanupAgentWorkspaceResources = async (): Promise<void> => {
  const cleanupResults = await Promise.allSettled([
    ...Array.from(backgroundProcessCleanups.values(), (cleanup) => cleanup()),
    ...Array.from(lspManagers.values(), (manager) => manager.cleanup())
  ])

  backgroundProcessCleanups.clear()
  backgroundProcessStores.clear()
  lspEventSinks.clear()
  lspManagers.clear()

  for (const result of cleanupResults) {
    if (result.status === "rejected") {
      throw result.reason
    }
  }
}

export const createAgentWorkspace = ({
  chatSessionId,
  eventSink,
  projectPath,
  settings
}: CreateAgentWorkspaceOptions): AgentWorkspace => {
  const backgroundProcessStoreKey = getBackgroundProcessStoreKey({
    chatSessionId,
    projectPath
  })
  const executionEnv = createAgentExecutionEnv({
    backgroundProcessStore: getAgentWorkspaceBackgroundProcessStore({
      chatSessionId,
      projectPath
    }),
    projectPath,
    sandboxSettings: settings.sandbox
  })

  backgroundProcessCleanups.set(
    backgroundProcessStoreKey,
    executionEnv.backgroundProcesses.cleanup
  )

  const lsp = getAgentWorkspaceLspManager({
    chatSessionId,
    eventSink,
    executionEnv,
    settings
  })

  return {
    ...(eventSink ? { eventSink } : {}),
    executionEnv,
    fileSystem: executionEnv.fileSystem,
    lsp,
    projectPath: executionEnv.projectPath,
    sandbox: executionEnv.sandbox
  }
}
