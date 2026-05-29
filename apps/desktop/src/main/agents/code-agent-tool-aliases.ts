import type { AgentToolName } from "@/main/agents/types"

export const CODE_AGENT_TOOL_ALIASES = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write"
] as const satisfies readonly AgentToolName[]

export type CodeAgentToolAlias = (typeof CODE_AGENT_TOOL_ALIASES)[number]

export const CODE_AGENT_LSP_TOOL_ALIASES = [
  "inspect"
] as const satisfies readonly AgentToolName[]

export type CodeAgentLspToolAlias = (typeof CODE_AGENT_LSP_TOOL_ALIASES)[number]

export type CodeAgentModelFacingToolAlias =
  | CodeAgentLspToolAlias
  | CodeAgentToolAlias

export const CODE_AGENT_READONLY_TOOL_ALIASES = [
  "read",
  "grep",
  "find",
  "ls"
] as const satisfies readonly CodeAgentToolAlias[]

export interface CodeAgentWorkspaceToolAlias {
  etyonName: string
  etyonWorkspaceTool: string
}

export const ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES = {
  bash: {
    etyonName: "execute_command",
    etyonWorkspaceTool: "etyon_workspace_execute_command"
  },
  edit: {
    etyonName: "string_replace_lsp",
    etyonWorkspaceTool: "etyon_workspace_edit_file"
  },
  find: {
    etyonName: "find_files",
    etyonWorkspaceTool: "etyon_workspace_list_files"
  },
  grep: {
    etyonName: "search_content",
    etyonWorkspaceTool: "etyon_workspace_grep"
  },
  inspect: {
    etyonName: "lsp_inspect",
    etyonWorkspaceTool: "etyon_workspace_lsp_inspect"
  },
  ls: {
    etyonName: "find_files",
    etyonWorkspaceTool: "etyon_workspace_list_files"
  },
  read: {
    etyonName: "view",
    etyonWorkspaceTool: "etyon_workspace_read_file"
  },
  write: {
    etyonName: "write_file",
    etyonWorkspaceTool: "etyon_workspace_write_file"
  }
} as const satisfies Record<
  CodeAgentModelFacingToolAlias,
  CodeAgentWorkspaceToolAlias
>

const codeAgentToolAliasSet = new Set<AgentToolName>([
  ...CODE_AGENT_TOOL_ALIASES,
  ...CODE_AGENT_LSP_TOOL_ALIASES
])

export const isCodeAgentToolAlias = (
  toolName: AgentToolName
): toolName is CodeAgentModelFacingToolAlias =>
  codeAgentToolAliasSet.has(toolName)
