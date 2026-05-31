import { describe, expect, it, vi } from "vite-plus/test"

import { AgentRuntimeError } from "@/main/agents/agent-errors"
import {
  applyAgentStreamResponseHooks,
  prepareAgentStreamRequest
} from "@/main/agents/agent-stream-hooks"

interface MutableHookMetadata {
  nested: {
    source: string
  }
}

interface MutableHookMessage {
  content: MutableHookTextPart[]
  role: "user"
}

interface MutableHookTextPart {
  text: string
  type: "text"
}

interface MutableHookUsage {
  totalTokens: number
}

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

  it("isolates nested hook input objects from caller-owned payload and options", async () => {
    const payload = {
      messages: [
        {
          content: [
            {
              text: "Original",
              type: "text" as const
            }
          ],
          role: "user" as const
        }
      ],
      model: "gpt-5"
    }
    const requestOptions = {
      headers: {
        "x-base": "base"
      },
      metadata: {
        nested: {
          source: "chat"
        }
      }
    }

    const prepared = await prepareAgentStreamRequest({
      hooks: {
        beforeProviderPayload: ({
          payload: hookPayload,
          requestOptions: hookRequestOptions
        }) => {
          const [message] = hookPayload.messages as MutableHookMessage[]
          const metadata = hookRequestOptions.metadata
            .nested as MutableHookMetadata["nested"]

          message.content[0].text = "Mutated by hook"
          metadata.source = "hook"

          return {
            system: `${message.content[0].text}:${metadata.source}`
          }
        }
      },
      payload,
      requestOptions
    })

    expect(prepared.payload).toEqual({
      messages: [
        {
          content: [
            {
              text: "Mutated by hook",
              type: "text"
            }
          ],
          role: "user"
        }
      ],
      model: "gpt-5",
      system: "Mutated by hook:hook"
    })
    expect(payload).toEqual({
      messages: [
        {
          content: [
            {
              text: "Original",
              type: "text"
            }
          ],
          role: "user"
        }
      ],
      model: "gpt-5"
    })
    expect(requestOptions).toEqual({
      headers: {
        "x-base": "base"
      },
      metadata: {
        nested: {
          source: "chat"
        }
      }
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

  it("isolates response hook input objects from caller-owned response", async () => {
    const response = {
      status: "succeeded",
      usage: {
        totalTokens: 42
      }
    }

    await applyAgentStreamResponseHooks({
      hooks: {
        afterProviderResponse: ({ response: hookResponse }) => {
          const usage = hookResponse.usage as MutableHookUsage

          hookResponse.status = "mutated"
          usage.totalTokens = 0
        }
      },
      response
    })

    expect(response).toEqual({
      status: "succeeded",
      usage: {
        totalTokens: 42
      }
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
