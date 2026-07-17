import { tool } from "ai"

import {
  AskUserInputSchema,
  AskUserOutputSchema
} from "@/shared/agents/input-tools"

/**
 * `ask_user`: a structured question to the user, offered in plan mode only.
 *
 * Defined WITHOUT `execute` — calling it suspends the run (see agent-loop) and
 * the renderer's answer arrives as the tool result via `addToolResult`, which
 * auto-sends the resume request. The call itself persists through the generic
 * `agent_tool_calls` seam, so the pending question survives reload and replays
 * in the run inspector.
 */

const ASK_USER_TOOL_DESCRIPTION = `Ask the user ONE decision question when the answer materially forks the plan (technology choice, data model, scope cut). The run pauses until they answer.

- Provide 2-5 mutually exclusive options: a short label each, plus an optional one-line description of what picking it implies.
- The UI always offers a free-form input besides your options — never add an "Other" option yourself.
- Never re-ask something the user already stated; check the conversation first.
- Ask before finalizing the plan, not after. One question per call; prefer the single most plan-forking question over a battery of small ones.`

export const buildAskUserTool = () =>
  tool({
    description: ASK_USER_TOOL_DESCRIPTION,
    inputSchema: AskUserInputSchema,
    outputSchema: AskUserOutputSchema
  })
