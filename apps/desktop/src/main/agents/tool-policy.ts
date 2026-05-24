import {
  getAgentToolManifest,
  isAgentToolCapability
} from "@/main/agents/tool-manifest"
import type { AgentToolName } from "@/main/agents/types"

export interface CompileAgentToolNamesOptions {
  allowedToolNames: readonly AgentToolName[]
  restrictToSafeTools?: boolean
  skillCapabilities?: readonly string[]
}

export const isSafeAgentTool = (toolName: AgentToolName): boolean =>
  getAgentToolManifest(toolName).riskLevel === "safe"

export const compileAgentToolNames = ({
  allowedToolNames,
  restrictToSafeTools = false,
  skillCapabilities
}: CompileAgentToolNamesOptions): AgentToolName[] => {
  const allowedCapabilities =
    skillCapabilities === undefined
      ? null
      : new Set(skillCapabilities.filter(isAgentToolCapability))

  if (allowedCapabilities && allowedCapabilities.size === 0) {
    return []
  }

  const capabilityFilteredToolNames = allowedCapabilities
    ? allowedToolNames.filter((toolName) =>
        getAgentToolManifest(toolName).capabilities.some((capability) =>
          allowedCapabilities.has(capability)
        )
      )
    : [...allowedToolNames]

  if (!restrictToSafeTools) {
    return capabilityFilteredToolNames
  }

  return capabilityFilteredToolNames.filter(isSafeAgentTool)
}
