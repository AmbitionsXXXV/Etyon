// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import type { AgentRunTraceRun } from "@etyon/rpc"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { QueryKey } from "@tanstack/react-query"
import type { DynamicToolUIPart } from "ai"
import { act, createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { WorkSubagentEntry } from "@/renderer/components/chat/subagents/subagent-entries"
import type {
  ChatToolPart,
  GroupedChainEntry,
  SubagentToolName
} from "@/renderer/lib/chat/assistant-message-timeline"
import {
  applySubagentApproval,
  clearSubagents,
  setSubagentStart
} from "@/renderer/lib/chat/subagent-stream-store"
import { orpc } from "@/renderer/lib/rpc"

const { respondToApproval } = vi.hoisted(() => ({
  respondToApproval: vi.fn(() => Promise.resolve({ ok: true }))
}))
const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

// The renderer rpc client touches window/electron at import time; the entries
// wiring only needs the listRuns query (workflow history children) plus the two
// factories the nested row may reach, so the mock supplies just those.
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
      listRuns: {
        queryOptions: ({ input }: { input: { parentRunId: string } }) => ({
          queryFn: () => Promise.resolve({ runs: [] }),
          queryKey: ["agents.listRuns", input]
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

const makeClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const listRunsKey = (parentRunId: string): QueryKey =>
  orpc.agents.listRuns.queryOptions({ input: { parentRunId } })
    .queryKey as QueryKey

const subagentEntry = (
  part: ChatToolPart,
  toolName: SubagentToolName
): Extract<GroupedChainEntry, { kind: "subagent-call" }> => ({
  key: `subagent-${part.toolCallId}`,
  kind: "subagent-call",
  part,
  toolName
})

const renderEntry = (
  client: QueryClient,
  entry: Extract<GroupedChainEntry, { kind: "subagent-call" }>,
  parentRunId?: string
): string =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(WorkSubagentEntry, {
          entry,
          isApprovalActionDisabled: false,
          onApprovalResponse: vi.fn(),
          parentRunId
        })
      )
    )
  )

const traceRun = (
  overrides: Partial<AgentRunTraceRun> &
    Pick<
      AgentRunTraceRun,
      "id" | "parentToolCallId" | "profileId" | "startedAt"
    >
): AgentRunTraceRun => ({
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: null,
  modelId: null,
  parentRunId: "root",
  status: "succeeded",
  ...overrides
})

describe("WorkSubagentEntry", () => {
  afterEach(() => {
    clearSubagents()
    respondToApproval.mockClear()
  })

  it("renders the live delegate row while its child is streaming", () => {
    const parentToolCallId = "delegate-tc-1"

    setSubagentStart({
      childRunId: "child-1",
      parentToolCallId,
      profileId: "explore",
      task: "Live task from the stream"
    })

    const part = {
      input: { profileId: "explore", task: "History task from the part" },
      state: "input-available",
      toolCallId: parentToolCallId,
      toolName: "delegate",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    const html = renderEntry(makeClient(), subagentEntry(part, "delegate"))

    // The live row wins over the history part: it renders the streamed task and
    // a running dot, and never falls through to the recorded input.
    expect(html).toContain("Live task from the stream")
    expect(html).toContain('title="Running')
    expect(html).not.toContain("History task from the part")
  })

  it("falls back to the delegate history row once the live child is gone", () => {
    const part = {
      input: { profileId: "auth-tracer", task: "Summarize the auth flow" },
      output: { childRunId: "child-9", summary: "Traced the login path." },
      state: "output-available",
      toolCallId: "delegate-tc-2",
      toolName: "delegate",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    const html = renderEntry(makeClient(), subagentEntry(part, "delegate"))

    // No live child → the settled part drives a collapsed history row: profile,
    // task, and the succeeded status icon come from the recorded input/output.
    expect(html).toContain("auth-tracer")
    expect(html).toContain("Summarize the auth flow")
    expect(html).toContain('aria-label="Done"')
    // The live path would have shown a running dot instead.
    expect(html).not.toContain('title="Running')
  })

  it("drives a legacy delegate output (no childRunId) into a history row", () => {
    const part = {
      input: { profileId: "legacy-explorer", task: "Review the migration" },
      // Legacy output: a summary but no recorded child run id.
      output: { summary: "Reviewed the migration steps." },
      state: "output-available",
      toolCallId: "delegate-tc-legacy",
      toolName: "delegate",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    const html = renderEntry(makeClient(), subagentEntry(part, "delegate"))

    // Same history header as the trace case (the summary body itself lives behind
    // the collapsed disclosure, so it is not part of the static markup here — it
    // is exercised in subagent-row.test.ts where the row is pinned open).
    expect(html).toContain("legacy-explorer")
    expect(html).toContain("Review the migration")
    expect(html).toContain('aria-label="Done"')
  })

  it("renders only the workflow's tagged children, in chronological order", () => {
    const workflowToolCallId = "workflow-tc-1"
    const parentRunId = "root-run-1"
    const part = {
      input: { task: "Investigate the regression" },
      output: { summary: "Completed the fan-out." },
      state: "output-available",
      toolCallId: workflowToolCallId,
      toolName: "workflow",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    // listRuns is DESC (newest first); the row should reverse to chronological.
    const runs: AgentRunTraceRun[] = [
      traceRun({
        id: "r-newer",
        parentToolCallId: workflowToolCallId,
        profileId: "explorer-beta",
        startedAt: "2026-07-17T10:00:02.000Z"
      }),
      traceRun({
        id: "r-older",
        parentToolCallId: workflowToolCallId,
        profileId: "explorer-alpha",
        startedAt: "2026-07-17T10:00:01.000Z"
      }),
      traceRun({
        id: "r-sibling",
        parentToolCallId: "other-delegate-tc",
        profileId: "sibling-delegate",
        startedAt: "2026-07-17T10:00:00.000Z"
      })
    ]

    const client = makeClient()

    client.setQueryData(listRunsKey(parentRunId), { runs })

    const html = renderEntry(
      client,
      subagentEntry(part, "workflow"),
      parentRunId
    )

    expect(html).toContain("explorer-alpha")
    expect(html).toContain("explorer-beta")
    // A sibling delegate under a different tool call must not bleed in.
    expect(html).not.toContain("sibling-delegate")
    expect(html.indexOf("explorer-alpha")).toBeLessThan(
      html.indexOf("explorer-beta")
    )
  })

  it("falls back to explore-profile children for legacy untagged runs", () => {
    const workflowToolCallId = "workflow-tc-legacy"
    const parentRunId = "root-legacy"
    const part = {
      input: { task: "Legacy fan-out" },
      output: { summary: "Legacy summary." },
      state: "output-available",
      toolCallId: workflowToolCallId,
      toolName: "workflow",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    const runs: AgentRunTraceRun[] = [
      traceRun({
        id: "r1",
        parentToolCallId: null,
        profileId: "explore",
        startedAt: "2026-07-17T10:00:02.000Z"
      }),
      traceRun({
        id: "r2",
        parentToolCallId: null,
        profileId: "coder-legacy",
        startedAt: "2026-07-17T10:00:01.000Z"
      }),
      traceRun({
        id: "r3",
        parentToolCallId: null,
        profileId: "explore",
        startedAt: "2026-07-17T10:00:00.000Z"
      })
    ]

    const client = makeClient()

    client.setQueryData(listRunsKey(parentRunId), { runs })

    const html = renderEntry(
      client,
      subagentEntry(part, "workflow"),
      parentRunId
    )

    expect(html).toContain("explore")
    // A non-explore legacy run is not a workflow child.
    expect(html).not.toContain("coder-legacy")
  })

  it("renders no children when every run is tagged to a different tool call", () => {
    const workflowToolCallId = "workflow-tc-empty"
    const parentRunId = "root-empty"
    const part = {
      input: { task: "Post-migration fan-out" },
      output: { summary: "No matching children." },
      state: "output-available",
      toolCallId: workflowToolCallId,
      toolName: "workflow",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    // Post-migration data: every run records a parent tool call, but none match
    // this workflow's — so the profile fallback must NOT kick in.
    const runs: AgentRunTraceRun[] = [
      traceRun({
        id: "r1",
        parentToolCallId: "some-other-tc",
        profileId: "explore",
        startedAt: "2026-07-17T10:00:01.000Z"
      }),
      traceRun({
        id: "r2",
        parentToolCallId: "another-tc",
        profileId: "explore",
        startedAt: "2026-07-17T10:00:00.000Z"
      })
    ]

    const client = makeClient()

    client.setQueryData(listRunsKey(parentRunId), { runs })

    const html = renderEntry(
      client,
      subagentEntry(part, "workflow"),
      parentRunId
    )

    expect(html).not.toContain("explore")
  })

  it("renders every live Best-of-N child and exposes its real pending approval action", async () => {
    const toolCallId = "best-of-n:live-request"
    setSubagentStart({
      childRunId: "best-child-one",
      parentToolCallId: toolCallId,
      profileId: "coder",
      task: "Implement model one"
    })
    setSubagentStart({
      childRunId: "best-child-two",
      parentToolCallId: toolCallId,
      profileId: "coder",
      task: "Implement model two"
    })
    setSubagentStart({
      childRunId: "unrelated-child",
      parentToolCallId: "other-call",
      profileId: "coder",
      task: "Unrelated task"
    })
    applySubagentApproval({
      approvalId: "best-edit-approval",
      canRemember: false,
      childRunId: "best-child-two",
      commandOrPath: "src/feature.ts",
      dangerous: false,
      toolName: "edit"
    })
    const part = {
      input: {
        models: [{ modelId: "one" }, { modelId: "two" }],
        prompt: "Implement feature"
      },
      state: "input-available",
      toolCallId,
      toolName: "best_of_n",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const queryClient = makeClient()
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(
              TestI18nProvider,
              { locale: "en-US" },
              createElement(WorkSubagentEntry, {
                entry: subagentEntry(part, "best_of_n"),
                isApprovalActionDisabled: false,
                onApprovalResponse: vi.fn(),
                parentRunId: "parent"
              })
            )
          )
        )
        await Promise.resolve()
      })
      expect(container.textContent).toContain("Best-of-N")
      expect(container.textContent).toContain("Implement model one")
      expect(container.textContent).toContain("Implement model two")
      expect(container.textContent).not.toContain("Unrelated task")
      expect(container.textContent).toContain("edit needs your approval")
      const approve = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Approve"
      )
      if (!approve) {
        throw new Error("Expected the actual child approval button.")
      }
      await act(async () => {
        approve.click()
        await Promise.resolve()
      })
      expect(respondToApproval).toHaveBeenCalledWith(
        {
          approvalId: "best-edit-approval",
          approved: true
        },
        expect.anything()
      )
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
      queryClient.clear()
    }
  })

  it("restores tagged Best-of-N children from runs and ignores delegate-shaped output and other tool calls", () => {
    const toolCallId = "best-of-n:history-request"
    const part = {
      input: {
        models: [{ modelId: "one" }, { modelId: "two" }],
        prompt: "task"
      },
      output: { childRunId: "fake-delegate-output", candidates: [] },
      state: "output-available",
      toolCallId,
      toolName: "best_of_n",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart
    const queryClient = makeClient()
    queryClient.setQueryData(listRunsKey("parent"), {
      runs: [
        traceRun({
          id: "best-newer",
          parentToolCallId: toolCallId,
          profileId: "best-profile-two",
          startedAt: "2026-10-03T01:00:02Z"
        }),
        traceRun({
          id: "best-older",
          parentToolCallId: toolCallId,
          profileId: "best-profile-one",
          startedAt: "2026-10-03T01:00:01Z"
        }),
        traceRun({
          id: "sibling",
          parentToolCallId: "other-call",
          profileId: "unrelated-profile",
          startedAt: "2026-10-03T01:00:00Z"
        }),
        traceRun({
          id: "legacy",
          parentToolCallId: null,
          profileId: "legacy-explore",
          startedAt: "2026-10-03T00:59:00Z"
        })
      ]
    })
    const html = renderEntry(
      queryClient,
      subagentEntry(part, "best_of_n"),
      "parent"
    )
    expect(html).toContain("Best-of-N")
    expect(html).toContain("best-profile-one")
    expect(html).toContain("best-profile-two")
    expect(html).not.toContain("unrelated-profile")
    expect(html).not.toContain("legacy-explore")
    const parsed = document.createElement("div")
    parsed.innerHTML = html
    const childList = parsed.querySelector('div[aria-label="Best-of-N"]')
    expect(childList?.textContent).not.toContain("fake-delegate-output")
    expect(html.indexOf("best-profile-one")).toBeLessThan(
      html.indexOf("best-profile-two")
    )
    queryClient.clear()
  })

  it("does not use the workflow legacy fallback for an untagged Best-of-N comparison", () => {
    const part = {
      input: { prompt: "task" },
      output: { candidates: [] },
      state: "output-available",
      toolCallId: "best-without-children",
      toolName: "best_of_n",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart
    const queryClient = makeClient()
    queryClient.setQueryData(listRunsKey("parent"), {
      runs: [
        traceRun({
          id: "legacy-child",
          parentToolCallId: null,
          profileId: "explore",
          startedAt: "2026-10-03T01:00:00Z"
        })
      ]
    })
    const html = renderEntry(
      queryClient,
      subagentEntry(part, "best_of_n"),
      "parent"
    )
    expect(html).toContain("Best-of-N")
    expect(html).not.toContain("explore")
    queryClient.clear()
  })
})
