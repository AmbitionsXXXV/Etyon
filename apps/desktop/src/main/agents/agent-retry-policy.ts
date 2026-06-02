import type { AgentSettings } from "@etyon/rpc"

import type { AgentLoopToolRetryPolicy } from "@/main/agents/agent-loop"
import { isRetryableAgentFailure } from "@/main/agents/agent-plan-progress"
import { getAgentToolManifest } from "@/main/agents/tool-manifest"
import { AGENT_TOOL_NAMES } from "@/main/agents/types"
import type { AgentToolName } from "@/main/agents/types"

const AGENT_TOOL_NAME_SET = new Set<string>(AGENT_TOOL_NAMES)
const NON_IDEMPOTENT_CAPABILITIES = new Set(["network", "shell", "write-fs"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const getToolRetryErrorMessage = (output: unknown): string => {
  if (isRecord(output) && typeof output.error === "string") {
    return output.error
  }

  if (typeof output === "string") {
    return output
  }

  return getErrorMessage(output)
}

const isAgentToolName = (toolName: string): toolName is AgentToolName =>
  AGENT_TOOL_NAME_SET.has(toolName)

export const isAgentToolAutoRetrySafe = (toolName: string): boolean => {
  if (!isAgentToolName(toolName)) {
    return false
  }

  const manifest = getAgentToolManifest(toolName)

  return (
    manifest.riskLevel === "safe" &&
    manifest.capabilities.every(
      (capability) => !NON_IDEMPOTENT_CAPABILITIES.has(capability)
    )
  )
}

export const createAgentLoopToolRetryPolicy = (
  retry: AgentSettings["retry"]
): AgentLoopToolRetryPolicy => ({
  maxRetries: retry.maxAutomaticRetries,
  shouldRetry: ({ result }) =>
    retry.retryTransientFailures &&
    isAgentToolAutoRetrySafe(result.toolCall.toolName) &&
    isRetryableAgentFailure(getToolRetryErrorMessage(result.output))
})
