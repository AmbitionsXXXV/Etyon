import { describe, expect, it } from "vite-plus/test"

import { AgentRuntimeError } from "@/main/agents/agent-errors"
import type { AgentRuntimeErrorCode } from "@/main/agents/agent-errors"

describe("agent runtime errors", () => {
  it("preserves typed error code and cause", () => {
    const cause = new Error("Provider request failed.")
    const error = new AgentRuntimeError("provider", "Agent provider failed.", {
      cause
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("AgentRuntimeError")
    expect(error.code).toBe("provider")
    expect(error.cause).toBe(cause)
    expect(error.message).toBe("Agent provider failed.")
  })

  it("accepts the high-level runtime error codes used by the harness", () => {
    const codes: AgentRuntimeErrorCode[] = [
      "branch_summary",
      "busy",
      "compaction",
      "hook",
      "provider",
      "session",
      "tool"
    ]

    expect(codes.map((code) => new AgentRuntimeError(code, code).code)).toEqual(
      codes
    )
  })
})
