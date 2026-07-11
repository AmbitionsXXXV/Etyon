import type { AgentCommandApprovalRule, ChatMention } from "@etyon/rpc"
import type { ToolPartState } from "@heroui-pro/react"
import type {
  ChatAddToolApproveResponseFunction,
  ChatRequestOptions,
  DynamicToolUIPart,
  ToolUIPart
} from "ai"

export const ANT_THINKING_CLOSE_TAG = "</antThinking>"
export const ANT_THINKING_OPEN_TAG = "<antThinking>"
const CHAT_TOOL_DENIAL_REASON = "Denied in chat UI."

type ChatToolPart = DynamicToolUIPart | ToolUIPart

export interface AssistantToolApprovalResponseOptions {
  rememberCommand?: boolean
}

interface RespondToAssistantToolApprovalInput {
  addToolApprovalResponse: ChatAddToolApproveResponseFunction
  approved: boolean
  buildChatRequestOptions: (mentions: ChatMention[]) => ChatRequestOptions
  latestUserMentions: ChatMention[]
  onRememberCommand?: () => void
  part: ChatToolPart
}

// Dedupe by (toolName, projectPath, command): drop any prior entry with the
// same identity, then append the fresh rule so its createdAt resets the TTL.
export const upsertCommandApprovalRule = (
  allowlist: readonly AgentCommandApprovalRule[],
  rule: AgentCommandApprovalRule
): AgentCommandApprovalRule[] => [
  ...allowlist.filter(
    (entry) =>
      entry.toolName !== rule.toolName ||
      entry.projectPath !== rule.projectPath ||
      entry.command !== rule.command
  ),
  rule
]

export const respondToAssistantToolApproval = ({
  addToolApprovalResponse,
  approved,
  buildChatRequestOptions,
  latestUserMentions,
  onRememberCommand,
  part
}: RespondToAssistantToolApprovalInput): boolean => {
  if (part.state !== "approval-requested") {
    return false
  }

  if (approved) {
    onRememberCommand?.()
  }

  void addToolApprovalResponse({
    approved,
    id: part.approval.id,
    options: buildChatRequestOptions(latestUserMentions),
    reason: approved ? undefined : CHAT_TOOL_DENIAL_REASON
  })

  return true
}

export const mapAssistantToolPartStateToChatToolState = (
  state: string
): ToolPartState => {
  switch (state) {
    case "approval-requested": {
      return "requires-action"
    }
    case "input-available":
    case "input-streaming":
    case "output-available":
    case "output-error": {
      return state
    }
    case "approval-responded": {
      return "output-available"
    }
    case "output-denied": {
      return "output-error"
    }
    default: {
      return "input-available"
    }
  }
}
