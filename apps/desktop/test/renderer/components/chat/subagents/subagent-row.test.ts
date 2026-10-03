// @vitest-environment happy-dom

import { setTimeout as delay } from "node:timers/promises"

import { I18nProvider } from "@etyon/i18n/react"
import type { AgentRunTraceRun, AgentRunTraceToolCall } from "@etyon/rpc"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { QueryKey } from "@tanstack/react-query"
import type { DynamicToolUIPart } from "ai"
import { act, createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { SubagentRowView } from "@/renderer/components/chat/subagents/subagent-row"
import type { ChatUiMessage } from "@/renderer/lib/chat/assistant-message-timeline"
import type { SubagentRowViewModel } from "@/renderer/lib/chat/subagent-view-model"
import { orpc } from "@/renderer/lib/rpc"
import type { ChatSubagentApprovalData } from "@/shared/chat/stream-data"

const { respondToApproval } = vi.hoisted(() => ({
  respondToApproval:
    vi.fn<
      (input: {
        approvalId: string
        approved: boolean
        rememberCommand?: boolean
      }) => Promise<{ ok: boolean }>
    >()
}))
const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

// The renderer rpc client pulls in window/electron globals at import time, so the
// component tests replace it with just the query/mutation option factories the
// sub-agent row touches. Query keys are shaped so a test can seed the same cache
// entry the component reads (see `orpc.agents.inspectRun.queryOptions` below).
vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    agents: {
      inspectRun: {
        queryOptions: ({ input }: { input: { runId: string } }) => ({
          queryFn: () =>
            Promise.resolve({
              artifacts: [],
              events: [],
              run: null,
              toolCalls: []
            }),
          queryKey: ["agents.inspectRun", input]
        })
      },
      respondToApproval: {
        mutationOptions: () => ({
          mutationFn: respondToApproval
        })
      }
    }
  }
}))

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

// `retryOnMount: false` keeps an injected error state intact: without it the
// observer optimistically resets a no-data errored query back to "pending" for
// its would-be mount fetch, which `renderToStaticMarkup` never actually runs.
const makeClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } }
  })

const renderRow = (client: QueryClient, model: SubagentRowViewModel): string =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(SubagentRowView, { model })
      )
    )
  )

const baseModel = (
  overrides: Partial<SubagentRowViewModel>
): SubagentRowViewModel => ({
  approvals: [],
  body: { kind: "none" },
  origin: "delegate",
  profileId: "explore",
  status: "running",
  ...overrides
})

const approval = (
  overrides: Partial<ChatSubagentApprovalData>
): ChatSubagentApprovalData => ({
  approvalId: "approval-1",
  canRemember: false,
  childRunId: "child-approval",
  commandOrPath: "src/file.ts",
  dangerous: false,
  toolName: "edit",
  ...overrides
})

// A neutral pending approval whose only job is to pin the row open, since a
// collapsed row (the default under `renderToStaticMarkup`, which runs no effects
// and cannot toggle the disclosure) renders no body at all.
const pinApproval = approval({
  approvalId: "pin",
  commandOrPath: "src/__pin__.ts"
})

const inspectRunKey = (runId: string): QueryKey =>
  orpc.agents.inspectRun.queryOptions({ input: { runId } }).queryKey as QueryKey

const traceRun = (runId: string): AgentRunTraceRun => ({
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: "2026-07-17T10:00:01.000Z",
  id: runId,
  modelId: null,
  parentRunId: null,
  parentToolCallId: null,
  profileId: "explore",
  startedAt: "2026-07-17T10:00:00.000Z",
  status: "succeeded"
})

describe("SubagentRowView", () => {
  beforeEach(() => {
    respondToApproval.mockReset().mockResolvedValue({ ok: true })
  })

  it("restores approval actions after an RPC failure and keeps a successful retry submitted", async () => {
    respondToApproval.mockRejectedValueOnce(new Error("Connection stopped"))
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const client = makeClient()
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(
              TestI18nProvider,
              { locale: "en-US" },
              createElement(SubagentRowView, {
                model: baseModel({
                  approvals: [approval({ canRemember: true })]
                })
              })
            )
          )
        )
        await Promise.resolve()
      })
      const buttons = [...container.querySelectorAll("button")].filter(
        (button) =>
          ["Approve", "Approve and remember", "Deny"].includes(
            button.textContent?.trim() ?? ""
          )
      )
      const remember = buttons.find(
        (button) => button.textContent?.trim() === "Approve and remember"
      )
      if (!remember) {
        throw new Error("Expected the child approval action.")
      }
      expect(buttons).toHaveLength(3)

      await act(async () => {
        remember.click()
        await delay(10)
      })
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Connection stopped"
      )
      expect(buttons.every((button) => !button.disabled)).toBe(true)

      await act(async () => {
        remember.click()
        await delay(10)
      })
      expect(respondToApproval).toHaveBeenCalledTimes(2)
      expect(respondToApproval.mock.calls.map(([input]) => input)).toEqual([
        {
          approvalId: "approval-1",
          approved: true,
          rememberCommand: true
        },
        {
          approvalId: "approval-1",
          approved: true,
          rememberCommand: true
        }
      ])
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(buttons.every((button) => button.disabled)).toBe(true)
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
      client.clear()
    }
  })

  it("renders a running row with its task, pulsing dot, and live activity", () => {
    const html = renderRow(
      makeClient(),
      baseModel({
        activity: "read config.ts",
        profileId: "explore",
        startedAtMs: Date.now(),
        status: "running",
        task: "Investigate the flaky test"
      })
    )

    expect(html).toContain("Investigate the flaky test")
    // The running status dot exposes its state through a title.
    expect(html).toContain('title="Running')
    expect(html).toContain("animate-pulse")
    expect(html).toContain("read config.ts")
  })

  const settledStatusCases = [
    { label: "Done", status: "succeeded" },
    { label: "Failed", status: "failed" },
    { label: "Stopped", status: "aborted" }
  ] as const

  for (const { label, status } of settledStatusCases) {
    it(`shows the ${status} status icon labelled "${label}"`, () => {
      const html = renderRow(
        makeClient(),
        baseModel({ profileId: "explore", status, task: "Look at logs" })
      )

      expect(html).toContain(`aria-label="${label}"`)
    })
  }

  it("falls back to the delegated-task title when a delegate row has no profile", () => {
    const html = renderRow(
      makeClient(),
      baseModel({ origin: "delegate", profileId: "", status: "succeeded" })
    )

    expect(html).toContain("Delegated a task")
    expect(html).not.toContain("Ran a workflow")
  })

  it("falls back to the ran-workflow title when a workflow row has no profile", () => {
    const html = renderRow(
      makeClient(),
      baseModel({ origin: "workflow", profileId: "", status: "succeeded" })
    )

    expect(html).toContain("Ran a workflow")
  })

  it("pins the row open and shows the approval prompt when one is pending", () => {
    const html = renderRow(
      makeClient(),
      baseModel({
        approvals: [
          approval({
            canRemember: false,
            commandOrPath: "src/server.ts",
            dangerous: false,
            toolName: "edit"
          })
        ],
        status: "running"
      })
    )

    expect(html).toContain("edit needs your approval")
    expect(html).toContain("src/server.ts")
    expect(html).toContain("Approve")
    expect(html).toContain("Deny")
    // canRemember is false, so the remember affordance stays hidden.
    expect(html).not.toContain("Approve and remember")
    // The pending state swaps the status dot for an amber waiting cue.
    expect(html).toContain('title="Waiting for approval')
  })

  it("offers approve-and-remember only when the approval can be remembered", () => {
    const html = renderRow(
      makeClient(),
      baseModel({
        approvals: [
          approval({
            canRemember: true,
            commandOrPath: "rm -rf build",
            toolName: "bash"
          })
        ]
      })
    )

    expect(html).toContain("Approve and remember")
  })

  it("applies danger styling when the approval is flagged dangerous", () => {
    const html = renderRow(
      makeClient(),
      baseModel({
        approvals: [
          approval({
            commandOrPath: "rm -rf /",
            dangerous: true,
            toolName: "bash"
          })
        ]
      })
    )

    expect(html).toContain("border-danger/50")
    expect(html).toContain("This command is destructive")
  })

  it("renders a live mini timeline: thinking, tool group, narration, and answer", () => {
    const timelineParts = [
      { state: "done", text: "Weighing the two fixes", type: "reasoning" },
      { text: "Let me look around.", type: "text" },
      {
        input: { command: "ls" },
        output: { stdoutPreview: "ok" },
        state: "output-available",
        toolCallId: "c1",
        toolName: "bash",
        type: "dynamic-tool"
      },
      { text: "All done here.", type: "text" }
    ] satisfies [
      { state: "done"; text: string; type: "reasoning" },
      { text: string; type: "text" },
      DynamicToolUIPart,
      { text: string; type: "text" }
    ]

    const html = renderRow(
      makeClient(),
      baseModel({
        approvals: [pinApproval],
        body: {
          isRunActive: false,
          kind: "live-parts",
          parts: timelineParts as ChatUiMessage["parts"]
        },
        status: "running"
      })
    )

    expect(html).toContain("Thought")
    expect(html).toContain("Weighing the two fixes")
    expect(html).toContain("Let me look around.")
    expect(html).toContain("Ran a command")
    // The child's trailing answer stays inside the row rather than leaking out.
    expect(html).toContain("All done here.")
  })

  it("renders a legacy summary body when the row is expanded", () => {
    const html = renderRow(
      makeClient(),
      baseModel({
        approvals: [pinApproval],
        body: { kind: "summary", text: "Traced the login flow end to end" },
        status: "succeeded"
      })
    )

    expect(html).toContain("Traced the login flow end to end")
  })

  it("renders a seeded trace body's recorded tool calls", () => {
    const runId = "run-seeded"
    const toolCall: AgentRunTraceToolCall = {
      approvalState: "not_required",
      errorMessage: null,
      finishedAt: "2026-07-17T10:00:01.000Z",
      id: "tc-1",
      input: { command: "ls -la" },
      output: { stdoutPreview: "a.ts" },
      parentToolCallId: null,
      runId,
      startedAt: "2026-07-17T10:00:00.000Z",
      state: "finished",
      toolName: "bash"
    }
    const client = makeClient()

    client.setQueryData(inspectRunKey(runId), {
      artifacts: [],
      events: [],
      run: traceRun(runId),
      toolCalls: [toolCall]
    })

    const html = renderRow(
      client,
      baseModel({
        approvals: [pinApproval],
        body: { kind: "trace", runId },
        origin: "workflow",
        status: "succeeded"
      })
    )

    expect(html).toContain("Ran a command")
  })

  it("shows the loading copy while a trace body is still pending", () => {
    const html = renderRow(
      makeClient(),
      baseModel({
        approvals: [pinApproval],
        body: { kind: "trace", runId: "run-pending" },
        status: "succeeded"
      })
    )

    expect(html).toContain("Loading trace")
  })

  it("shows the failure copy when a trace body query errors", () => {
    const runId = "run-error"
    const client = makeClient()

    // Inject a settled error state straight into the cache: `renderToStaticMarkup`
    // runs no effects, so a rejected queryFn would never resolve mid-render.
    const query = client
      .getQueryCache()
      .build(client, { queryKey: inspectRunKey(runId) })

    query.setState({
      error: new Error("Failed to load the trace"),
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error"
    })

    const html = renderRow(
      client,
      baseModel({
        approvals: [pinApproval],
        body: { kind: "trace", runId },
        status: "succeeded"
      })
    )

    expect(html).toContain("load the trace")
  })
})
