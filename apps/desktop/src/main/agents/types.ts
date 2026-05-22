import type {
  AgentExecutionMode,
  AgentProfile,
  AgentSettings
} from "@etyon/rpc"

export const AGENT_TOOL_NAMES = [
  "searchFiles",
  "readFile",
  "listProjectTree",
  "gitDiff",
  "rtkCommand",
  "runCheck",
  "applyPatch",
  "agentExplore",
  "agentPlan",
  "agentReview",
  "agentEventsSearch",
  "agentRunInspect"
] as const

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

export interface AgentBudgetPolicy {
  maxSteps: number
}

export interface AgentDelegationPolicy {
  allowedDelegateProfileIds: string[]
  canDelegate: boolean
}

export interface AgentModelPolicy {
  preferredModel: string
}

export interface AgentToolPolicy {
  allowWrites: boolean
  allowedToolNames: AgentToolName[]
  requireApprovalForWrites: boolean
}

export interface ManagedAgentProfile extends AgentProfile {
  budgetPolicy: AgentBudgetPolicy
  delegationPolicy: AgentDelegationPolicy
  modelPolicy: AgentModelPolicy
  toolPolicy: AgentToolPolicy
}

export interface ResolveAgentProfileOptions {
  profileId?: string
  settings: AgentSettings
}

export type AgentProfileId =
  | "coder"
  | "explore"
  | "general-purpose"
  | "harness-operator"
  | "plan"
  | "review"

export type AgentProfileExecutionMode = AgentExecutionMode
