import type { ModelMessage } from "ai"

export type AgentCustomMessageType =
  | "agent-run-finished"
  | "agent-run-started"
  | "agent-tool-event"
  | "branch-summary"
  | "compaction-summary"
  | "follow-up"
  | "plan-mode"
  | "queued-message-removed"
  | "queued-message-updated"
  | "queued-messages-reordered"
  | "steering"

export interface CustomAgentMessages {
  __etyonAgentMessageExtensionMarker__?: never
}

export interface AgentModelMessage {
  content: unknown
  role: ModelMessage["role"]
  type: "model"
}

export interface AgentCustomMessageBase {
  data: Record<string, unknown>
  type: string
}

export interface AgentBuiltInCustomMessage extends AgentCustomMessageBase {
  data: Record<string, unknown>
  type: AgentCustomMessageType
}

type AgentDeclaredCustomMessageMap = Omit<
  CustomAgentMessages,
  "__etyonAgentMessageExtensionMarker__"
>

export type AgentDeclaredCustomMessage =
  AgentDeclaredCustomMessageMap[keyof AgentDeclaredCustomMessageMap] &
    AgentCustomMessageBase

export type AgentCustomMessage =
  | AgentBuiltInCustomMessage
  | AgentDeclaredCustomMessage

export type AgentMessage = AgentCustomMessage | AgentModelMessage

const isAgentModelMessage = (
  message: AgentMessage
): message is AgentModelMessage => message.type === "model"

export const convertAgentMessagesToLlm = (
  messages: readonly AgentMessage[]
): ModelMessage[] =>
  messages.filter(isAgentModelMessage).map(
    ({ content, role }) =>
      ({
        content,
        role
      }) as ModelMessage
  )

export const formatAgentMessageForDebug = (message: AgentMessage): string => {
  if (isAgentModelMessage(message)) {
    return `${message.role} ${JSON.stringify(message.content)}`
  }

  return `${message.type} ${JSON.stringify(message.data)}`
}
