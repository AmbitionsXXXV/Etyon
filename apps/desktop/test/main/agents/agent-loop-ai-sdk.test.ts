import { tool } from "ai"
import type { TextStreamPart, ToolSet } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"
import { z } from "zod"

import {
  collectAiSdkStreamTurn,
  createAiSdkAgentLoopModel,
  createAiSdkAgentLoopTools,
  createAiSdkToolResultSummaryProcessor,
  convertModelMessagesToAgentLoopMessages
} from "@/main/agents/agent-loop-ai-sdk"

import {
  createFauxGenerateTextResponse,
  createFauxGenerateToolCallResponse,
  createFauxProviderToolResultResponse,
  createFauxToolCallResponse,
  createFauxToolInputDeltaResponse,
  createFauxProvider
} from "./faux-provider"

const createTextStream = (
  parts: readonly TextStreamPart<ToolSet>[]
): AsyncIterable<TextStreamPart<ToolSet>> => ({
  [Symbol.asyncIterator]: (): AsyncIterator<TextStreamPart<ToolSet>> => {
    let index = 0

    return {
      next: () => {
        const value = parts[index]
        index += 1

        return Promise.resolve(
          value
            ? {
                done: false,
                value
              }
            : {
                done: true,
                value: undefined
              }
        )
      }
    }
  }
})

describe("agent loop AI SDK adapter", () => {
  it("exposes tool schemas to the provider without letting AI SDK auto-execute", async () => {
    const faux = createFauxProvider()
    const execute = vi.fn(() => ({
      content: "should not run"
    }))
    const tools = {
      read: tool({
        description: "Read one file.",
        execute,
        inputSchema: z.object({
          path: z.string()
        })
      })
    }

    faux.setGenerateResponses([
      createFauxGenerateToolCallResponse({
        input: {
          path: "src/provider.ts"
        },
        toolCallId: "call-read-1",
        toolName: "read"
      })
    ])

    const model = createAiSdkAgentLoopModel({
      model: faux.model,
      tools
    })
    const turn = await model({
      availableToolNames: ["read"],
      messages: [
        {
          content: "Read provider settings.",
          role: "user"
        }
      ],
      turnIndex: 0
    })

    expect(execute).not.toHaveBeenCalled()
    expect(
      faux.model.doGenerateCalls[0]?.tools?.map((item) => item.name)
    ).toEqual(["read"])
    expect(turn.toolCalls).toEqual([
      {
        input: {
          path: "src/provider.ts"
        },
        toolCallId: "call-read-1",
        toolName: "read"
      }
    ])
  })

  it("can adapt AI SDK provider streams into self-managed loop turns", async () => {
    const faux = createFauxProvider()
    const execute = vi.fn(() => ({
      content: "should not run"
    }))
    const tools = {
      read: tool({
        description: "Read one file.",
        execute,
        inputSchema: z.object({
          path: z.string()
        })
      })
    }

    faux.setResponses([
      createFauxToolCallResponse({
        input: {
          path: "src/provider.ts"
        },
        toolCallId: "call-read-stream-1",
        toolName: "read"
      })
    ])

    const model = createAiSdkAgentLoopModel({
      mode: "stream",
      model: faux.model,
      tools
    })
    const turn = await model({
      availableToolNames: ["read"],
      messages: [
        {
          content: "Read provider settings.",
          role: "user"
        }
      ],
      turnIndex: 0
    })

    expect(execute).not.toHaveBeenCalled()
    expect(faux.model.doStreamCalls).toHaveLength(1)
    expect(turn.toolCalls).toEqual([
      {
        input: {
          path: "src/provider.ts"
        },
        toolCallId: "call-read-stream-1",
        toolName: "read"
      }
    ])
  })

  it("adapts streamed tool input deltas into self-managed loop tool calls", async () => {
    const faux = createFauxProvider()
    const execute = vi.fn(() => ({
      content: "should not run"
    }))
    const observedToolCalls: unknown[] = []
    const tools = {
      read: tool({
        description: "Read one file.",
        execute,
        inputSchema: z.object({
          path: z.string()
        })
      })
    }

    faux.setResponses([
      createFauxToolInputDeltaResponse({
        input: {
          path: "src/provider.ts"
        },
        inputChunks: ['{"path":', '"src/provider.ts"}'],
        toolCallId: "call-read-delta-1",
        toolName: "read"
      })
    ])

    const model = createAiSdkAgentLoopModel({
      mode: "stream",
      model: faux.model,
      streamCallbacks: {
        onToolCall: (toolCall) => {
          observedToolCalls.push(toolCall)
        }
      },
      tools
    })
    const turn = await model({
      availableToolNames: ["read"],
      messages: [
        {
          content: "Read provider settings.",
          role: "user"
        }
      ],
      turnIndex: 0
    })

    expect(execute).not.toHaveBeenCalled()
    expect(turn.toolCalls).toEqual([
      {
        input: {
          path: "src/provider.ts"
        },
        toolCallId: "call-read-delta-1",
        toolName: "read"
      }
    ])
    expect(observedToolCalls).toEqual(turn.toolCalls)
  })

  it("adapts provider-executed stream tool results without local execution", async () => {
    const faux = createFauxProvider()
    const execute = vi.fn(() => ({
      content: "should not run"
    }))
    const observedToolCalls: unknown[] = []
    const observedToolResults: unknown[] = []
    const tools = {
      webSearch: tool({
        description: "Search the web.",
        execute,
        inputSchema: z.object({
          query: z.string()
        })
      })
    }

    faux.setResponses([
      createFauxProviderToolResultResponse({
        input: {
          query: "Etyon"
        },
        output: {
          results: ["provider result"]
        },
        toolCallId: "provider-search-1",
        toolName: "webSearch"
      })
    ])

    const model = createAiSdkAgentLoopModel({
      mode: "stream",
      model: faux.model,
      streamCallbacks: {
        onToolCall: (toolCall) => {
          observedToolCalls.push(toolCall)
        },
        onToolResult: (toolResult) => {
          observedToolResults.push(toolResult)
        }
      },
      tools
    })
    const turn = await model({
      availableToolNames: ["webSearch"],
      messages: [
        {
          content: "Search for Etyon.",
          role: "user"
        }
      ],
      turnIndex: 0
    })

    expect(execute).not.toHaveBeenCalled()
    expect(turn.toolCalls).toEqual([
      {
        input: {
          query: "Etyon"
        },
        toolCallId: "provider-search-1",
        toolName: "webSearch"
      }
    ])
    expect(turn.toolResults).toEqual([
      {
        input: {
          query: "Etyon"
        },
        isError: false,
        output: {
          results: ["provider result"]
        },
        toolCallId: "provider-search-1",
        toolName: "webSearch"
      }
    ])
    expect(observedToolCalls).toEqual(turn.toolCalls)
    expect(observedToolResults).toEqual(turn.toolResults)
  })

  it("collects AI SDK stream tool errors as model-visible tool results", async () => {
    const observedToolResults: unknown[] = []
    const stream = createTextStream([
      {
        input: {
          query: "Etyon"
        },
        toolCallId: "provider-error-1",
        toolName: "webSearch",
        type: "tool-call"
      } as TextStreamPart<ToolSet>,
      {
        error: "Provider tool failed.",
        input: {
          query: "Etyon"
        },
        toolCallId: "provider-error-1",
        toolName: "webSearch",
        type: "tool-error"
      } as TextStreamPart<ToolSet>
    ])

    const turn = await collectAiSdkStreamTurn({
      stream,
      streamCallbacks: {
        onToolResult: (toolResult) => {
          observedToolResults.push(toolResult)
        }
      }
    })

    expect(turn.toolResults).toEqual([
      {
        input: {
          query: "Etyon"
        },
        isError: true,
        output: "Provider tool failed.",
        toolCallId: "provider-error-1",
        toolName: "webSearch"
      }
    ])
    expect(observedToolResults).toEqual(turn.toolResults)
  })

  it("collects denied AI SDK tool outputs as execution-denied results", async () => {
    const stream = createTextStream([
      {
        input: {
          query: "Etyon"
        },
        toolCallId: "provider-denied-1",
        toolName: "webSearch",
        type: "tool-call"
      } as TextStreamPart<ToolSet>,
      {
        toolCallId: "provider-denied-1",
        toolName: "webSearch",
        type: "tool-output-denied"
      } as TextStreamPart<ToolSet>
    ])

    const turn = await collectAiSdkStreamTurn({
      stream
    })

    expect(turn.toolResults).toEqual([
      {
        input: {
          query: "Etyon"
        },
        isError: true,
        output: {
          reason: "Provider denied tool output.",
          type: "execution-denied"
        },
        toolCallId: "provider-denied-1",
        toolName: "webSearch"
      }
    ])
  })

  it("executes AI SDK tools through the self-managed loop tool boundary", async () => {
    const execute = vi.fn((input: unknown) => ({
      echoed: input
    }))
    const loopTools = createAiSdkAgentLoopTools({
      tools: {
        read: tool({
          description: "Read one file.",
          execute,
          inputSchema: z.object({
            path: z.string()
          })
        })
      }
    })

    await expect(
      loopTools.read?.execute(
        {
          path: "src/provider.ts"
        },
        {
          messages: [
            {
              content: "Read provider settings.",
              role: "user"
            }
          ],
          toolCall: {
            input: {
              path: "src/provider.ts"
            },
            toolCallId: "call-read-1",
            toolName: "read"
          }
        }
      )
    ).resolves.toEqual({
      echoed: {
        path: "src/provider.ts"
      }
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("summarizes large tool output through the AI SDK model", async () => {
    const faux = createFauxProvider()

    faux.setGenerateResponses([
      createFauxGenerateTextResponse("model generated summary")
    ])

    const processor = createAiSdkToolResultSummaryProcessor({
      maxInputChars: 12,
      model: faux.model
    })

    await expect(
      processor({
        content: "abcdefghijklmnopqrstuvwxyz",
        deterministicSummary: {
          content: "abc",
          omittedChars: 23,
          totalChars: 26,
          truncated: true
        },
        maxSummaryChars: 80
      })
    ).resolves.toBe("model generated summary")
    expect(faux.model.doGenerateCalls).toHaveLength(1)
  })

  it("drops approval-only assistant messages before provider calls", () => {
    expect(
      convertModelMessagesToAgentLoopMessages([
        {
          content: [
            {
              input: {
                command: "git diff --cached --stat"
              },
              toolCallId: "bash:18",
              toolName: "bash",
              type: "tool-call"
            }
          ],
          role: "assistant"
        },
        {
          content: [
            {
              approvalId: "approval-18",
              toolCallId: "bash:18",
              type: "tool-approval-request"
            }
          ],
          role: "assistant"
        },
        {
          content: [
            {
              output: {
                type: "json",
                value: {
                  content: "ok"
                }
              },
              toolCallId: "bash:18",
              toolName: "bash",
              type: "tool-result"
            }
          ],
          role: "tool"
        }
      ])
    ).toEqual([
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            input: {
              command: "git diff --cached --stat"
            },
            toolCallId: "bash:18",
            toolName: "bash"
          }
        ]
      },
      {
        isError: false,
        output: {
          content: "ok"
        },
        role: "tool",
        toolCallId: "bash:18",
        toolName: "bash"
      }
    ])
  })
})
