export const resolveAgentComposerQueueState = ({
  agentsEnabled,
  isModelUpdating,
  isRequestPending
}: {
  agentsEnabled: boolean
  isModelUpdating: boolean
  isRequestPending: boolean
}): {
  canQueueMessage: boolean
  isComposerDisabled: boolean
} => {
  const canQueueMessage = agentsEnabled && isRequestPending

  return {
    canQueueMessage,
    isComposerDisabled: isModelUpdating
  }
}

export const resolveAgentComposerPrimaryAction = ({
  hasPromptInputValue,
  isOutputActive,
  isQueueSubmitEnabled
}: {
  hasPromptInputValue: boolean
  isOutputActive: boolean
  isQueueSubmitEnabled: boolean
}): "stop" | "submit" => {
  if (!isOutputActive) {
    return "submit"
  }

  return isQueueSubmitEnabled && hasPromptInputValue ? "submit" : "stop"
}
