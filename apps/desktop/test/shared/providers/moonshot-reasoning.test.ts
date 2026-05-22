import type { ModelMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  buildMoonshotReasoningForAssistantToolCalls,
  patchMoonshotChatCompletionRequestBody,
  runWithMoonshotReasoningContext
} from "@/shared/providers/moonshot-reasoning"

describe("moonshot-reasoning", () => {
  it("adds reasoning_content to assistant tool-call messages missing it", () => {
    const patchedBody = patchMoonshotChatCompletionRequestBody(
      {
        messages: [
          { content: "hello", role: "user" },
          {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                function: { arguments: "{}", name: "searchFiles" },
                id: "call-1",
                type: "function"
              }
            ]
          }
        ],
        model: "kimi-k2.5"
      },
      []
    )

    const [, assistantMessage] = patchedBody.messages as Record<
      string,
      unknown
    >[]

    expect(assistantMessage?.reasoning_content).toBe(".")
  })

  it("preserves existing reasoning_content", () => {
    const patchedBody = patchMoonshotChatCompletionRequestBody(
      {
        messages: [
          {
            content: "",
            reasoning_content: "existing chain of thought",
            role: "assistant",
            tool_calls: [
              {
                function: { arguments: "{}", name: "searchFiles" },
                id: "call-1",
                type: "function"
              }
            ]
          }
        ]
      },
      []
    )

    const [assistantMessage] = patchedBody.messages as Record<string, unknown>[]

    expect(assistantMessage?.reasoning_content).toBe(
      "existing chain of thought"
    )
  })

  it("maps reasoning parts from assistant tool-call turns in order", async () => {
    const modelMessages: ModelMessage[] = [
      { content: "hello", role: "user" },
      {
        content: [
          { text: "Let me inspect the repo first.", type: "reasoning" },
          {
            input: { query: "providers" },
            toolCallId: "call-1",
            toolName: "searchFiles",
            type: "tool-call"
          }
        ],
        role: "assistant"
      }
    ]
    const reasoningForAssistantToolCalls =
      buildMoonshotReasoningForAssistantToolCalls(modelMessages)

    await runWithMoonshotReasoningContext(
      reasoningForAssistantToolCalls,
      () => {
        const patchedBody = patchMoonshotChatCompletionRequestBody({
          messages: [
            { content: "hello", role: "user" },
            {
              content: "",
              role: "assistant",
              tool_calls: [
                {
                  function: {
                    arguments: '{"query":"providers"}',
                    name: "searchFiles"
                  },
                  id: "call-1",
                  type: "function"
                }
              ]
            }
          ]
        })

        const [, assistantMessage] = patchedBody.messages as Record<
          string,
          unknown
        >[]

        expect(assistantMessage?.reasoning_content).toBe(
          "Let me inspect the repo first."
        )

        return Promise.resolve()
      }
    )
  })
})
