import type { AgentToolName } from "@/main/agents/types"
import { AGENT_TOOL_NAMES } from "@/main/agents/types"

export type AgentToolCapability =
  | "agent-run"
  | "git"
  | "memory"
  | "network"
  | "read-fs"
  | "shell"
  | "ui"
  | "write-fs"

export type AgentToolOwner =
  | "builtin"
  | "mcp"
  | "project"
  | "provider"
  | "skill"

export type AgentToolRiskLevel = "high" | "medium" | "safe"

export const AGENT_TOOL_CAPABILITIES = [
  "agent-run",
  "git",
  "memory",
  "network",
  "read-fs",
  "shell",
  "ui",
  "write-fs"
] as const satisfies readonly AgentToolCapability[]

export interface AgentToolManifest {
  capabilities: AgentToolCapability[]
  id: AgentToolName
  owner: AgentToolOwner
  riskLevel: AgentToolRiskLevel
  summary: string
}

const createManifest = (manifest: AgentToolManifest): AgentToolManifest =>
  manifest

const AGENT_TOOL_MANIFESTS = {
  agentCoder: createManifest({
    capabilities: ["agent-run", "write-fs", "shell"],
    id: "agentCoder",
    owner: "builtin",
    riskLevel: "high",
    summary: "Delegate a confirmed execution task to a child coder agent."
  }),
  agentEventsSearch: createManifest({
    capabilities: ["agent-run", "memory"],
    id: "agentEventsSearch",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Search append-only agent runtime events for a known run."
  }),
  agentExplore: createManifest({
    capabilities: ["agent-run"],
    id: "agentExplore",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Delegate a bounded exploration task to a child agent."
  }),
  agentPlan: createManifest({
    capabilities: ["agent-run"],
    id: "agentPlan",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Delegate a bounded planning task to a child agent."
  }),
  agentReview: createManifest({
    capabilities: ["agent-run"],
    id: "agentReview",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Delegate a bounded review task to a child agent."
  }),
  agentRunInspect: createManifest({
    capabilities: ["agent-run", "memory"],
    id: "agentRunInspect",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Inspect events and tool calls for a known agent run."
  }),
  applyPatch: createManifest({
    capabilities: ["write-fs"],
    id: "applyPatch",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Apply a unified patch inside the active project."
  }),
  editFile: createManifest({
    capabilities: ["write-fs"],
    id: "editFile",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Apply exact text replacements inside one project file."
  }),
  fileInfo: createManifest({
    capabilities: ["read-fs"],
    id: "fileInfo",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Read structured metadata for one project path."
  }),
  findFiles: createManifest({
    capabilities: ["read-fs"],
    id: "findFiles",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Find project files by relative path query."
  }),
  gitDiff: createManifest({
    capabilities: ["git", "read-fs"],
    id: "gitDiff",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Read the current git diff for the active project."
  }),
  listDirectory: createManifest({
    capabilities: ["read-fs"],
    id: "listDirectory",
    owner: "builtin",
    riskLevel: "safe",
    summary: "List direct children of one project directory."
  }),
  listProjectTree: createManifest({
    capabilities: ["read-fs"],
    id: "listProjectTree",
    owner: "builtin",
    riskLevel: "safe",
    summary: "List project files and folders from the local snapshot."
  }),
  memorySearch: createManifest({
    capabilities: ["memory"],
    id: "memorySearch",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Search enabled long-term memory entries for relevant context."
  }),
  readFile: createManifest({
    capabilities: ["read-fs"],
    id: "readFile",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Read a bounded UTF-8 text file preview inside the project."
  }),
  rtkCommand: createManifest({
    capabilities: ["shell"],
    id: "rtkCommand",
    owner: "builtin",
    riskLevel: "high",
    summary: "Run a bounded local command through the project RTK wrapper."
  }),
  runCheck: createManifest({
    capabilities: ["shell"],
    id: "runCheck",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Run a bounded project check command."
  }),
  searchFiles: createManifest({
    capabilities: ["read-fs"],
    id: "searchFiles",
    owner: "builtin",
    riskLevel: "safe",
    summary: "Search project file contents with ripgrep."
  }),
  webSearch: createManifest({
    capabilities: ["network"],
    id: "webSearch",
    owner: "builtin",
    riskLevel: "high",
    summary: "Search the public web for current external information."
  }),
  writeFile: createManifest({
    capabilities: ["write-fs"],
    id: "writeFile",
    owner: "builtin",
    riskLevel: "medium",
    summary: "Create or overwrite a UTF-8 text file inside the project."
  })
} as const satisfies Record<AgentToolName, AgentToolManifest>

export const getAgentToolManifest = (
  toolName: AgentToolName
): AgentToolManifest => AGENT_TOOL_MANIFESTS[toolName]

export const isAgentToolCapability = (
  value: string
): value is AgentToolCapability =>
  (AGENT_TOOL_CAPABILITIES as readonly string[]).includes(value)

export const listAgentToolManifests = (): AgentToolManifest[] =>
  AGENT_TOOL_NAMES.map((toolName) => getAgentToolManifest(toolName))
