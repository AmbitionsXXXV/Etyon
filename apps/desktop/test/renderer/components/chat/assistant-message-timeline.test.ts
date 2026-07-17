// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import type { DynamicToolUIPart } from "ai"
import { createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { AssistantMessageTimeline } from "@/renderer/components/chat/assistant-message-timeline"
import { clearTodos, setTodos } from "@/renderer/lib/chat/todo-store"

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

const renderTimeline = (
  props: Partial<Parameters<typeof AssistantMessageTimeline>[0]> & {
    message: Parameters<typeof AssistantMessageTimeline>[0]["message"]
  }
): string =>
  renderToStaticMarkup(
    createElement(
      TestI18nProvider,
      { locale: "en-US" },
      createElement(AssistantMessageTimeline, {
        isApprovalActionDisabled: false,
        isRunActive: false,
        isStreamdownAnimating: false,
        onApprovalResponse: vi.fn(),
        onInputToolResult: vi.fn(),
        sessionId: "test-session",
        streamdownAnimation: "none",
        ...props
      })
    )
  )

describe("AssistantMessageTimeline", () => {
  it("aggregates a tool call into a work-section row above the body", () => {
    const parts = [
      {
        input: {
          command: "git diff --cached --stat",
          cwd: "/project"
        },
        output: {
          durationMs: 12,
          exitCode: 0,
          stdoutPreview:
            "23 files changed, 828 insertions(+), 156 deletions(-)",
          truncated: false
        },
        state: "output-available",
        toolCallId: "tool-output",
        toolName: "bash",
        type: "dynamic-tool"
      },
      {
        text: "Here is the staged summary.",
        type: "text"
      }
    ] satisfies [DynamicToolUIPart, { text: string; type: "text" }]
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts,
        role: "assistant"
      }
    })

    expect(html).toContain("Ran a command")
    expect(html).toContain("23 files changed")
    expect(html).toContain("Here is the staged summary.")
  })

  it("keeps approval actions available inside the work section", () => {
    const parts = [
      {
        approval: {
          id: "approval-1"
        },
        input: {
          command:
            "git diff --cached -- apps/desktop/src/main/agents/agent-chat-projection.ts | head -n 60",
          cwd: "/project"
        },
        state: "approval-requested",
        toolCallId: "tool-approval",
        toolName: "bash",
        type: "dynamic-tool"
      }
    ] satisfies DynamicToolUIPart[]
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts,
        role: "assistant"
      }
    })

    expect(html).toContain("Ran a command")
    expect(html).toContain("Approve")
    expect(html).toContain("Deny")
  })

  it("renders reasoning as a collapsed thinking step", () => {
    const parts = [
      {
        text: "I need to inspect the staged files first.",
        type: "reasoning"
      },
      {
        text: "Done.",
        type: "text"
      }
    ] satisfies [
      { text: string; type: "reasoning" },
      { text: string; type: "text" }
    ]
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts,
        role: "assistant"
      }
    })

    expect(html).toContain("Thought")
    expect(html).toContain("I need to inspect the staged files first.")
    expect(html).toContain("Done.")
  })

  it("splits trailing text into the body while keeping intermediate narration in the timeline", () => {
    const parts = [
      {
        text: "Let me check the staged changes.",
        type: "text"
      },
      {
        input: { command: "git status" },
        output: { stdoutPreview: "clean" },
        state: "output-available",
        toolCallId: "tool-1",
        toolName: "bash",
        type: "dynamic-tool"
      },
      {
        text: "Everything looks good.",
        type: "text"
      }
    ] satisfies [
      { text: string; type: "text" },
      DynamicToolUIPart,
      { text: string; type: "text" }
    ]
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts,
        role: "assistant"
      }
    })

    expect(html).toContain("Let me check the staged changes.")
    expect(html).toContain("Ran a command")
    expect(html).toContain("Everything looks good.")
  })

  it("renders the assistant body without a work section when there are no tools or reasoning", () => {
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts: [
          {
            text: "Done.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    })

    expect(html).not.toContain("chain-of-thought")
    expect(html).not.toContain("Thought")
    expect(html).toContain("Done.")
  })

  it("renders a visible notice when the run hit the step limit", () => {
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts: [
          {
            text: "Partial work so far.",
            type: "text"
          },
          {
            data: { maxSteps: 64 },
            type: "data-run-limit"
          }
        ],
        role: "assistant"
      }
    })

    expect(html).toContain("Stopped a likely runaway loop")
    expect(html).toContain("64")
  })

  it("renders markdown tables without the Streamdown table wrapper", () => {
    const html = renderTimeline({
      message: {
        id: "assistant-1",
        parts: [
          {
            text: "| Name | Value |\n| --- | --- |\n| Status | Ready |",
            type: "text"
          }
        ],
        role: "assistant"
      }
    })

    expect(html).toContain("<table")
    expect(html).not.toContain('data-streamdown="table-wrapper"')
    expect(html).not.toContain("Copy table")
  })

  it("adds Streamdown animation spans and a caret while the assistant response streams", () => {
    const html = renderTimeline({
      isRunActive: true,
      isStreamdownAnimating: true,
      message: {
        id: "assistant-1",
        parts: [
          {
            text: "Streaming response text.",
            type: "text"
          }
        ],
        role: "assistant"
      },
      streamdownAnimation: "typewriter"
    })

    expect(html).toContain('data-sd-animate="true"')
    expect(html).toContain("--streamdown-caret")
  })

  it("does not replay Streamdown animation once the response has settled", () => {
    const html = renderTimeline({
      isRunActive: false,
      isStreamdownAnimating: false,
      message: {
        id: "assistant-1",
        parts: [
          {
            text: "Streaming response text.",
            type: "text"
          }
        ],
        role: "assistant"
      },
      streamdownAnimation: "typewriter"
    })

    expect(html).toContain("Streaming response text.")
    expect(html).not.toContain("data-sd-animate")
    expect(html).not.toContain("--streamdown-caret")
  })

  it("does not add Streamdown animation markup while streaming when the animation setting is none", () => {
    const html = renderTimeline({
      isRunActive: true,
      isStreamdownAnimating: true,
      message: {
        id: "assistant-1",
        parts: [
          {
            text: "Streaming response text.",
            type: "text"
          }
        ],
        role: "assistant"
      },
      streamdownAnimation: "none"
    })

    expect(html).toContain("Streaming response text.")
    expect(html).not.toContain("data-sd-animate")
    expect(html).not.toContain("--streamdown-caret")
  })
})

describe("AssistantMessageTimeline todo suppression", () => {
  const todoMessage = {
    id: "assistant-1",
    metadata: {
      agentProjection: { runId: "run-live", source: "agent_events" }
    },
    parts: [
      {
        input: {
          todos: [{ content: "Set up the store", status: "in_progress" }]
        },
        state: "output-available",
        toolCallId: "todo-1",
        toolName: "todo_write",
        type: "dynamic-tool"
      }
    ],
    role: "assistant"
  } as unknown as Parameters<typeof renderTimeline>[0]["message"]

  afterEach(() => {
    clearTodos()
  })

  it("suppresses the timeline checklist while the run streams live todos", () => {
    // The live copy is anchored to the composer's plan queue instead — showing
    // it here too would double-render the same list.
    setTodos("run-live", [
      { content: "Set up the store", status: "in_progress" }
    ])
    const html = renderTimeline({ isRunActive: true, message: todoMessage })

    expect(html).not.toContain("Todos")
    expect(html).not.toContain("Set up the store")
  })

  it("still suppresses across an approval pause while live todos remain, even though the run is inactive", () => {
    // The gate is purely live-todos-based: a run parked on a tool approval
    // reaches the inactive state but keeps its live checklist, so the composer
    // strip stays authoritative and the timeline copy must not reappear.
    setTodos("run-live", [
      { content: "Set up the store", status: "in_progress" }
    ])
    const html = renderTimeline({ isRunActive: false, message: todoMessage })

    expect(html).not.toContain("Todos")
    expect(html).not.toContain("Set up the store")
  })

  it("shows the persisted checklist once the live snapshot is cleared", () => {
    // Store empty for this run (settled turn / history): fall back to the
    // persisted tool-call input regardless of run-active state.
    const html = renderTimeline({ isRunActive: false, message: todoMessage })

    expect(html).toContain("Todos")
    expect(html).toContain("Set up the store")
  })

  it("keeps the persisted checklist on the live first frame before a snapshot arrives", () => {
    // Run active but the store is still empty for this run: the guard is on live
    // todos existing, not run-active state, so the list must not blink out.
    const html = renderTimeline({ isRunActive: true, message: todoMessage })

    expect(html).toContain("Todos")
    expect(html).toContain("Set up the store")
  })
})
