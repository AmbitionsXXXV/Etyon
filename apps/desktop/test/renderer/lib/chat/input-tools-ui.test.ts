import { describe, expect, it, vi } from "vite-plus/test"

import type { ChatToolPart } from "@/renderer/lib/chat/assistant-message-timeline"
import {
  formatAskUserAnswer,
  getAskUserCardInput,
  getAskUserCardOutput,
  getProposePlanCardDecision,
  getProposePlanCardInput,
  isInputRequiredToolPart,
  respondToAssistantInputTool
} from "@/renderer/lib/chat/input-tools-ui"

const part = (overrides: Record<string, unknown>): ChatToolPart =>
  ({
    state: "input-available",
    toolCallId: "call-1",
    type: "tool-ask_user",
    ...overrides
  }) as unknown as ChatToolPart

describe("isInputRequiredToolPart", () => {
  it("matches the ask_user and propose_plan part types", () => {
    expect(isInputRequiredToolPart(part({ type: "tool-ask_user" }))).toBe(true)
    expect(isInputRequiredToolPart(part({ type: "tool-propose_plan" }))).toBe(
      true
    )
  })

  it("does not match ordinary tool parts", () => {
    expect(
      isInputRequiredToolPart(part({ toolName: "bash", type: "tool-bash" }))
    ).toBe(false)
  })
})

describe("ask_user readers", () => {
  it("tolerantly reads a question with labelled options", () => {
    expect(
      getAskUserCardInput(
        part({
          input: {
            multiSelect: true,
            options: [
              { description: "keep it", label: "Postgres" },
              { label: "SQLite" },
              { label: "" }
            ],
            question: "Which store?"
          }
        })
      )
    ).toEqual({
      multiSelect: true,
      options: [
        { description: "keep it", label: "Postgres" },
        { description: undefined, label: "SQLite" }
      ],
      question: "Which store?"
    })
  })

  it("returns null when the question is missing", () => {
    expect(getAskUserCardInput(part({ input: { options: [] } }))).toBeNull()
  })

  it("reads the answer output", () => {
    expect(
      getAskUserCardOutput(
        part({
          output: { custom: null, selected: ["Postgres", 7] },
          state: "output-available"
        })
      )
    ).toEqual({ custom: null, selected: ["Postgres"] })
  })
})

describe("propose_plan readers", () => {
  it("reads the plan title and markdown", () => {
    expect(
      getProposePlanCardInput(
        part({
          input: { plan: "1. do it", title: "Ship it" },
          type: "tool-propose_plan"
        })
      )
    ).toEqual({ plan: "1. do it", title: "Ship it" })
  })

  it("reads a valid decision only", () => {
    expect(
      getProposePlanCardDecision(
        part({ output: { decision: "implement" }, state: "output-available" })
      )
    ).toBe("implement")
    expect(
      getProposePlanCardDecision(
        part({ output: { decision: "maybe" }, state: "output-available" })
      )
    ).toBeNull()
  })
})

describe("formatAskUserAnswer", () => {
  it("joins selected labels", () => {
    expect(formatAskUserAnswer({ custom: null, selected: ["A", "B"] })).toBe(
      "A, B"
    )
  })

  it("appends custom text after selections", () => {
    expect(
      formatAskUserAnswer({ custom: "  own idea  ", selected: ["A"] })
    ).toBe("A, own idea")
  })

  it("uses custom text alone", () => {
    expect(formatAskUserAnswer({ custom: "own idea", selected: [] })).toBe(
      "own idea"
    )
  })
})

const buildChatRequestOptions = (mentions: unknown[], mode?: string) => ({
  body: { agentMode: mode ?? "plan", mentions }
})

describe("respondToAssistantInputTool", () => {
  it("answers a pending tool with addToolResult and resume options", () => {
    const addToolResult = vi.fn()

    const handled = respondToAssistantInputTool({
      addToolResult: addToolResult as never,
      buildChatRequestOptions: buildChatRequestOptions as never,
      latestUserMentions: [],
      output: { custom: "hi", selected: [] },
      part: part({ toolCallId: "call-9" })
    })

    expect(handled).toBe(true)
    expect(addToolResult).toHaveBeenCalledWith({
      options: { body: { agentMode: "plan", mentions: [] } },
      output: { custom: "hi", selected: [] },
      tool: "ask_user",
      toolCallId: "call-9"
    })
  })

  it("threads the agent-mode override into the resume options", () => {
    const addToolResult = vi.fn()

    respondToAssistantInputTool({
      addToolResult: addToolResult as never,
      buildChatRequestOptions: buildChatRequestOptions as never,
      latestUserMentions: [],
      modeOverride: "agent",
      output: { decision: "implement" },
      part: part({ toolCallId: "call-3", type: "tool-propose_plan" })
    })

    expect(addToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { body: { agentMode: "agent", mentions: [] } },
        tool: "propose_plan"
      })
    )
  })

  it("ignores a tool that is not awaiting input", () => {
    const addToolResult = vi.fn()

    const handled = respondToAssistantInputTool({
      addToolResult: addToolResult as never,
      buildChatRequestOptions: buildChatRequestOptions as never,
      latestUserMentions: [],
      output: { custom: null, selected: [] },
      part: part({ state: "output-available" })
    })

    expect(handled).toBe(false)
    expect(addToolResult).not.toHaveBeenCalled()
  })
})
