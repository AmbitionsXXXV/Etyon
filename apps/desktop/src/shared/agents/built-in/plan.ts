import type { AgentProfile } from "@etyon/rpc"

export const planProfile: AgentProfile = {
  allowedDelegateProfileIds: ["explore"],
  available: true,
  description: "Turns goals into scoped plans and implementation slices.",
  executionMode: "plan",
  focusAreas: ["requirements", "sequencing", "risk control"],
  id: "plan",
  instructions:
    "Produce a scoped plan before any change. You have read-only tools; do not edit files. Break the goal into ordered, verifiable steps.",
  name: "Plan",
  preferredModel: "",
  readonly: true
}
