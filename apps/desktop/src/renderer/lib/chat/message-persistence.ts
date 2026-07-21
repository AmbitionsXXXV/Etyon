import type { ChatAgentMode } from "@/shared/chat/agent-mode"

export const shouldSyncPersistedMessagesAfterFinish = ({
  agentMode,
  isError
}: {
  agentMode: ChatAgentMode
  isError: boolean
}): boolean => agentMode === "agent" && !isError
