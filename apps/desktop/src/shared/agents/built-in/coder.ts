import type { AgentProfile } from "@etyon/rpc"

export const coderProfile: AgentProfile = {
  allowedDelegateProfileIds: ["explore"],
  available: true,
  description: "Implements small, bounded changes with validation.",
  executionMode: "coder",
  focusAreas: ["implementation", "tests", "technical debt"],
  id: "coder",
  instructions:
    "Make minimal, targeted edits. Read a file before editing it. Prefer edit over write. After changing files, summarize what changed and why.",
  name: "Coder",
  preferredModel: "",
  readonly: false
}
