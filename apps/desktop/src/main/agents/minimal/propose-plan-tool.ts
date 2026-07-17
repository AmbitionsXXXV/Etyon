import { tool } from "ai"

import {
  ProposePlanInputSchema,
  ProposePlanOutputSchema
} from "@/shared/agents/input-tools"

/**
 * `propose_plan`: the plan-mode exit gate, offered in plan mode only.
 *
 * Defined WITHOUT `execute` — calling it suspends the run and the user's
 * Implement / Not-now decision arrives as the tool result, auto-sending the
 * resume request (in agent mode on implement). The call's input is also the
 * durable source for the session's saved plan (`chat_session_plans`).
 */

const PROPOSE_PLAN_TOOL_DESCRIPTION = `Present the finished implementation plan for the user's decision. The run pauses until they choose.

- Call it exactly once, when investigation is done and the plan is complete — never for a draft.
- plan: the full plan in markdown — ordered steps, files to change, what each change does, risks and open questions. title: a short handle, shown while the plan is executing.
- The user answers "implement" (you continue in Agent mode: todo_write the plan's steps first, then execute) or "not_now" (acknowledge in one short sentence and stop; the plan stays saved for later).
- The plan the user can act on is ONLY what you pass here — do not deliver it as chat text instead.`

export const buildProposePlanTool = () =>
  tool({
    description: PROPOSE_PLAN_TOOL_DESCRIPTION,
    inputSchema: ProposePlanInputSchema,
    outputSchema: ProposePlanOutputSchema
  })
