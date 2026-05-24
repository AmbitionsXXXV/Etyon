import type { UIMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import { shouldSendChatAutomatically } from "@/renderer/lib/chat/auto-send"

describe("shouldSendChatAutomatically", () => {
  it("continues the stream after a tool approval response", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            approval: {
              approved: true,
              id: "approval-1"
            },
            input: {
              command: "echo approved"
            },
            state: "approval-responded",
            toolCallId: "tool-call-1",
            type: "tool-runCheck"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(true)
  })

  it("waits until every approval request in the assistant step has a response", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            approval: {
              approved: true,
              id: "approval-1"
            },
            input: {
              command: "echo approved"
            },
            state: "approval-responded",
            toolCallId: "tool-call-1",
            type: "tool-runCheck"
          },
          {
            approval: {
              id: "approval-2"
            },
            input: {
              command: "echo pending"
            },
            state: "approval-requested",
            toolCallId: "tool-call-2",
            type: "tool-runCheck"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(false)
  })

  it("continues after all tool calls in the last assistant step have output", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            type: "step-start"
          },
          {
            input: {
              path: "src/main.ts"
            },
            output: {
              content: "export const value = 1"
            },
            state: "output-available",
            toolCallId: "tool-call-1",
            type: "tool-readFile"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(true)
  })

  it("does not continue for assistant text without pending tool work", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            text: "Done.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(false)
  })
})
