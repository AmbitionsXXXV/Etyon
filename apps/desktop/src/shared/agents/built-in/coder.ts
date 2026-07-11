import type { AgentProfile } from "@etyon/rpc"

export const coderProfile: AgentProfile = {
  // "coder" makes the writable-child path reachable: a coder parent can hand a
  // bounded implementation task to one writable peer (nesting still capped at 1
  // by construction — children never receive the delegate tool).
  allowedDelegateProfileIds: ["coder", "explore"],
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
