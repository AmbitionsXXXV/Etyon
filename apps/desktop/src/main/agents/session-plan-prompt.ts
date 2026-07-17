import type { SessionPlanStatus } from "@/main/agents/session-plans"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"

/**
 * Builds the one system-prompt block that carries the saved session plan into a
 * turn. Pure and node-testable (no db, no route). The block is chosen by plan
 * status x agent mode; chat mode and finished plans (done/dismissed) get
 * nothing. The plan markdown is clamped so a huge plan can't blow the context.
 */

const PLAN_MARKDOWN_MAX_CHARS = 16_000
const PLAN_TRUNCATED_SUFFIX = "\n\n[plan truncated]"

const clampPlanMarkdown = (planMarkdown: string): string =>
  planMarkdown.length <= PLAN_MARKDOWN_MAX_CHARS
    ? planMarkdown
    : `${planMarkdown.slice(0, PLAN_MARKDOWN_MAX_CHARS)}${PLAN_TRUNCATED_SUFFIX}`

// Plan mode is read-only whatever the plan's status, so `proposed` + plan and
// `implementing` + plan share this block.
const buildReadOnlyPlanBlock = (title: string, planMarkdown: string): string =>
  `A saved plan for this session already exists (title: ${title}).\n\n${planMarkdown}\n\nYou are read-only here: refine it with another propose_plan call if the user asks for changes, or tell them to press Implement (or switch to Agent mode) to execute it.`

export const buildSessionPlanSystemPrompt = ({
  agentMode,
  plan
}: {
  agentMode: ChatAgentMode | undefined
  plan: {
    planMarkdown: string
    status: SessionPlanStatus
    title: string
  }
}): null | string => {
  // Chat mode runs with agents off, so there is nothing to steer.
  if (agentMode !== "agent" && agentMode !== "plan") {
    return null
  }

  // A finished plan (manually marked done or dismissed) is no longer live.
  if (plan.status === "done" || plan.status === "dismissed") {
    return null
  }

  const { title } = plan
  const planMarkdown = clampPlanMarkdown(plan.planMarkdown)

  if (plan.status === "proposed") {
    if (agentMode === "agent") {
      return `A saved plan for this session has not been started yet (title: ${title}).\n\n${planMarkdown}\n\nIf the user asks to implement or execute it (e.g. "implement it", "按计划执行"), treat this plan as the spec: first turn its steps into todos with todo_write, then execute them. If the user asks for something unrelated, ignore the plan.`
    }

    return buildReadOnlyPlanBlock(title, planMarkdown)
  }

  // status === "implementing"
  if (agentMode === "agent") {
    return `You are executing the saved plan for this session (title: ${title}).\n\n${planMarkdown}\n\nKeep following it and keep the todo list in sync. When every step is done, state completion clearly.`
  }

  return buildReadOnlyPlanBlock(title, planMarkdown)
}
