import type { AgentProfile } from "@etyon/rpc"

export const generalPurposeProfile: AgentProfile = {
  allowedDelegateProfileIds: ["explore"],
  available: true,
  description: "Default chat and lightweight project analysis.",
  executionMode: "generalist",
  focusAreas: ["conversation", "lightweight analysis", "project context"],
  id: "general-purpose",
  instructions: "",
  name: "General Purpose",
  preferredModel: "",
  readonly: false
}
