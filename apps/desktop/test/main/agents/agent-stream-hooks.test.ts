import { describe, expect, it, vi } from "vite-plus/test"

import { AgentRuntimeError } from "@/main/agents/agent-errors"
import {
  applyAgentStreamResponseHooks,
  prepareAgentStreamRequest
} from "@/main/agents/agent-stream-hooks"

describe("agent stream hooks", () => {
  it("applies provider request header and metadata patches in order", async () => {
    const requestOptions = {
      headers: {
        authorization: "Bearer old",
        stale: "remove-me"
      },
      metadata: {
        keep: true,
        traceId: "old-trace"
      }
    }

    const prepared = await prepareAgentStreamRequest({
      hooks: {
        beforeProviderRequest: [
          () => ({
            headers: {
              authorization: "Bearer new",
              stale: null
            },
            metadata: {
              first: 1,
              traceId: "new-trace"
            }
          }),
          ({ requestOptions: currentOptions }) => ({
            headers: {
              "x-trace-id": String(currentOptions.metadata.traceId)
            },
            metadata: {
              keep: undefined,
              second: 2
            }
          })
        ]
      },
      payload: {
        messages: [],
        model: "gpt-5"
      },
      requestOptions
    })

    expect(prepared.requestOptions).toEqual({
      headers: {
        authorization: "Bearer new",
        "x-trace-id": "new-trace"
      },
      metadata: {
        first: 1,
        second: 2,
        traceId: "new-trace"
      }
    })
    expect(requestOptions).toEqual({
      headers: {
        authorization: "Bearer old",
        stale: "remove-me"
      },
      metadata: {
        keep: true,
        traceId: "old-trace"
      }
    })
  })

  it("applies provider payload patches without mutating the input payload", async () => {
    const payload = {
      messages: [
        {
          content: "Hello",
          role: "user"
        }
      ],
      model: "gpt-5",
      temperature: 0.2
    }

    const prepared = await prepareAgentStreamRequest({
      hooks: {
        beforeProviderPayload: [
          () => ({
            model: "gpt-5-mini",
            temperature: 0
          }),
          ({ payload: currentPayload }) => ({
            metadata: {
              model: currentPayload.model
            }
          })
        ]
      },
      payload,
      requestOptions: {
        headers: {},
        metadata: {}
      }
    })

    expect(prepared.payload).toEqual({
      messages: [
        {
          content: "Hello",
          role: "user"
        }
      ],
      metadata: {
        model: "gpt-5-mini"
      },
      model: "gpt-5-mini",
      temperature: 0
    })
    expect(payload).toEqual({
      messages: [
        {
          content: "Hello",
          role: "user"
        }
      ],
      model: "gpt-5",
      temperature: 0.2
    })
  })

  it("runs response hooks with the final response", async () => {
    const afterProviderResponse = vi.fn()
    const response = {
      stopReason: "stop",
      usage: {
        totalTokens: 42
      }
    }

    await applyAgentStreamResponseHooks({
      hooks: {
        afterProviderResponse
      },
      response
    })

    expect(afterProviderResponse).toHaveBeenCalledWith({
      response
    })
  })

  it("wraps hook failures as typed runtime errors", async () => {
    const cause = new Error("hook exploded")

    await expect(
      prepareAgentStreamRequest({
        hooks: {
          beforeProviderRequest: () => {
            throw cause
          }
        },
        payload: {
          messages: [],
          model: "gpt-5"
        },
        requestOptions: {
          headers: {},
          metadata: {}
        }
      })
    ).rejects.toEqual(
      new AgentRuntimeError("hook", "Agent stream hook failed.", {
        cause
      })
    )
  })
})
