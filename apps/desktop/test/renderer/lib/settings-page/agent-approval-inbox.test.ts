import type { PendingAgentApproval } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildAgentApprovalInboxItem,
  formatApprovalInputPreview
} from "@/renderer/lib/settings-page/agent-approval-inbox"

const baseApproval: PendingAgentApproval = {
  approvalId: "approval-1",
  approvalState: "pending",
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: null,
  id: "tool-1",
  input: {
    command: "vp test run apps/desktop/test/main/rpc/index.test.ts",
    reason: "Validate RPC changes."
  },
  output: undefined,
  parentToolCallId: null,
  profileId: "coder",
  runId: "run-1",
  runStatus: "suspended",
  startedAt: "2026-05-24T00:00:00.000Z",
  state: "approval_requested",
  toolName: "runCheck"
}

describe("agent approval inbox helpers", () => {
  it("formats command input as a compact preview", () => {
    expect(formatApprovalInputPreview(baseApproval.input)).toBe(
      "vp test run apps/desktop/test/main/rpc/index.test.ts"
    )
  })

  it("falls back to json when input has no known preview fields", () => {
    expect(formatApprovalInputPreview({ value: "src/main.ts" })).toBe(
      '{"value":"src/main.ts"}'
    )
  })

  it("builds a stable inbox item", () => {
    expect(buildAgentApprovalInboxItem(baseApproval)).toEqual({
      id: "approval-1",
      inputPreview: "vp test run apps/desktop/test/main/rpc/index.test.ts",
      meta: ["coder", "suspended", "approval_requested"],
      title: "runCheck"
    })
  })
})
