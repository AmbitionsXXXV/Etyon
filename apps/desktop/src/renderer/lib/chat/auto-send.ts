import type { UIMessage } from "ai"
import { isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from "ai"

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

export const shouldSendChatAutomatically = ({
  messages
}: ShouldSendChatAutomaticallyOptions): boolean =>
  hasToolApprovalResponse(messages.at(-1)) ||
  lastAssistantMessageIsCompleteWithToolCalls({ messages })
