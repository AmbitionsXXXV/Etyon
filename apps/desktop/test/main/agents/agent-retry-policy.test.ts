import { describe, expect, it } from "vite-plus/test"

import {
  createAgentLoopToolRetryPolicy,
  isAgentToolAutoRetrySafe
} from "@/main/agents/agent-retry-policy"

describe("agent retry policy", () => {
  it("allows automatic tool retry only for safe idempotent tools", async () => {
    expect(isAgentToolAutoRetrySafe("readFile")).toBe(true)
    expect(isAgentToolAutoRetrySafe("gitDiff")).toBe(true)
    expect(isAgentToolAutoRetrySafe("writeFile")).toBe(false)
    expect(isAgentToolAutoRetrySafe("bash")).toBe(false)

    const retryPolicy = createAgentLoopToolRetryPolicy({
      maxAutomaticRetries: 1,
      retryTransientFailures: true
    })

    expect(
      await retryPolicy.shouldRetry?.({
        attempt: 1,
        maxRetries: 1,
        messages: [],
        result: {
          isError: true,
          output: {
            error: "network timeout"
          },
          sourceIndex: 0,
          terminate: false,
          toolCall: {
            input: {
              path: "src/main.ts"
            },
            toolCallId: "write-tool-call",
            toolName: "writeFile"
          }
        },
        toolCall: {
          input: {
            path: "src/main.ts"
          },
          toolCallId: "write-tool-call",
          toolName: "writeFile"
        }
      })
    ).toBe(false)

    expect(
      await retryPolicy.shouldRetry?.({
        attempt: 1,
        maxRetries: 1,
        messages: [],
        result: {
          isError: true,
          output: {
            error: "network timeout"
          },
          sourceIndex: 0,
          terminate: false,
          toolCall: {
            input: {
              path: "src/main.ts"
            },
            toolCallId: "read-tool-call",
            toolName: "readFile"
          }
        },
        toolCall: {
          input: {
            path: "src/main.ts"
          },
          toolCallId: "read-tool-call",
          toolName: "readFile"
        }
      })
    ).toBe(true)
  })
})
