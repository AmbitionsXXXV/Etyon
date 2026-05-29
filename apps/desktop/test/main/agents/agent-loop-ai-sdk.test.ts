import { tool } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"
import { z } from "zod"

import {
  createAiSdkAgentLoopModel,
  createAiSdkAgentLoopTools
} from "@/main/agents/agent-loop-ai-sdk"

import {
  createFauxGenerateToolCallResponse,
  createFauxToolCallResponse,
  createFauxProvider
} from "./faux-provider"

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
})
