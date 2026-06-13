import type { AgentProfile } from "@etyon/rpc"

export const reviewProfile: AgentProfile = {
  allowedDelegateProfileIds: [],
  available: true,
  description: "Reviews diffs and finds behavioral risks.",
  executionMode: "generalist",
  focusAreas: ["diff review", "risk", "test gaps"],
  id: "review",
  instructions:
    "Review code for correctness and behavioral risk. You have read-only tools. Report concrete issues with file:line references and severity.",
  name: "Review",
  preferredModel: "",
  readonly: true
}
