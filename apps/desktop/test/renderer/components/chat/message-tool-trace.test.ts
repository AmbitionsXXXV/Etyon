import { I18nProvider } from "@etyon/i18n/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DynamicToolUIPart } from "ai"
import { createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vite-plus/test"

import { MessageToolTrace } from "@/renderer/components/chat/message-tool-trace"

interface QueryOptions {
  queryFn: () => Promise<unknown>
  queryKey: readonly unknown[]
}

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

const createQueryOptions = (
  name: string,
  input?: unknown,
  queryFn: () => Promise<unknown> = () => Promise.resolve(null)
): QueryOptions => ({
  queryFn,
  queryKey: ["orpc", name, input ?? null]
})

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  })

vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    agents: {
      inspectRun: {
        queryOptions: ({ input }: { input: unknown }) =>
          createQueryOptions("agents.inspectRun", input)
      }
    }
  }
}))

describe("MessageToolTrace", () => {
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
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(MessageToolTrace, {
          chatSessionId: "session-1",
          commandSegments: [],
          functionCallSegments: [],
          isApprovalActionDisabled: false,
          onApprovalResponse: handleApprovalResponse,
          parts
        })
      )
    )

    expect(html).toContain("Tool activity")
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

  it("renders a child trace entry for delegation tool outputs", () => {
    const handleApprovalResponse = vi.fn()
    const queryClient = createQueryClient()
    const parts = [
      {
        input: {
          task: "Inspect failing tests"
        },
        output: {
          profileId: "explore",
          subRunId: "run-child-1",
          summary: "Child agent found the failing assertion."
        },
        state: "output-available",
        toolCallId: "tool-agent",
        toolName: "agentExplore",
        type: "dynamic-tool"
      }
    ] satisfies DynamicToolUIPart[]

    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(MessageToolTrace, {
            chatSessionId: "session-1",
            commandSegments: [],
            functionCallSegments: [],
            isApprovalActionDisabled: false,
            onApprovalResponse: handleApprovalResponse,
            parts
          })
        )
      )
    )

    expect(html).toContain("agentExplore")
    expect(html).toContain("Child agent found the failing assertion.")
    expect(html).toContain("Child trace")
    expect(html).toContain("run-child-1")
  })
})
