import { describe, expect, it, vi } from "vite-plus/test"

import { AgentRuntimeError, createAgent } from "@/main/agents/agent"
import type { AgentSnapshot } from "@/main/agents/agent"
import type { AgentLoopMessage, AgentLoopModel } from "@/main/agents/agent-loop"

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

const initialAgentModel: AgentLoopModel = () => ({
  content: "initial",
  toolCalls: []
})

const listenerSafeAgentModel: AgentLoopModel = () => ({
  content: "Done.",
  toolCalls: []
})

const longToolAgentModel: AgentLoopModel = () => ({
  content: "I will run a long tool.",
  toolCalls: [
    {
      input: {},
      toolCallId: "tool-call-1",
      toolName: "longTool"
    }
  ]
})

describe("agent", () => {
  it("stores prompt results and continues from previous messages", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      return {
        content: `turn ${modelMessages.length}`,
        toolCalls: []
      }
    })
    const snapshots: AgentSnapshot[] = []
    const agent = createAgent({
      maxTurns: 2,
      model,
      systemPrompt: "You are an agent.",
      tools: {}
    })

    agent.subscribe((snapshot) => {
      snapshots.push(snapshot)
    })

    const firstResult = await agent.prompt("Start.")
    const secondResult = await agent.continue()

    expect(firstResult.stopReason).toBe("final")
    expect(secondResult.stopReason).toBe("final")
    expect(modelMessages).toEqual([
      [
        {
          content: "You are an agent.",
          role: "system"
        },
        {
          content: "Start.",
          role: "user"
        }
      ],
      [
        {
          content: "You are an agent.",
          role: "system"
        },
        {
          content: "Start.",
          role: "user"
        },
        {
          content: "turn 1",
          role: "assistant",
          toolCalls: []
        }
      ]
    ])
    expect(agent.getSnapshot().messages).toEqual([
      {
        content: "Start.",
        role: "user"
      },
      {
        content: "turn 1",
        role: "assistant",
        toolCalls: []
      },
      {
        content: "turn 2",
        role: "assistant",
        toolCalls: []
      }
    ])
    expect(snapshots.at(-1)?.phase).toBe("idle")
  })

  it("applies mutators to the next turn", async () => {
    const nextModel: AgentLoopModel = vi.fn(({ messages, thinkingLevel }) => ({
      content: `${messages[0]?.content ?? ""} / ${thinkingLevel ?? ""}`,
      toolCalls: []
    }))
    const agent = createAgent({
      maxTurns: 1,
      model: initialAgentModel,
      systemPrompt: "Initial system.",
      tools: {}
    })

    await agent.prompt("Start.")
    agent.setModel(nextModel)
    agent.setSystemPrompt("Next system.")
    agent.setThinkingLevel("high")
    await agent.continue()

    expect(nextModel).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      availableToolNames: [],
      messages: [
        {
          content: "Next system.",
          role: "system"
        },
        {
          content: "Start.",
          role: "user"
        },
        {
          content: "initial",
          role: "assistant",
          toolCalls: []
        }
      ],
      resources: undefined,
      thinkingLevel: "high",
      turnIndex: 0
    })
    expect(agent.getSnapshot().messages.at(-1)).toEqual({
      content: "Next system. / high",
      role: "assistant",
      toolCalls: []
    })
  })

  it("applies grouped settings updates to the next turn", async () => {
    const nextModel: AgentLoopModel = vi.fn(
      ({ availableToolNames, messages, resources, thinkingLevel }) => ({
        content: [
          messages[0]?.content,
          thinkingLevel,
          (resources as { diagnostics?: string } | undefined)?.diagnostics,
          availableToolNames.join(",")
        ].join(" / "),
        toolCalls: []
      })
    )
    const agent = createAgent({
      activeToolNames: ["readFile"],
      maxTurns: 1,
      model: initialAgentModel,
      resources: {
        diagnostics: "initial"
      },
      systemPrompt: "Initial system.",
      thinkingLevel: "low",
      tools: {
        editFile: {
          execute: () => "edited"
        },
        readFile: {
          execute: () => "file content"
        }
      }
    })

    await agent.prompt("Start.")
    agent.setSettings({
      activeToolNames: ["editFile"],
      model: nextModel,
      resources: {
        diagnostics: "updated"
      },
      systemPrompt: "Next system.",
      thinkingLevel: "medium",
      tools: {
        editFile: {
          execute: () => "edited"
        }
      }
    })
    await agent.continue()

    expect(nextModel).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      availableToolNames: ["editFile"],
      messages: [
        {
          content: "Next system.",
          role: "system"
        },
        {
          content: "Start.",
          role: "user"
        },
        {
          content: "initial",
          role: "assistant",
          toolCalls: []
        }
      ],
      resources: {
        diagnostics: "updated"
      },
      thinkingLevel: "medium",
      turnIndex: 0
    })
    expect(agent.getSnapshot()).toMatchObject({
      activeToolNames: ["editFile"],
      resources: {
        diagnostics: "updated"
      },
      systemPrompt: "Next system.",
      thinkingLevel: "medium"
    })

    agent.setSettings({
      activeToolNames: null,
      resources: null,
      thinkingLevel: null
    })

    expect(agent.getSnapshot()).toMatchObject({
      activeToolNames: undefined,
      resources: undefined,
      thinkingLevel: undefined
    })
  })

  it("applies in-flight resource changes to the next loop turn", async () => {
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
    const agent = createAgent({
      maxTurns: 3,
      model,
      resources: {
        diagnostics: "initial"
      },
      tools: {
        inspect: {
          execute: () => {
            agent.setResources({
              diagnostics: "updated"
            })

            return "ok"
          }
        }
      }
    })

    expect(agent.getSnapshot().resources).toEqual({
      diagnostics: "initial"
    })

    await agent.prompt("Start.")

    expect(modelResources).toEqual([
      {
        diagnostics: "initial"
      },
      {
        diagnostics: "updated"
      }
    ])
    expect(agent.getSnapshot().resources).toEqual({
      diagnostics: "updated"
    })
  })

  it("keeps in-flight system prompt isolated from later mutators", async () => {
    const deferredTurn = createDeferred<{
      content: string
      toolCalls: []
    }>()
    const model: AgentLoopModel = vi.fn(() => deferredTurn.promise)
    const agent = createAgent({
      maxTurns: 1,
      model,
      systemPrompt: "Initial system.",
      tools: {}
    })
    const promptPromise = agent.prompt("Start.")

    await vi.waitFor(() => {
      expect(model).toHaveBeenCalledTimes(1)
    })

    agent.setSystemPrompt("Next system.")
    deferredTurn.resolve({
      content: "Done.",
      toolCalls: []
    })
    await promptPromise

    expect(agent.getSnapshot().messages).toEqual([
      {
        content: "Start.",
        role: "user"
      },
      {
        content: "Done.",
        role: "assistant",
        toolCalls: []
      }
    ])
  })

  it("applies in-flight system prompt changes to the next loop turn", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
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

    const agent = createAgent({
      maxTurns: 3,
      model,
      systemPrompt: "Initial system.",
      tools: {
        inspect: {
          execute: () => {
            agent.setSystemPrompt("Next system.")

            return "ok"
          }
        }
      }
    })

    await agent.prompt("Start.")

    expect(modelMessages[0]?.[0]).toEqual({
      content: "Initial system.",
      role: "system"
    })
    expect(modelMessages[1]?.[0]).toEqual({
      content: "Next system.",
      role: "system"
    })
    expect(agent.getSnapshot().messages[0]).toEqual({
      content: "Start.",
      role: "user"
    })
  })

  it("applies in-flight tool changes to the next loop turn", async () => {
    const model: AgentLoopModel = vi.fn(({ turnIndex }) => {
      if (turnIndex === 0) {
        return {
          content: "Use the initial tool.",
          toolCalls: [
            {
              input: {},
              toolCallId: "tool-call-1",
              toolName: "initialTool"
            }
          ]
        }
      }

      if (turnIndex === 1) {
        return {
          content: "Use the next tool.",
          toolCalls: [
            {
              input: {},
              toolCallId: "tool-call-2",
              toolName: "nextTool"
            }
          ]
        }
      }

      return {
        content: "Done.",
        toolCalls: []
      }
    })
    const agent = createAgent({
      maxTurns: 3,
      model,
      tools: {
        initialTool: {
          execute: () => {
            agent.setTools({
              nextTool: {
                execute: () => "next ok"
              }
            })

            return "initial ok"
          }
        }
      }
    })

    const result = await agent.prompt("Start.")

    expect(result.messages).toContainEqual({
      isError: false,
      output: "next ok",
      role: "tool",
      toolCallId: "tool-call-2",
      toolName: "nextTool"
    })
  })

  it("applies active tool name changes to the next turn", async () => {
    const availableToolNamesByTurn: string[][] = []
    const model: AgentLoopModel = vi.fn(({ availableToolNames }) => {
      availableToolNamesByTurn.push([...availableToolNames])

      return {
        content: `Available: ${availableToolNames.join(",")}`,
        toolCalls: []
      }
    })
    const agent = createAgent({
      activeToolNames: ["readFile"],
      maxTurns: 1,
      model,
      tools: {
        editFile: {
          execute: () => "edited"
        },
        readFile: {
          execute: () => "file content"
        }
      }
    })

    await agent.prompt("Start.")
    agent.setActiveToolNames(["editFile"])
    await agent.continue()

    expect(availableToolNamesByTurn).toEqual([["readFile"], ["editFile"]])
    expect(agent.getSnapshot().activeToolNames).toEqual(["editFile"])
  })

  it("settles listener errors without failing turns or mutator notifications", async () => {
    const agent = createAgent({
      maxTurns: 1,
      model: listenerSafeAgentModel,
      tools: {}
    })

    agent.subscribe(() => {
      throw new Error("listener failed")
    })

    await expect(agent.prompt("Start.")).resolves.toMatchObject({
      stopReason: "final"
    })

    expect(() => {
      agent.setModel(listenerSafeAgentModel)
    }).not.toThrow()
  })

  it("rejects event listener failures as typed hook errors", async () => {
    const eventError = new Error("event sink failed")
    const agent = createAgent({
      maxTurns: 1,
      model: listenerSafeAgentModel,
      onEvent: (event) => {
        if (event.type === "agent_turn_started") {
          throw eventError
        }
      },
      tools: {}
    })
    let caughtError: unknown

    try {
      await agent.prompt("Start.")
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(AgentRuntimeError)
    expect(caughtError).toMatchObject({
      code: "hook",
      message: "Agent event listener failed."
    })
    expect((caughtError as AgentRuntimeError).cause).toBe(eventError)
    await expect(agent.waitForIdle()).resolves.toBeUndefined()
  })

  it("rejects concurrent structural turns without appending the rejected prompt", async () => {
    const deferredTurn = createDeferred<{
      content: string
      toolCalls: []
    }>()
    const model: AgentLoopModel = vi.fn(() => deferredTurn.promise)
    const agent = createAgent({
      maxTurns: 1,
      model,
      tools: {}
    })
    const promptPromise = agent.prompt("First.")

    await vi.waitFor(() => {
      expect(model).toHaveBeenCalledTimes(1)
    })

    await expect(agent.prompt("Second.")).rejects.toEqual(
      new AgentRuntimeError("busy", "Agent runtime is busy.")
    )

    deferredTurn.resolve({
      content: "Done.",
      toolCalls: []
    })
    await promptPromise

    expect(agent.getSnapshot().messages).toEqual([
      {
        content: "First.",
        role: "user"
      },
      {
        content: "Done.",
        role: "assistant",
        toolCalls: []
      }
    ])
  })

  it("aborts the active turn", async () => {
    const toolAborted = createDeferred<string>()
    const toolStarted = createDeferred<null>()
    const agent = createAgent({
      maxTurns: 3,
      model: longToolAgentModel,
      tools: {
        longTool: {
          execute: (_input, { abortSignal }) => {
            toolStarted.resolve(null)
            abortSignal?.addEventListener(
              "abort",
              () => {
                toolAborted.resolve("aborted")
              },
              {
                once: true
              }
            )

            return toolAborted.promise
          }
        }
      }
    })
    const promptPromise = agent.prompt("Start long work.")

    await toolStarted.promise
    agent.abort()

    await expect(promptPromise).resolves.toMatchObject({
      stopReason: "aborted"
    })
  })

  it("waits for active turns and async agent subscribers to settle", async () => {
    const deferredTurn = createDeferred<{
      content: string
      toolCalls: []
    }>()
    const idleListenerDone = createDeferred<null>()
    const model: AgentLoopModel = vi.fn(() => deferredTurn.promise)
    const agent = createAgent({
      maxTurns: 1,
      model,
      tools: {}
    })
    let resolved = false

    agent.subscribe(async (snapshot) => {
      if (snapshot.phase === "idle") {
        await idleListenerDone.promise
      }
    })

    const promptPromise = agent.prompt("Start.")

    await vi.waitFor(() => {
      expect(model).toHaveBeenCalledTimes(1)
    })

    const idlePromise = agent.waitForIdle()

    idlePromise.then(() => {
      resolved = true
    })
    deferredTurn.resolve({
      content: "Done.",
      toolCalls: []
    })
    await Promise.resolve()

    expect(resolved).toBe(false)

    idleListenerDone.resolve(null)
    await idlePromise

    expect(resolved).toBe(true)
    await promptPromise
  })

  it("drains queued follow-up messages after a final assistant turn", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      return {
        content: `answer ${modelMessages.length}`,
        toolCalls: []
      }
    })
    const agent = createAgent({
      maxTurns: 3,
      model,
      tools: {}
    })

    agent.followUp("Continue.")
    await agent.prompt("Start.")

    expect(model).toHaveBeenCalledTimes(2)
    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "Continue.",
      role: "user"
    })
    expect(agent.getSnapshot().messages).toEqual([
      {
        content: "Start.",
        role: "user"
      },
      {
        content: "answer 1",
        role: "assistant",
        toolCalls: []
      },
      {
        content: "Continue.",
        role: "user"
      },
      {
        content: "answer 2",
        role: "assistant",
        toolCalls: []
      }
    ])
  })

  it("drains queued steering messages after a tool batch", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
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
    const agent = createAgent({
      maxTurns: 3,
      model,
      tools: {
        inspect: {
          execute: () => "ok"
        }
      }
    })

    agent.steer("Prefer concise output.")
    await agent.prompt("Start.")

    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "Prefer concise output.",
      role: "user"
    })
  })

  it("can drain queued steering messages one at a time", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length <= 2) {
        return {
          content: `Inspect ${modelMessages.length}.`,
          toolCalls: [
            {
              input: {},
              toolCallId: `tool-call-${modelMessages.length}`,
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
    const agent = createAgent({
      maxTurns: 5,
      model,
      steeringDrainMode: "one-at-a-time",
      tools: {
        inspect: {
          execute: () => "ok"
        }
      }
    })

    agent.steer("First steering note.")
    agent.steer("Second steering note.")
    await agent.prompt("Start.")

    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "First steering note.",
      role: "user"
    })
    expect(modelMessages[2]?.at(-1)).toEqual({
      content: "Second steering note.",
      role: "user"
    })
  })

  it("can drain queued follow-up messages one at a time", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      return {
        content: `answer ${modelMessages.length}`,
        toolCalls: []
      }
    })
    const agent = createAgent({
      followUpDrainMode: "one-at-a-time",
      maxTurns: 5,
      model,
      tools: {}
    })

    agent.followUp("First follow-up.")
    agent.followUp("Second follow-up.")
    await agent.prompt("Start.")

    expect(model).toHaveBeenCalledTimes(3)
    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "First follow-up.",
      role: "user"
    })
    expect(modelMessages[2]?.at(-1)).toEqual({
      content: "Second follow-up.",
      role: "user"
    })
  })

  it("replays initial queued follow-up messages", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      return {
        content: `answer ${modelMessages.length}`,
        toolCalls: []
      }
    })
    const agent = createAgent({
      initialQueuedMessages: [
        {
          content: "Recovered follow-up.",
          queue: "follow-up"
        }
      ],
      maxTurns: 3,
      model,
      tools: {}
    })

    await agent.prompt("Start.")

    expect(model).toHaveBeenCalledTimes(2)
    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "Recovered follow-up.",
      role: "user"
    })
  })

  it("replays initial queued steering messages", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      if (modelMessages.length === 1) {
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
    const agent = createAgent({
      initialQueuedMessages: [
        {
          content: "Recovered steering.",
          queue: "steer"
        }
      ],
      maxTurns: 3,
      model,
      tools: {
        inspect: {
          execute: () => "ok"
        }
      }
    })

    await agent.prompt("Start.")

    expect(modelMessages[1]?.at(-1)).toEqual({
      content: "Recovered steering.",
      role: "user"
    })
  })

  it("waits for queued message write callbacks to settle", async () => {
    const writeDone = createDeferred<null>()
    const queuedWrites: string[] = []
    const agent = createAgent({
      maxTurns: 1,
      model: initialAgentModel,
      onQueuedMessage: async ({ content, queue }) => {
        queuedWrites.push(`${queue}:${content}`)
        await writeDone.promise
      },
      tools: {}
    })
    let resolved = false

    agent.steer("Guide next tool turn.")

    const idlePromise = agent.waitForIdle()

    void (async () => {
      await idlePromise
      resolved = true
    })()
    await Promise.resolve()

    expect(queuedWrites).toEqual(["steer:Guide next tool turn."])
    expect(resolved).toBe(false)

    writeDone.resolve(null)
    await idlePromise

    expect(resolved).toBe(true)
  })

  it("prompts from a template invocation", async () => {
    const modelMessages: AgentLoopMessage[][] = []
    const model: AgentLoopModel = vi.fn(({ messages }) => {
      modelMessages.push(cloneMessages(messages))

      return {
        content: "templated",
        toolCalls: []
      }
    })
    const agent = createAgent({
      maxTurns: 1,
      model,
      tools: {}
    })

    await agent.promptFromTemplate(
      {
        body: "Review $1 against $2.",
        description: "Review task",
        name: "review",
        path: "/templates/review.md"
      },
      ["current diff", "doc/agents.md"]
    )

    expect(modelMessages[0]?.[0]).toEqual({
      content: [
        "<prompt_template>",
        "<name>review</name>",
        "<description>Review task</description>",
        "<path>/templates/review.md</path>",
        "<content>",
        "Review current diff against doc/agents.md.",
        "</content>",
        "</prompt_template>"
      ].join("\n"),
      role: "user"
    })
  })
})
