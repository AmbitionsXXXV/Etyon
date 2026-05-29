import type { AgentSettings } from "@etyon/rpc"

import { createAgentExecutionEnv } from "@/main/agents/execution-env"
import type {
  AgentExecutionEnv,
  AgentFileSystem
} from "@/main/agents/execution-env"
import { createAgentLspManager } from "@/main/agents/lsp-manager"
import type { AgentLspEvent, AgentLspManager } from "@/main/agents/lsp-manager"
import type { WorkspaceSandbox } from "@/main/agents/workspace-sandbox"

export interface AgentSandboxEvent {
  payload: unknown
  type:
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
  eventSink?: (event: AgentWorkspaceEvent) => Promise<void> | void
  projectPath: string
  settings: AgentSettings
}

export const createAgentWorkspace = ({
  eventSink,
  projectPath,
  settings
}: CreateAgentWorkspaceOptions): AgentWorkspace => {
  const executionEnv = createAgentExecutionEnv({
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
