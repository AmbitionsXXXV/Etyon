import type { TranslationKey } from "@etyon/i18n"
import type { AgentExecutionMode } from "@etyon/rpc"

export const AGENT_MAX_CONCURRENT_SUBAGENTS_MAX = 4
export const AGENT_MAX_CONCURRENT_SUBAGENTS_MIN = 1
export const AGENT_MAX_STEPS_MAX = 20
export const AGENT_MAX_STEPS_MIN = 1

export interface AgentProfileOption {
  descriptionKey: TranslationKey
  executionMode: AgentExecutionMode
  focusAreaKeys: readonly TranslationKey[]
  id: string
  nameKey: TranslationKey
  readonly: boolean
}

export const AGENT_PROFILE_OPTIONS = [
  {
    descriptionKey: "settings.agents.profiles.generalPurpose.description",
    executionMode: "generalist",
    focusAreaKeys: [
      "settings.agents.profiles.generalPurpose.focus.conversation",
      "settings.agents.profiles.generalPurpose.focus.projectContext",
      "settings.agents.profiles.generalPurpose.focus.lightweightAnalysis"
    ],
    id: "general-purpose",
    nameKey: "settings.agents.profiles.generalPurpose.name",
    readonly: true
  },
  {
    descriptionKey: "settings.agents.profiles.explore.description",
    executionMode: "generalist",
    focusAreaKeys: [
      "settings.agents.profiles.explore.focus.codeSearch",
      "settings.agents.profiles.explore.focus.fileReading",
      "settings.agents.profiles.explore.focus.projectStructure"
    ],
    id: "explore",
    nameKey: "settings.agents.profiles.explore.name",
    readonly: true
  },
  {
    descriptionKey: "settings.agents.profiles.plan.description",
    executionMode: "plan",
    focusAreaKeys: [
      "settings.agents.profiles.plan.focus.requirements",
      "settings.agents.profiles.plan.focus.sequencing",
      "settings.agents.profiles.plan.focus.riskControl"
    ],
    id: "plan",
    nameKey: "settings.agents.profiles.plan.name",
    readonly: true
  },
  {
    descriptionKey: "settings.agents.profiles.coder.description",
    executionMode: "coder",
    focusAreaKeys: [
      "settings.agents.profiles.coder.focus.implementation",
      "settings.agents.profiles.coder.focus.tests",
      "settings.agents.profiles.coder.focus.technicalDebt"
    ],
    id: "coder",
    nameKey: "settings.agents.profiles.coder.name",
    readonly: false
  },
  {
    descriptionKey: "settings.agents.profiles.review.description",
    executionMode: "generalist",
    focusAreaKeys: [
      "settings.agents.profiles.review.focus.diffReview",
      "settings.agents.profiles.review.focus.risk",
      "settings.agents.profiles.review.focus.testGaps"
    ],
    id: "review",
    nameKey: "settings.agents.profiles.review.name",
    readonly: true
  },
  {
    descriptionKey: "settings.agents.profiles.harnessOperator.description",
    executionMode: "operator",
    focusAreaKeys: [
      "settings.agents.profiles.harnessOperator.focus.agentEvents",
      "settings.agents.profiles.harnessOperator.focus.toolLoop",
      "settings.agents.profiles.harnessOperator.focus.runtimeDiagnostics"
    ],
    id: "harness-operator",
    nameKey: "settings.agents.profiles.harnessOperator.name",
    readonly: true
  }
] as const satisfies readonly AgentProfileOption[]

export const clampAgentMaxConcurrentSubagents = (value: number): number =>
  Math.min(
    AGENT_MAX_CONCURRENT_SUBAGENTS_MAX,
    Math.max(AGENT_MAX_CONCURRENT_SUBAGENTS_MIN, Math.round(value))
  )

export const clampAgentMaxSteps = (value: number): number =>
  Math.min(
    AGENT_MAX_STEPS_MAX,
    Math.max(AGENT_MAX_STEPS_MIN, Math.round(value))
  )

export const getAgentProfileOption = (profileId: string): AgentProfileOption =>
  AGENT_PROFILE_OPTIONS.find((profile) => profile.id === profileId) ??
  AGENT_PROFILE_OPTIONS[0]
