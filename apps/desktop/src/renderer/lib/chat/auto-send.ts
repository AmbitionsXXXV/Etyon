import type { UIMessage } from "ai"
import { isToolUIPart } from "ai"

import { isInputRequiredToolPartType } from "@/shared/agents/input-tools"

interface ShouldSendChatAutomaticallyOptions {
  messages: UIMessage[]
}

const hasToolApprovalResponse = (message: UIMessage | undefined): boolean =>
  message?.role === "assistant" &&
  message.parts.filter(isToolUIPart).some((part) => {
    if (part.state === "approval-requested") {
      return false
    }

    return part.state === "approval-responded"
  }) &&
  !message.parts
    .filter(isToolUIPart)
    .some((part) => part.state === "approval-requested")

// The user just answered an input-required tool (ask_user / propose_plan). The
// answered part is still the message's TRAILING part because the run suspended
// on it; once the model resumes it appends parts after it and this predicate
// goes false. That asymmetry is what prevents an auto-send loop — unlike
// approvals, `output-available` is the part's terminal state, not a transient.
const hasAnsweredTrailingInputToolCall = (
  message: UIMessage | undefined
): boolean => {
  if (message?.role !== "assistant") {
    return false
  }

  const trailing = message.parts.at(-1)

  if (
    !trailing ||
    !isToolUIPart(trailing) ||
    !isInputRequiredToolPartType(trailing.type)
  ) {
    return false
  }

  return (
    trailing.state === "output-available" &&
    !message.parts
      .filter(isToolUIPart)
      .some((part) => part.state === "approval-requested")
  )
}

export const shouldSendChatAutomatically = ({
  messages
}: ShouldSendChatAutomaticallyOptions): boolean => {
  const lastMessage = messages.at(-1)

  return (
    hasToolApprovalResponse(lastMessage) ||
    hasAnsweredTrailingInputToolCall(lastMessage)
  )
}
