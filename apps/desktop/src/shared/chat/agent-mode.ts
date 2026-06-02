export const CHAT_AGENT_MODES = ["chat", "agent"] as const

export type ChatAgentMode = (typeof CHAT_AGENT_MODES)[number]

export const getChatAgentModeFromAgentsEnabled = (
  agentsEnabled: boolean
): ChatAgentMode => (agentsEnabled ? "agent" : "chat")

export const getNextChatAgentMode = (agentMode: ChatAgentMode): ChatAgentMode =>
  agentMode === "agent" ? "chat" : "agent"

export const getChatAgentModeToggleDisabled = ({
  isModelUpdating,
  isRequestPending
}: {
  isModelUpdating: boolean
  isRequestPending: boolean
}): boolean => isModelUpdating || isRequestPending

export const isChatAgentMode = (value: unknown): value is ChatAgentMode =>
  value === "agent" || value === "chat"
