import type { ChatMention } from "@etyon/rpc"
import type { ChatAddToolOutputFunction, ChatRequestOptions } from "ai"
import { getToolName } from "ai"

import type {
  ChatToolPart,
  ChatUiMessage
} from "@/renderer/lib/chat/assistant-message-timeline"
import { isRecord } from "@/renderer/lib/utils"
import {
  ASK_USER_TOOL_NAME,
  isInputRequiredToolPartType,
  PROPOSE_PLAN_TOOL_NAME
} from "@/shared/agents/input-tools"
import type { PlanDecision } from "@/shared/agents/input-tools"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"

const INPUT_REQUIRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ASK_USER_TOOL_NAME,
  PROPOSE_PLAN_TOOL_NAME
])

/**
 * A part that suspends the run for renderer input (ask_user / propose_plan).
 * Matches both the static tool part type (`tool-ask_user`) and the dynamic-tool
 * fallback (name lookup) so the two card kinds are recognised either way.
 */
export const isInputRequiredToolPart = (part: ChatToolPart): boolean =>
  isInputRequiredToolPartType(part.type) ||
  INPUT_REQUIRED_TOOL_NAMES.has(getToolName(part))

export interface AskUserOption {
  description?: string
  label: string
}

export interface AskUserCardInput {
  multiSelect: boolean
  options: AskUserOption[]
  question: string
}

export interface AskUserCardOutput {
  custom: string | null
  selected: string[]
}

export interface ProposePlanCardInput {
  plan: string
  title: string
}

const getPartInput = (part: ChatToolPart): unknown =>
  (part as { input?: unknown }).input

const getPartOutput = (part: ChatToolPart): unknown =>
  (part as { output?: unknown }).output

// Tolerant readers: the card must render from whatever the model produced (and
// from what we persisted) without a strict schema parse blocking the UI.
export const getAskUserCardInput = (
  part: ChatToolPart
): AskUserCardInput | null => {
  const input = getPartInput(part)

  if (!isRecord(input) || typeof input.question !== "string") {
    return null
  }

  const options: AskUserOption[] = Array.isArray(input.options)
    ? input.options
        .filter(isRecord)
        .map((option) => ({
          description:
            typeof option.description === "string"
              ? option.description
              : undefined,
          label: typeof option.label === "string" ? option.label : ""
        }))
        .filter((option) => option.label.length > 0)
    : []

  return {
    multiSelect: input.multiSelect === true,
    options,
    question: input.question
  }
}

export const getAskUserCardOutput = (
  part: ChatToolPart
): AskUserCardOutput | null => {
  const output = getPartOutput(part)

  if (!isRecord(output)) {
    return null
  }

  const selected = Array.isArray(output.selected)
    ? output.selected.filter(
        (value): value is string => typeof value === "string"
      )
    : []

  return {
    custom: typeof output.custom === "string" ? output.custom : null,
    selected
  }
}

export const getProposePlanCardInput = (
  part: ChatToolPart
): ProposePlanCardInput | null => {
  const input = getPartInput(part)

  if (
    !isRecord(input) ||
    typeof input.title !== "string" ||
    typeof input.plan !== "string"
  ) {
    return null
  }

  return { plan: input.plan, title: input.title }
}

export const getProposePlanCardDecision = (
  part: ChatToolPart
): PlanDecision | null => {
  const output = getPartOutput(part)

  if (!isRecord(output)) {
    return null
  }

  if (output.decision === "implement" || output.decision === "not_now") {
    return output.decision
  }

  return null
}

/** Collapsed answer line for an answered question: chosen labels then custom. */
export const formatAskUserAnswer = (output: AskUserCardOutput): string => {
  const parts = [...output.selected]
  const custom = output.custom?.trim()

  if (custom) {
    parts.push(custom)
  }

  return parts.join(", ")
}

interface RespondToAssistantInputToolInput {
  addToolResult: ChatAddToolOutputFunction<ChatUiMessage>
  buildChatRequestOptions: (
    mentions: ChatMention[],
    mode?: ChatAgentMode
  ) => ChatRequestOptions
  latestUserMentions: ChatMention[]
  modeOverride?: ChatAgentMode
  output: AskUserCardOutput | { decision: PlanDecision }
  part: ChatToolPart
}

/**
 * Sibling of `respondToAssistantToolApproval`: answers an input-required tool
 * with `addToolResult` and threads the resume request options so auto-send
 * continues the run. `modeOverride` lets the plan card resume in agent mode even
 * though the composer closure still holds the plan mode value at click time.
 */
export const respondToAssistantInputTool = ({
  addToolResult,
  buildChatRequestOptions,
  latestUserMentions,
  modeOverride,
  output,
  part
}: RespondToAssistantInputToolInput): boolean => {
  if (part.state !== "input-available") {
    return false
  }

  void addToolResult({
    options: buildChatRequestOptions(latestUserMentions, modeOverride),
    output: output as never,
    tool: getToolName(part) as never,
    toolCallId: part.toolCallId
  })

  return true
}
