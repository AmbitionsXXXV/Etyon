// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import type { DynamicToolUIPart } from "ai"
import { act, createElement, Fragment } from "react"
import type { ReactElement, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vite-plus/test"

import { StructuredToolTraceCard } from "@/renderer/components/chat/message-tool-trace"
import { compactStructuredToolTraceParts } from "@/renderer/lib/chat/message-tool-trace"

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

const renderElementInDom = (
  element: ReactElement
): {
  cleanup: () => void
  container: HTMLDivElement
  root: Root
} => {
  const container = document.createElement("div")
  const root = createRoot(container)

  document.body.append(container)
  act(() => {
    root.render(element)
  })

  return {
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
    container,
    root
  }
}

const findButtonByText = (
  container: HTMLElement,
  text: string
): HTMLButtonElement => {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text)
  )

  if (!button) {
    throw new Error(`Button not found: ${text}`)
  }

  return button
}

const renderStructuredToolTraceCards = (
  parts: readonly DynamicToolUIPart[],
  onApprovalResponse: (...args: unknown[]) => void
): ReactElement =>
  createElement(
    TestI18nProvider,
    { locale: "en-US" },
    createElement(
      Fragment,
      null,
      ...compactStructuredToolTraceParts(parts as never).map(
        ({ part, repeatCount }) =>
          createElement(StructuredToolTraceCard, {
            isApprovalActionDisabled: false,
            key: (part as DynamicToolUIPart).toolCallId,
            onApprovalResponse,
            part: part as never,
            repeatCount
          })
      )
    )
  )

// TESTS_ANCHOR

describe("StructuredToolTraceCard", () => {
  it("renders tool part states for streaming, approval, output, and errors", () => {
    const handleApprovalResponse = vi.fn()
    const parts = [
      {
        input: {
          command: "vp check",
          cwd: "/project"
        },
        state: "input-streaming",
        toolCallId: "tool-streaming",
        toolName: "bash",
        type: "dynamic-tool"
      },
      {
        approval: {
          id: "approval-1"
        },
        input: {
          command: "rtk rg TODO",
          cwd: "/project"
        },
        state: "approval-requested",
        toolCallId: "tool-approval",
        toolName: "bash",
        type: "dynamic-tool"
      },
      {
        input: {
          path: "src/value.ts"
        },
        output: {
          content: "export const value = 1"
        },
        state: "output-available",
        toolCallId: "tool-output",
        toolName: "read",
        type: "dynamic-tool"
      },
      {
        errorText: "type check failed",
        input: {
          command: "vp run @etyon/desktop#typecheck",
          cwd: "/project"
        },
        state: "output-error",
        toolCallId: "tool-error",
        toolName: "bash",
        type: "dynamic-tool"
      }
    ] satisfies DynamicToolUIPart[]

    const html = renderToStaticMarkup(
      renderStructuredToolTraceCards(parts, handleApprovalResponse)
    )

    expect(html).toContain("Preparing")
    expect(html).toContain("Approval needed")
    expect(html).toContain("Done")
    expect(html).toContain("Failed")
    expect(html).toContain("Approve")
    expect(html).toContain("Deny")
    expect(html).toContain("Run vp check")
    expect(html).toContain("src/value.ts")
    expect(html).toContain("type check failed")
  })

  it("collapses repeated terminal structured tool parts", () => {
    const handleApprovalResponse = vi.fn()
    const repeatedPart = {
      input: {
        command: "git diff --cached --stat",
        cwd: "/project"
      },
      output: {
        exitCode: 0,
        stdoutPreview: "1 file changed"
      },
      state: "output-available",
      toolName: "bash",
      type: "dynamic-tool"
    } as const
    const parts = [
      { ...repeatedPart, toolCallId: "tool-output-1" },
      { ...repeatedPart, toolCallId: "tool-output-2" },
      { ...repeatedPart, toolCallId: "tool-output-3" }
    ] satisfies DynamicToolUIPart[]

    const html = renderToStaticMarkup(
      renderStructuredToolTraceCards(parts, handleApprovalResponse)
    )

    expect(html.match(/Run git diff/gu)).toHaveLength(1)
    expect(html).toContain("Repeated 3x")
  })

  it("routes approval button presses through the DOM", () => {
    const handleApprovalResponse = vi.fn()
    const approvalPart = {
      approval: {
        id: "approval-1"
      },
      input: {
        command: "vp check",
        cwd: "/project"
      },
      state: "approval-requested",
      toolCallId: "tool-approval",
      toolName: "bash",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart
    const { cleanup, container } = renderElementInDom(
      renderStructuredToolTraceCards([approvalPart], handleApprovalResponse)
    )

    try {
      act(() => {
        findButtonByText(container, "Approve").click()
      })
      act(() => {
        findButtonByText(container, "Deny").click()
      })

      expect(handleApprovalResponse).toHaveBeenNthCalledWith(
        1,
        approvalPart,
        true
      )
      expect(handleApprovalResponse).toHaveBeenNthCalledWith(
        2,
        approvalPart,
        false
      )
    } finally {
      cleanup()
    }
  })
})
