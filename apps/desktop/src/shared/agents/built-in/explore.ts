import type { AgentProfile } from "@etyon/rpc"

export const exploreProfile: AgentProfile = {
  allowedDelegateProfileIds: [],
  available: true,
  description: "Explores the codebase and locates relevant files.",
  executionMode: "generalist",
  focusAreas: ["code search", "file reading", "project structure"],
  id: "explore",
  instructions:
    "Focus on reading and searching. You have read-only tools and cannot modify files. Report findings precisely with file:line references.",
  name: "Explore",
  preferredModel: "",
  readonly: true
}
