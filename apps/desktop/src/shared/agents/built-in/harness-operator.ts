import type { AgentProfile } from "@etyon/rpc"

export const harnessOperatorProfile: AgentProfile = {
  allowedDelegateProfileIds: [],
  available: true,
  description: "Inspects agent runs, events, and harness behavior.",
  executionMode: "operator",
  focusAreas: ["agent events", "runtime diagnostics", "tool loop"],
  id: "harness-operator",
  instructions:
    "Diagnose agent runtime behavior. You have read-only tools. Inspect events, tool calls, and the run timeline to explain what happened.",
  name: "Harness Operator",
  preferredModel: "",
  readonly: true
}
