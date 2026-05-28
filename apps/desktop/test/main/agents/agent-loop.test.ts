import { describe, expect, it, vi } from "vite-plus/test"

import type {
  AgentLoopEvent,
  AgentLoopMessage,
  AgentLoopModel,
  AgentLoopModelStreamPart
} from "@/main/agents/agent-loop"
import {
  createAgentLoopStreamModel,
  runAgentLoop
} from "@/main/agents/agent-loop"

const createDeferred = <TValue>() => {
  const { promise, reject, resolve } = Promise.withResolvers<TValue>()

  return {
    promise,
    reject,
    resolve
  }
}

const cloneMessages = (
  messages: readonly AgentLoopMessage[]
): AgentLoopMessage[] => structuredClone(messages) as AgentLoopMessage[]

const sequentialBatchModel: AgentLoopModel = ({ messages }) => {
  if (messages.some((message) => message.role === "tool")) {
    return {
      content: "Done.",
      toolCalls: []
    }
  }

  return {
    content: "I will run sequentially.",
    toolCalls: [
      {
        input: "first",
        toolCallId: "tool-call-1",
        toolName: "firstTool"
      },
      {
        input: "second",
        toolCallId: "tool-call-2",
        toolName: "secondTool"
      }
    ]
  }
}

const STREAMED_INSPECT_TURN_PARTS = [
  {
    text: "I will inspect ",
    type: "text-delta" as const
  },
  {
    text: "the file.",
    type: "text-delta" as const
  },
  {
    toolCall: {
      input: {
        path: "src/main.ts"
      },
      toolCallId: "tool-call-1",
      toolName: "readFile"
    },
    type: "tool-call" as const
  }
] satisfies AgentLoopModelStreamPart[]

const createStreamedInspectTurn =
  (): ReadableStream<AgentLoopModelStreamPart> =>
    new ReadableStream({
      start: (controller) => {
        for (const part of STREAMED_INSPECT_TURN_PARTS) {
          controller.enqueue(part)
        }

        controller.close()
      }
    })

describe("agent loop", () => {
  it("feeds tool results into the next model turn", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will inspect the file.",
          toolCalls: [
            {
              input: {
                path: "src/main.ts"
              },
              toolCallId: "tool-call-1",
              toolName: "readFile"
            }
          ]
        }
      }

      return {
        content: "The file exports value.",
        toolCalls: []
      }
    })
    const events: AgentLoopEvent[] = []

    const result = await runAgentLoop({
      maxTurns: 5,
      messages: [
        {
          content: "Read src/main.ts.",
          role: "user"
        }
      ],
      model,
      onEvent: (event) => {
        events.push(event)
      },
      tools: {
        readFile: {
          execute: () => ({
            content: "export const value = 1"
          })
        }
      }
    })

    expect(model).toHaveBeenCalledTimes(2)
    expect(modelMessages[1]).toEqual([
      {
        content: "Read src/main.ts.",
        role: "user"
      },
      {
        content: "I will inspect the file.",
        role: "assistant",
        toolCalls: [
          {
            input: {
              path: "src/main.ts"
            },
            toolCallId: "tool-call-1",
            toolName: "readFile"
          }
        ]
      },
      {
        isError: false,
        output: {
          content: "export const value = 1"
        },
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "readFile"
      }
    ])
    expect(result.stopReason).toBe("final")
    expect(result.messages.at(-1)).toEqual({
      content: "The file exports value.",
      role: "assistant",
      toolCalls: []
    })
    expect(events.map((event) => event.type)).toEqual([
      "agent_turn_started",
      "assistant_message_appended",
      "tool_execution_started",
      "tool_execution_finished",
      "tool_result_appended",
      "agent_turn_started",
      "assistant_message_appended",
      "agent_loop_finished"
    ])
  })

  it("passes the abort signal into model turns", async () => {
    const abortController = new AbortController()
    const model: AgentLoopModel = vi.fn(({ abortSignal }) => ({
      content: abortSignal === abortController.signal ? "Has signal." : "No.",
      toolCalls: []
    }))

    const result = await runAgentLoop({
      abortSignal: abortController.signal,
      maxTurns: 1,
      messages: [
        {
          content: "Start.",
          role: "user"
        }
      ],
      model,
      tools: {}
    })

    expect(result.messages.at(-1)).toEqual({
      content: "Has signal.",
      role: "assistant",
      toolCalls: []
    })
  })

  it("adapts streamed model parts into an agent loop model turn", async () => {
    const modelContexts: unknown[] = []
    const model = createAgentLoopStreamModel({
      stream: (context) => {
        modelContexts.push({
          availableToolNames: context.availableToolNames,
          turnIndex: context.turnIndex
        })

        return createStreamedInspectTurn()
      }
    })
    const result = await runAgentLoop({
      maxTurns: 1,
      messages: [
        {
          content: "Read src/main.ts.",
          role: "user"
        }
      ],
      model,
      tools: {
        readFile: {
          execute: () => "content"
        }
      }
    })

    expect(modelContexts).toEqual([
      {
        availableToolNames: ["readFile"],
        turnIndex: 0
      }
    ])
    expect(result.messages.at(1)).toEqual({
      content: "I will inspect the file.",
      role: "assistant",
      toolCalls: [
        {
          input: {
            path: "src/main.ts"
          },
          toolCallId: "tool-call-1",
          toolName: "readFile"
        }
      ]
    })
  })

  it("cancels a readable model stream when the loop is aborted", async () => {
    const abortController = new AbortController()
    const cancelReasons: unknown[] = []
    const streamStarted = createDeferred<null>()
    const model = createAgentLoopStreamModel({
      stream: () =>
        new ReadableStream({
          cancel: (reason) => {
            cancelReasons.push(reason)
          },
          start: () => {
            streamStarted.resolve(null)
          }
        })
    })
    const loopPromise = runAgentLoop({
      abortSignal: abortController.signal,
      maxTurns: 1,
      messages: [
        {
          content: "Start.",
          role: "user"
        }
      ],
      model,
      tools: {}
    })

    await streamStarted.promise
    abortController.abort()

    const result = await loopPromise

    expect(result.stopReason).toBe("aborted")
    expect(cancelReasons).toEqual([expect.any(Error)])
    expect((cancelReasons[0] as Error).message).toBe("Agent loop aborted.")
  })

  it("keeps parallel tool results in source order for the next model turn", async () => {
    const firstTool = createDeferred<string>()
    const secondTool = createDeferred<string>()
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will run both tools.",
          toolCalls: [
            {
              input: {
                path: "first.txt"
              },
              toolCallId: "tool-call-1",
              toolName: "firstTool"
            },
            {
              input: {
                path: "second.txt"
              },
              toolCallId: "tool-call-2",
              toolName: "secondTool"
            }
          ]
        }
      }

      return {
        content: "Both results are available.",
        toolCalls: []
      }
    })
    const events: AgentLoopEvent[] = []
    const loopPromise = runAgentLoop({
      maxTurns: 5,
      messages: [
        {
          content: "Run both tools.",
          role: "user"
        }
      ],
      model,
      onEvent: (event) => {
        events.push(event)
      },
      tools: {
        firstTool: {
          execute: () => firstTool.promise
        },
        secondTool: {
          execute: () => secondTool.promise
        }
      }
    })

    await vi.waitFor(() => {
      expect(
        events.filter((event) => event.type === "tool_execution_started")
      ).toHaveLength(2)
    })

    secondTool.resolve("second result")
    await vi.waitFor(() => {
      expect(
        events.filter(
          (event) =>
            event.type === "tool_execution_finished" &&
            event.toolCallId === "tool-call-2"
        )
      ).toHaveLength(1)
    })

    firstTool.resolve("first result")
    await loopPromise

    const finishEvents = events.filter(
      (event) => event.type === "tool_execution_finished"
    )

    expect(finishEvents.map((event) => event.toolCallId)).toEqual([
      "tool-call-2",
      "tool-call-1"
    ])
    expect(modelMessages[1]?.slice(-2)).toEqual([
      {
        isError: false,
        output: "first result",
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "firstTool"
      },
      {
        isError: false,
        output: "second result",
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "secondTool"
      }
    ])
  })

  it("lets beforeToolCall rewrite inputs or block a tool result", async () => {
    const executeEcho = vi.fn((input: unknown) => input)
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will call one allowed and one blocked tool.",
          toolCalls: [
            {
              input: {
                path: "original.txt"
              },
              toolCallId: "tool-call-1",
              toolName: "echo"
            },
            {
              input: {
                path: "secret.txt"
              },
              toolCallId: "tool-call-2",
              toolName: "blocked"
            }
          ]
        }
      }

      return {
        content: "I saw both tool results.",
        toolCalls: []
      }
    })

    await runAgentLoop({
      beforeToolCall: (toolCall) => {
        if (toolCall.toolName === "blocked") {
          return {
            block: true,
            reason: "Blocked by policy."
          }
        }

        return {
          input: {
            path: "rewritten.txt"
          }
        }
      },
      maxTurns: 5,
      messages: [
        {
          content: "Try two tools.",
          role: "user"
        }
      ],
      model,
      tools: {
        blocked: {
          execute: () => {
            throw new Error("Should not execute blocked tool.")
          }
        },
        echo: {
          execute: executeEcho
        }
      }
    })

    expect(executeEcho).toHaveBeenCalledWith(
      {
        path: "rewritten.txt"
      },
      expect.objectContaining({
        toolCall: expect.objectContaining({
          input: {
            path: "rewritten.txt"
          },
          toolCallId: "tool-call-1",
          toolName: "echo"
        })
      })
    )
    expect(modelMessages[1]?.slice(-2)).toEqual([
      {
        isError: false,
        output: {
          path: "rewritten.txt"
        },
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "echo"
      },
      {
        isError: true,
        output: {
          error: "Blocked by policy."
        },
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "blocked"
      }
    ])
  })

  it("blocks inactive tools without executing registered implementations", async () => {
    const executeReadFile = vi.fn(() => "file content")
    const executeEditFile = vi.fn(() => "edited")
    const availableToolNamesByTurn: string[][] = []
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ availableToolNames, messages }) => {
      availableToolNamesByTurn.push([...availableToolNames])
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will try one active and one inactive tool.",
          toolCalls: [
            {
              input: {
                path: "src/main.ts"
              },
              toolCallId: "tool-call-1",
              toolName: "readFile"
            },
            {
              input: {
                path: "src/main.ts"
              },
              toolCallId: "tool-call-2",
              toolName: "editFile"
            }
          ]
        }
      }

      return {
        content: "I saw the tool results.",
        toolCalls: []
      }
    })

    await runAgentLoop({
      activeToolNames: ["readFile"],
      maxTurns: 5,
      messages: [
        {
          content: "Inspect without editing.",
          role: "user"
        }
      ],
      model,
      tools: {
        editFile: {
          execute: executeEditFile
        },
        readFile: {
          execute: executeReadFile
        }
      }
    })

    expect(availableToolNamesByTurn[0]).toEqual(["readFile"])
    expect(executeReadFile).toHaveBeenCalledOnce()
    expect(executeEditFile).not.toHaveBeenCalled()
    expect(modelMessages[1]?.slice(-2)).toEqual([
      {
        isError: false,
        output: "file content",
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "readFile"
      },
      {
        isError: true,
        output: {
          error: "Tool is not active: editFile"
        },
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "editFile"
      }
    ])
  })

  it("lets afterToolCall patch output and terminate the loop", async () => {
    const model: AgentLoopModel = vi.fn(() => ({
      content: "I will run one terminal tool.",
      toolCalls: [
        {
          input: {
            command: "vp test run"
          },
          toolCallId: "tool-call-1",
          toolName: "runCheck"
        }
      ]
    }))

    const result = await runAgentLoop({
      afterToolCall: () => ({
        output: {
          summary: "patched"
        },
        terminate: true
      }),
      maxTurns: 5,
      messages: [
        {
          content: "Run checks.",
          role: "user"
        }
      ],
      model,
      tools: {
        runCheck: {
          execute: () => ({
            summary: "raw"
          })
        }
      }
    })

    expect(model).toHaveBeenCalledTimes(1)
    expect(result.stopReason).toBe("terminated")
    expect(result.messages.at(-1)).toEqual({
      isError: false,
      output: {
        summary: "patched"
      },
      role: "tool",
      toolCallId: "tool-call-1",
      toolName: "runCheck"
    })
  })

  it("injects steering messages after the current tool batch is appended", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will inspect first.",
          toolCalls: [
            {
              input: {
                path: "src/main.ts"
              },
              toolCallId: "tool-call-1",
              toolName: "readFile"
            }
          ]
        }
      }

      return {
        content: "I incorporated the steering message.",
        toolCalls: []
      }
    })

    await runAgentLoop({
      getSteeringMessages: () => [
        {
          content: "Now focus only on failing tests.",
          role: "user"
        }
      ],
      maxTurns: 5,
      messages: [
        {
          content: "Inspect the file.",
          role: "user"
        }
      ],
      model,
      tools: {
        readFile: {
          execute: () => "file content"
        }
      }
    })

    expect(modelMessages[1]?.slice(-2)).toEqual([
      {
        isError: false,
        output: "file content",
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "readFile"
      },
      {
        content: "Now focus only on failing tests.",
        role: "user"
      }
    ])
  })

  it("runs follow-up messages after a final assistant turn", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      return {
        content:
          modelMessages.length === 1 ? "Initial answer." : "Follow-up answer.",
        toolCalls: []
      }
    })
    const getFollowUpMessages = vi
      .fn()
      .mockReturnValueOnce([
        {
          content: "Continue with the follow-up task.",
          role: "user"
        }
      ])
      .mockReturnValue([])

    const result = await runAgentLoop({
      getFollowUpMessages,
      maxTurns: 5,
      messages: [
        {
          content: "Answer first.",
          role: "user"
        }
      ],
      model,
      tools: {}
    })

    expect(model).toHaveBeenCalledTimes(2)
    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "Continue with the follow-up task.",
      role: "user"
    })
    expect(result.stopReason).toBe("final")
  })

  it("lets prepareNextTurn replace the next model context", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will inspect first.",
          toolCalls: [
            {
              input: {
                path: "large.log"
              },
              toolCallId: "tool-call-1",
              toolName: "readFile"
            }
          ]
        }
      }

      return {
        content: "I saw the prepared context.",
        toolCalls: []
      }
    })

    await runAgentLoop({
      maxTurns: 5,
      messages: [
        {
          content: "Inspect a large file.",
          role: "user"
        }
      ],
      model,
      prepareNextTurn: () => ({
        messages: [
          {
            content: "Prepared compact context.",
            role: "user"
          }
        ]
      }),
      tools: {
        readFile: {
          execute: () => "large file output"
        }
      }
    })

    expect(modelMessages[1]).toEqual([
      {
        content: "Prepared compact context.",
        role: "user"
      }
    ])
  })

  it("passes resources to model turns and lets prepareNextTurn replace them", async () => {
    const modelResources: unknown[] = []
    const model: AgentLoopModel = vi.fn(({ resources }) => {
      modelResources.push(resources)

      if (modelResources.length === 1) {
        return {
          content: "I will inspect.",
          toolCalls: [
            {
              input: {},
              toolCallId: "tool-call-1",
              toolName: "inspect"
            }
          ]
        }
      }

      return {
        content: "Done.",
        toolCalls: []
      }
    })

    await runAgentLoop({
      maxTurns: 3,
      messages: [
        {
          content: "Start.",
          role: "user"
        }
      ],
      model,
      prepareNextTurn: ({ resources }) => ({
        resources: {
          ...resources,
          diagnostics: "updated"
        }
      }),
      resources: {
        diagnostics: "initial"
      },
      tools: {
        inspect: {
          execute: () => "ok"
        }
      }
    })

    expect(modelResources).toEqual([
      {
        diagnostics: "initial"
      },
      {
        diagnostics: "updated"
      }
    ])
  })

  it("lets prepareNextTurn replace the next model and thinking level", async () => {
    const secondModelMessages: AgentLoopMessage[][] = []
    const firstModel: AgentLoopModel = vi.fn(() => ({
      content: "I will inspect first.",
      toolCalls: [
        {
          input: {
            path: "large.log"
          },
          toolCallId: "tool-call-1",
          toolName: "readFile"
        }
      ]
    }))
    const secondModel: AgentLoopModel = vi.fn(({ messages, thinkingLevel }) => {
      secondModelMessages.push(cloneMessages(messages))

      return {
        content: `Second model used ${thinkingLevel}.`,
        toolCalls: []
      }
    })

    const result = await runAgentLoop({
      maxTurns: 5,
      messages: [
        {
          content: "Inspect a large file.",
          role: "user"
        }
      ],
      model: firstModel,
      prepareNextTurn: () => ({
        model: secondModel,
        thinkingLevel: "high"
      }),
      thinkingLevel: "low",
      tools: {
        readFile: {
          execute: () => "large file output"
        }
      }
    })

    expect(firstModel).toHaveBeenCalledTimes(1)
    expect(secondModel).toHaveBeenCalledTimes(1)
    expect(secondModelMessages[0]?.at(-1)).toEqual({
      isError: false,
      output: "large file output",
      role: "tool",
      toolCallId: "tool-call-1",
      toolName: "readFile"
    })
    expect(result.messages.at(-1)).toEqual({
      content: "Second model used high.",
      role: "assistant",
      toolCalls: []
    })
  })

  it("lets prepareNextTurn replace active tool names", async () => {
    const availableToolNamesByTurn: string[][] = []
    const model: AgentLoopModel = vi.fn(({ availableToolNames, messages }) => {
      availableToolNamesByTurn.push([...availableToolNames])

      const toolResultCount = messages.filter(
        (message: AgentLoopMessage) => message.role === "tool"
      ).length

      if (toolResultCount === 0) {
        return {
          content: "I will read first.",
          toolCalls: [
            {
              input: {
                path: "src/main.ts"
              },
              toolCallId: "tool-call-1",
              toolName: "readFile"
            }
          ]
        }
      }

      if (toolResultCount === 1) {
        return {
          content: "I can edit now.",
          toolCalls: [
            {
              input: {
                path: "src/main.ts"
              },
              toolCallId: "tool-call-2",
              toolName: "editFile"
            }
          ]
        }
      }

      return {
        content: "Done.",
        toolCalls: []
      }
    })

    const result = await runAgentLoop({
      activeToolNames: ["readFile"],
      maxTurns: 5,
      messages: [
        {
          content: "Read, then edit.",
          role: "user"
        }
      ],
      model,
      prepareNextTurn: ({ turnIndex }) =>
        turnIndex === 0
          ? {
              activeToolNames: ["editFile"]
            }
          : {},
      tools: {
        editFile: {
          execute: () => "edited"
        },
        readFile: {
          execute: () => "file content"
        }
      }
    })

    expect(availableToolNamesByTurn).toEqual([
      ["readFile"],
      ["editFile"],
      ["editFile"]
    ])
    expect(result.messages.slice(-2)).toEqual([
      {
        isError: false,
        output: "edited",
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "editFile"
      },
      {
        content: "Done.",
        role: "assistant",
        toolCalls: []
      }
    ])
  })

  it("runs a mixed sequential batch in source order", async () => {
    const events: AgentLoopEvent[] = []

    await runAgentLoop({
      maxTurns: 5,
      messages: [
        {
          content: "Run tools.",
          role: "user"
        }
      ],
      model: sequentialBatchModel,
      onEvent: (event) => {
        events.push(event)
      },
      tools: {
        firstTool: {
          execute: () => "first result",
          executionMode: "sequential"
        },
        secondTool: {
          execute: () => "second result"
        }
      }
    })

    expect(
      events
        .filter(
          (event) =>
            event.type === "tool_execution_started" ||
            event.type === "tool_execution_finished"
        )
        .map((event) => `${event.type}:${event.toolCallId}`)
    ).toEqual([
      "tool_execution_started:tool-call-1",
      "tool_execution_finished:tool-call-1",
      "tool_execution_started:tool-call-2",
      "tool_execution_finished:tool-call-2"
    ])
  })

  it("converts hook errors to tool results without aborting the batch", async () => {
    const executeBlockedTool = vi.fn(() => {
      throw new Error("Should not execute before-hook failure.")
    })
    const executeNormalTool = vi.fn(() => "normal result")
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will run a batch with hook failures.",
          toolCalls: [
            {
              input: "before",
              toolCallId: "tool-call-1",
              toolName: "beforeHookFailure"
            },
            {
              input: "after",
              toolCallId: "tool-call-2",
              toolName: "afterHookFailure"
            },
            {
              input: "normal",
              toolCallId: "tool-call-3",
              toolName: "normalTool"
            }
          ]
        }
      }

      return {
        content: "I saw the hook errors.",
        toolCalls: []
      }
    })

    await runAgentLoop({
      afterToolCall: (result) => {
        if (result.toolCall.toolName === "afterHookFailure") {
          throw new Error("after hook failed")
        }

        return {}
      },
      beforeToolCall: (toolCall) => {
        if (toolCall.toolName === "beforeHookFailure") {
          throw new Error("before hook failed")
        }

        return {}
      },
      maxTurns: 5,
      messages: [
        {
          content: "Run a batch.",
          role: "user"
        }
      ],
      model,
      tools: {
        afterHookFailure: {
          execute: () => "raw after output"
        },
        beforeHookFailure: {
          execute: executeBlockedTool
        },
        normalTool: {
          execute: executeNormalTool
        }
      }
    })

    expect(executeBlockedTool).not.toHaveBeenCalled()
    expect(executeNormalTool).toHaveBeenCalled()
    expect(modelMessages[1]?.slice(-3)).toEqual([
      {
        isError: true,
        output: {
          error: "before hook failed"
        },
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "beforeHookFailure"
      },
      {
        isError: true,
        output: {
          error: "after hook failed"
        },
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "afterHookFailure"
      },
      {
        isError: false,
        output: "normal result",
        role: "tool",
        toolCallId: "tool-call-3",
        toolName: "normalTool"
      }
    ])
  })

  it("converts tool execution failures to model-visible tool results", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
        return {
          content: "I will run one failing tool.",
          toolCalls: [
            {
              input: {
                path: "missing.txt"
              },
              toolCallId: "tool-call-1",
              toolName: "readFile"
            }
          ]
        }
      }

      return {
        content: "I can recover from the tool error.",
        toolCalls: []
      }
    })

    const result = await runAgentLoop({
      maxTurns: 5,
      messages: [
        {
          content: "Read a missing file.",
          role: "user"
        }
      ],
      model,
      tools: {
        readFile: {
          execute: () => {
            throw new Error("File does not exist.")
          }
        }
      }
    })

    expect(model).toHaveBeenCalledTimes(2)
    expect(modelMessages[1]?.at(-1)).toEqual({
      isError: true,
      output: {
        error: "File does not exist."
      },
      role: "tool",
      toolCallId: "tool-call-1",
      toolName: "readFile"
    })
    expect(result.stopReason).toBe("final")
  })

  it("settles unstarted sequential tools when the batch is aborted", async () => {
    const abortController = new AbortController()
    const executeSecondTool = vi.fn(() => "second result")
    const model: AgentLoopModel = vi.fn(() => ({
      content: "I will run a sequential batch.",
      toolCalls: [
        {
          input: "first",
          toolCallId: "tool-call-1",
          toolName: "firstTool"
        },
        {
          input: "second",
          toolCallId: "tool-call-2",
          toolName: "secondTool"
        }
      ]
    }))

    const result = await runAgentLoop({
      abortSignal: abortController.signal,
      maxTurns: 5,
      messages: [
        {
          content: "Run tools.",
          role: "user"
        }
      ],
      model,
      tools: {
        firstTool: {
          execute: () => {
            abortController.abort()
            return "first result"
          },
          executionMode: "sequential"
        },
        secondTool: {
          execute: executeSecondTool
        }
      }
    })

    expect(executeSecondTool).not.toHaveBeenCalled()
    expect(result.stopReason).toBe("aborted")
    expect(result.messages.slice(-2)).toEqual([
      {
        isError: false,
        output: "first result",
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "firstTool"
      },
      {
        isError: true,
        output: {
          error: "Agent loop aborted."
        },
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "secondTool"
      }
    ])
  })

  it("settles an in-flight parallel tool when the batch is aborted", async () => {
    const abortController = new AbortController()
    const events: AgentLoopEvent[] = []
    const model: AgentLoopModel = vi.fn(() => ({
      content: "I will run a parallel batch.",
      toolCalls: [
        {
          input: "first",
          toolCallId: "tool-call-1",
          toolName: "stalledTool"
        },
        {
          input: "second",
          toolCallId: "tool-call-2",
          toolName: "fastTool"
        }
      ]
    }))
    const stalledTool = createDeferred<string>()
    const loopPromise = runAgentLoop({
      abortSignal: abortController.signal,
      maxTurns: 5,
      messages: [
        {
          content: "Run tools.",
          role: "user"
        }
      ],
      model,
      onEvent: (event) => {
        events.push(event)
      },
      tools: {
        fastTool: {
          execute: () => "second result"
        },
        stalledTool: {
          execute: () => stalledTool.promise
        }
      }
    })

    await vi.waitFor(() => {
      expect(
        events.filter((event) => event.type === "tool_execution_started")
      ).toHaveLength(2)
    })

    let result: Awaited<ReturnType<typeof runAgentLoop>> | undefined

    void (async () => {
      result = await loopPromise
    })()

    abortController.abort()

    await vi.waitFor(() => {
      expect(result).toBeDefined()
    })

    expect(result).toMatchObject({
      stopReason: "aborted"
    })
    expect(result).toHaveProperty("messages")

    if (!result) {
      return
    }

    expect(result.messages.slice(-2)).toEqual([
      {
        isError: true,
        output: {
          error: "Agent loop aborted."
        },
        role: "tool",
        toolCallId: "tool-call-1",
        toolName: "stalledTool"
      },
      {
        isError: false,
        output: "second result",
        role: "tool",
        toolCallId: "tool-call-2",
        toolName: "fastTool"
      }
    ])
  })
})
