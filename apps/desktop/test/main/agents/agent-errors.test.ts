import { describe, expect, it } from "vite-plus/test"

import {
  AgentRuntimeError,
  getAgentRuntimeErrorMessage,
  toAgentRuntimeError
} from "@/main/agents/agent-errors"
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

  it("extracts tool error messages from structured outputs", () => {
    expect(
      getAgentRuntimeErrorMessage({
        error: "File does not exist."
      })
    ).toBe("File does not exist.")
    expect(
      getAgentRuntimeErrorMessage({
        message: "Session context is invalid."
      })
    ).toBe("Session context is invalid.")
  })

  it("wraps unknown causes in typed runtime errors", () => {
    const cause = {
      error: "Tool execution failed."
    }
    const error = toAgentRuntimeError({
      cause,
      code: "tool"
    })

    expect(error).toBeInstanceOf(AgentRuntimeError)
    expect(error.code).toBe("tool")
    expect(error.cause).toBe(cause)
    expect(error.message).toBe("Tool execution failed.")
    expect(toAgentRuntimeError({ cause: error, code: "provider" })).toBe(error)
  })
})
