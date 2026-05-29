import type { AgentProfileId } from "@/main/agents/types"

export const AGENT_RUN_GRAPH_TEMPLATE_IDS = [
  "solo-coder",
  "plan-execute-review",
  "investigation",
  "harness-debug"
] as const

export type AgentRunGraphTemplateId =
  (typeof AGENT_RUN_GRAPH_TEMPLATE_IDS)[number]

export type AgentRunGraphTemplateNodeRole =
  | "execute"
  | "explore"
  | "final"
  | "inspect"
  | "plan"
  | "review"
  | "synthesize"

export type AgentRunGraphTemplateToolScope =
  | "approval-gated"
  | "profile-default"
  | "read-only"

export interface AgentRunGraphTemplateNode {
  dependsOn: readonly string[]
  id: string
  label: string
  outputContract: string
  parallelGroup?: string
  profileId: AgentProfileId
  role: AgentRunGraphTemplateNodeRole
  toolScope: AgentRunGraphTemplateToolScope
}

export interface AgentRunGraphTemplate {
  description: string
  id: AgentRunGraphTemplateId
  name: string
  nodes: readonly AgentRunGraphTemplateNode[]
}

const AGENT_RUN_GRAPH_TEMPLATES = [
  {
    description: "Small bounded implementation with a review child run.",
    id: "solo-coder",
    name: "Solo Coder",
    nodes: [
      {
        dependsOn: [],
        id: "coder",
        label: "Implement",
        outputContract: "Patch summary, changed files, and verification notes.",
        profileId: "coder",
        role: "execute",
        toolScope: "approval-gated"
      },
      {
        dependsOn: ["coder"],
        id: "review",
        label: "Review",
        outputContract: "Findings ordered by severity, or explicit approval.",
        profileId: "review",
        role: "review",
        toolScope: "read-only"
      }
    ]
  },
  {
    description:
      "Plan, parallel exploration, implementation, review, and final synthesis.",
    id: "plan-execute-review",
    name: "Plan Execute Review",
    nodes: [
      {
        dependsOn: [],
        id: "plan",
        label: "Plan",
        outputContract:
          "Numbered plan with files, risks, and verification gates.",
        profileId: "plan",
        role: "plan",
        toolScope: "read-only"
      },
      {
        dependsOn: ["plan"],
        id: "explore-code",
        label: "Explore Code",
        outputContract: "Relevant implementation files and evidence.",
        parallelGroup: "explore",
        profileId: "explore",
        role: "explore",
        toolScope: "read-only"
      },
      {
        dependsOn: ["plan"],
        id: "explore-tests",
        label: "Explore Tests",
        outputContract: "Relevant tests, missing coverage, and fixtures.",
        parallelGroup: "explore",
        profileId: "explore",
        role: "explore",
        toolScope: "read-only"
      },
      {
        dependsOn: ["explore-code", "explore-tests"],
        id: "coder",
        label: "Execute",
        outputContract:
          "Patch summary, changed files, and verification output.",
        profileId: "coder",
        role: "execute",
        toolScope: "approval-gated"
      },
      {
        dependsOn: ["coder"],
        id: "review",
        label: "Review",
        outputContract: "Behavioral risks, regressions, and test gaps.",
        profileId: "review",
        role: "review",
        toolScope: "read-only"
      },
      {
        dependsOn: ["review"],
        id: "final",
        label: "Final",
        outputContract: "User-facing summary with verification status.",
        profileId: "general-purpose",
        role: "final",
        toolScope: "read-only"
      }
    ]
  },
  {
    description: "Read-only investigation with evidence synthesis.",
    id: "investigation",
    name: "Investigation",
    nodes: [
      {
        dependsOn: [],
        id: "plan",
        label: "Plan",
        outputContract: "Investigation questions and evidence targets.",
        profileId: "plan",
        role: "plan",
        toolScope: "read-only"
      },
      {
        dependsOn: ["plan"],
        id: "explore",
        label: "Explore",
        outputContract: "Evidence with file references and uncertainty.",
        profileId: "explore",
        role: "explore",
        toolScope: "read-only"
      },
      {
        dependsOn: ["explore"],
        id: "synthesize",
        label: "Synthesize",
        outputContract: "Concrete answer grounded in collected evidence.",
        profileId: "general-purpose",
        role: "synthesize",
        toolScope: "read-only"
      }
    ]
  },
  {
    description: "Inspect agent runtime failures and propose a repair.",
    id: "harness-debug",
    name: "Harness Debug",
    nodes: [
      {
        dependsOn: [],
        id: "inspect-run",
        label: "Inspect Run",
        outputContract: "Run status, error, and high-level lifecycle evidence.",
        profileId: "harness-operator",
        role: "inspect",
        toolScope: "read-only"
      },
      {
        dependsOn: ["inspect-run"],
        id: "inspect-events",
        label: "Inspect Events",
        outputContract: "Relevant events and tool-call state transitions.",
        profileId: "harness-operator",
        role: "inspect",
        toolScope: "read-only"
      },
      {
        dependsOn: ["inspect-events"],
        id: "propose-fix",
        label: "Propose Fix",
        outputContract:
          "Minimal repair plan with files and verification gates.",
        profileId: "plan",
        role: "plan",
        toolScope: "read-only"
      }
    ]
  }
] as const satisfies readonly AgentRunGraphTemplate[]

const templatesById = new Map<string, AgentRunGraphTemplate>(
  AGENT_RUN_GRAPH_TEMPLATES.map((template) => [template.id, template])
)

export const listAgentRunGraphTemplates =
  (): readonly AgentRunGraphTemplate[] => AGENT_RUN_GRAPH_TEMPLATES

export const getAgentRunGraphTemplate = (
  id: string
): AgentRunGraphTemplate | null => templatesById.get(id) ?? null
