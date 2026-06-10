// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import type { DynamicToolUIPart } from "ai"
import { createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vite-plus/test"

import { AssistantMessageTimeline } from "@/renderer/components/chat/assistant-message-timeline"

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

describe("AssistantMessageTimeline", () => {
  it("renders tool parts inside a single chain-of-thought block above the body", () => {
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
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          isApprovalActionDisabled: false,
          isStreamdownAnimating: false,
          message: {
            id: "assistant-1",
            parts,
            role: "assistant"
          },
          onApprovalResponse: vi.fn(),
          streamdownAnimation: "none"
        })
      )
    )

    expect(html).toContain("Thinking")
    expect(html).toContain("23 files changed")
    expect(html).toContain("Here is the staged summary.")
  })

  it("keeps approval actions available inside the chain of thought", () => {
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
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          isApprovalActionDisabled: false,
          isStreamdownAnimating: false,
          message: {
            id: "assistant-1",
            parts,
            role: "assistant"
          },
          onApprovalResponse: vi.fn(),
          streamdownAnimation: "none"
        })
      )
    )

    expect(html).toContain("Thinking")
    expect(html).toContain("Approve")
    expect(html).toContain("Deny")
  })

  it("renders reasoning parts as chain-of-thought steps", () => {
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
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          isApprovalActionDisabled: false,
          isStreamdownAnimating: false,
          message: {
            id: "assistant-1",
            parts,
            role: "assistant"
          },
          onApprovalResponse: vi.fn(),
          streamdownAnimation: "none"
        })
      )
    )

    expect(html).toContain("Thinking")
    expect(html).toContain("I need to inspect the staged files first.")
    expect(html).toContain("Done.")
  })

  it("renders the assistant body without a chain of thought when there are no tools or reasoning", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          isApprovalActionDisabled: false,
          isStreamdownAnimating: false,
          message: {
            id: "assistant-1",
            parts: [
              {
                text: "Done.",
                type: "text"
              }
            ],
            role: "assistant"
          },
          onApprovalResponse: vi.fn(),
          streamdownAnimation: "none"
        })
      )
    )

    expect(html).not.toContain("Thinking")
    expect(html).toContain("Done.")
  })

  it("renders markdown tables without the Streamdown table wrapper", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          isApprovalActionDisabled: false,
          isStreamdownAnimating: false,
          message: {
            id: "assistant-1",
            parts: [
              {
                text: "| Name | Value |\n| --- | --- |\n| Status | Ready |",
                type: "text"
              }
            ],
            role: "assistant"
          },
          onApprovalResponse: vi.fn(),
          streamdownAnimation: "none"
        })
      )
    )

    expect(html).toContain("<table")
    expect(html).not.toContain('data-streamdown="table-wrapper"')
    expect(html).not.toContain("Copy table")
  })

  it("does not add Streamdown animation spans while the assistant response streams", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          isApprovalActionDisabled: false,
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
          onApprovalResponse: vi.fn(),
          streamdownAnimation: "typewriter"
        })
      )
    )

    expect(html).not.toContain("data-sd-animate")
    expect(html).not.toContain("--streamdown-caret")
  })
})
