// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import type { InspectAgentRunOutput } from "@etyon/rpc"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DynamicToolUIPart } from "ai"
import { act, createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  AgentChildTracePanel,
  MessageToolTrace
} from "@/renderer/components/chat/message-tool-trace"

interface QueryOptions {
  queryFn: () => Promise<unknown>
  queryKey: readonly unknown[]
}

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

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
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(MessageToolTrace, {
          chatSessionId: "session-1",
          commandSegments: [],
          functionCallSegments: [],
          isApprovalActionDisabled: false,
          onApprovalResponse: handleApprovalResponse,
          parts: [approvalPart]
        })
      )
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

  it("renders expanded child trace data from the inspectRun query cache", () => {
    const queryClient = createQueryClient()
    const trace = {
      artifacts: [
        {
          byteLength: 1024,
          createdAt: "2026-05-30T00:00:03.000Z",
          id: "artifact-1",
          kind: "command-output",
          metadata: {
            toolName: "bash"
          },
          path: "/tmp/etyon-child-output.json",
          runId: "run-child-1",
          toolCallId: "tool-child-1"
        }
      ],
      events: [
        {
          createdAt: "2026-05-30T00:00:00.000Z",
          id: "event-1",
          payload: {
            profileId: "explore"
          },
          runId: "run-child-1",
          sequence: 1,
          type: "agent_run_started"
        },
        {
          createdAt: "2026-05-30T00:00:02.000Z",
          id: "event-2",
          payload: {
            summary: "Child trace finished."
          },
          runId: "run-child-1",
          sequence: 2,
          type: "agent_run_finished"
        }
      ],
      run: {
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: "2026-05-30T00:00:02.000Z",
        id: "run-child-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "explore",
        startedAt: "2026-05-30T00:00:00.000Z",
        status: "succeeded"
      },
      toolCalls: [
        {
          approvalState: "not_required",
          errorMessage: null,
          finishedAt: "2026-05-30T00:00:02.000Z",
          id: "tool-child-1",
          input: {
            path: "README.md"
          },
          output: {
            content: "README"
          },
          parentToolCallId: null,
          runId: "run-child-1",
          startedAt: "2026-05-30T00:00:01.000Z",
          state: "finished",
          toolName: "read"
        }
      ]
    } satisfies InspectAgentRunOutput

    queryClient.setQueryData(
      [
        "orpc",
        "agents.inspectRun",
        {
          runId: "run-child-1",
          sessionId: "session-1"
        }
      ],
      trace
    )

    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentChildTracePanel, {
            defaultExpanded: true,
            runId: "run-child-1",
            sessionId: "session-1"
          })
        )
      )
    )

    expect(html).toContain("Child trace")
    expect(html).toContain("run-child-1")
    expect(html).toContain("Profile: explore")
    expect(html).toContain("Status: succeeded")
    expect(html).toContain("Artifacts 1")
    expect(html).toContain("command-output: etyon-child-output.json")
    expect(html).toContain("Tools 1")
    expect(html).toContain("read")
    expect(html).toContain("Events 2")
    expect(html).toContain("#2 agent_run_finished")
    expect(html).toContain("Child trace finished.")
  })
})
