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

  it("does not continue after server-side agent tool calls have output", () => {
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

    expect(shouldSendChatAutomatically({ messages })).toBe(false)
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

  it("continues once a trailing ask_user question has an answer", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          { type: "step-start" },
          {
            input: {
              options: [{ label: "SQLite" }, { label: "Postgres" }],
              question: "选哪个存储?"
            },
            output: { custom: null, selected: ["SQLite"] },
            state: "output-available",
            toolCallId: "tool-call-1",
            type: "tool-ask_user"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(true)
  })

  it("continues once a trailing propose_plan call has a decision", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            input: { plan: "1. do it", title: "小计划" },
            output: { decision: "implement" },
            state: "output-available",
            toolCallId: "tool-call-1",
            type: "tool-propose_plan"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(true)
  })

  it("waits while an input-required question is still unanswered", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            input: {
              options: [{ label: "A" }, { label: "B" }],
              question: "选哪个?"
            },
            state: "input-available",
            toolCallId: "tool-call-1",
            type: "tool-ask_user"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(false)
  })

  it("does not re-fire after the model resumed past an answered question", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            input: {
              options: [{ label: "A" }, { label: "B" }],
              question: "选哪个?"
            },
            output: { custom: null, selected: ["A"] },
            state: "output-available",
            toolCallId: "tool-call-1",
            type: "tool-ask_user"
          },
          { type: "step-start" },
          {
            text: "按 A 出方案。",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(false)
  })

  it("waits when an answered question coexists with a pending approval", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            approval: { id: "approval-1" },
            input: { command: "echo pending" },
            state: "approval-requested",
            toolCallId: "tool-call-1",
            type: "tool-runCheck"
          },
          {
            input: {
              options: [{ label: "A" }, { label: "B" }],
              question: "选哪个?"
            },
            output: { custom: null, selected: ["A"] },
            state: "output-available",
            toolCallId: "tool-call-2",
            type: "tool-ask_user"
          }
        ],
        role: "assistant"
      }
    ] satisfies UIMessage[]

    expect(shouldSendChatAutomatically({ messages })).toBe(false)
  })
})
