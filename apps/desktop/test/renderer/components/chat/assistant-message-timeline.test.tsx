// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
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
  it("renders a continuation marker for resumed assistant messages", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AssistantMessageTimeline, {
          chatSessionId: "session-1",
          isApprovalActionDisabled: false,
          isStreamdownAnimating: false,
          message: {
            id: "assistant-1",
            metadata: {
              continuation: true
            },
            parts: [
              {
                text: "Done.",
                type: "text"
              }
            ],
            role: "assistant"
          },
          onApprovalResponse: vi.fn(),
          showToolTraces: true,
          streamdownAnimation: "none"
        })
      )
    )

    expect(html).toContain("Continued")
    expect(html).toContain("Done.")
  })
})
