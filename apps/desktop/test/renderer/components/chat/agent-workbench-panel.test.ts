import { I18nProvider } from "@etyon/i18n/react"
import type {
  AgentRunGraphExecutionPlan,
  AgentRunsOutput,
  AgentSessionSnapshotOutput,
  ListAgentRunGraphTemplatesOutput,
  PendingAgentApprovalsOutput
} from "@etyon/rpc"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  AgentWorkbenchBackgroundProcessPanel,
  AgentWorkbenchGraphPlanPanel,
  AgentWorkbenchPanel,
  AgentWorkbenchSessionPanel,
  AgentWorkbenchShellCommandPanel,
  AgentWorkbenchShellOutputPanel,
  AgentWorkbenchToolCallsPanel
} from "@/renderer/components/chat/agent-workbench-panel"
import type { AgentRunTracePreview } from "@/renderer/lib/chat/agent-workbench"

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

vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    agents: {
      inspectRun: {
        queryOptions: ({ input }: { input: unknown }) =>
          createQueryOptions("agents.inspectRun", input)
      },
      inspectSession: {
        queryOptions: ({ input }: { input: unknown }) =>
          createQueryOptions("agents.inspectSession", input)
      },
      listPendingApprovals: {
        queryOptions: ({ input }: { input: unknown }) =>
          createQueryOptions("agents.listPendingApprovals", input)
      },
      listRunGraphTemplates: {
        queryOptions: () => createQueryOptions("agents.listRunGraphTemplates")
      },
      listRuns: {
        queryOptions: ({ input }: { input: unknown }) =>
          createQueryOptions("agents.listRuns", input)
      },
      readArtifact: {
        queryOptions: ({ input }: { input: unknown }) =>
          createQueryOptions("agents.readArtifact", input)
      }
    }
  },
  rpcClient: {
    agents: {
      advanceRunGraph: vi.fn(),
      appendSessionCompactionSummary: vi.fn(),
      executeRunGraphNode: vi.fn(),
      instantiateRunGraphTemplate: vi.fn(),
      moveSessionLeaf: vi.fn(),
      respondToRunGraphApproval: vi.fn(),
      retryRunGraphNode: vi.fn(),
      runGraphUntilIdle: vi.fn(),
      skipRunGraphNode: vi.fn(),
      startRunGraphNextStage: vi.fn(),
      updateRunGraphRetryPolicy: vi.fn()
    }
  }
}))

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  })

describe("AgentWorkbenchPanel", () => {
  it("renders standalone workbench shell", () => {
    const queryClient = createQueryClient()
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentWorkbenchPanel, {
            isProjectDiffLoading: false,
            isRequestPending: false,
            mode: "standalone",
            sessionId: "session-standalone"
          })
        )
      )
    )

    expect(html).toContain("Agent Workbench")
    expect(html).toContain("Runs, graphs, session tree, and approvals")
    expect(html).toContain("Refresh workbench")
  })

  it("renders selected run tool calls", () => {
    const preview = {
      artifactCount: 0,
      artifacts: [],
      eventCount: 0,
      events: [],
      profileId: "coder",
      status: "failed",
      toolCallCount: 2,
      toolCalls: [
        {
          detail: "failed",
          id: "tool-1",
          label: "bash"
        },
        {
          detail: "finished",
          id: "tool-2",
          label: "read"
        }
      ]
    } satisfies AgentRunTracePreview
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AgentWorkbenchToolCallsPanel, {
          preview
        })
      )
    )

    expect(html).toContain("Tools 2")
    expect(html).toContain("bash")
    expect(html).toContain("failed")
    expect(html).toContain("read")
    expect(html).toContain("finished")
  })

  it("renders shell output previews", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AgentWorkbenchShellOutputPanel, {
          outputs: [
            {
              channel: "stdout",
              chunkCount: 2,
              commandLabel: "rtk vp check",
              cwd: "/project",
              id: "event-stdout",
              lastEventSequence: 4,
              text: "first\nsecond\n",
              truncated: false,
              type: "sandbox_command_output"
            },
            {
              channel: "stderr",
              chunkCount: 1,
              commandLabel: "process process-1",
              id: "event-stderr",
              lastEventSequence: 5,
              processId: "process-1",
              text: "warning\n",
              truncated: true,
              type: "background_process_output"
            }
          ]
        })
      )
    )

    expect(html).toContain("Shell output 2")
    expect(html).toContain("rtk vp check")
    expect(html).toContain("/project")
    expect(html).toContain("2 chunks")
    expect(html).toContain("first")
    expect(html).toContain("second")
    expect(html).toContain("stderr")
    expect(html).toContain("process process-1")
    expect(html).toContain("Showing latest output")
  })

  it("renders background process previews", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AgentWorkbenchBackgroundProcessPanel, {
          processes: [
            {
              command: "rtk vp dev",
              cwd: "/project",
              durationMs: 4200,
              exitCode: null,
              finishedAt: "2026-05-24T00:00:04.000Z",
              id: "event-started",
              lastEventSequence: 4,
              outputEventCount: 2,
              pid: 1234,
              processId: "process-1",
              sandboxed: true,
              startedAt: "2026-05-24T00:00:00.000Z",
              status: "stopped",
              stderrChars: 4,
              stdoutChars: 6
            }
          ]
        })
      )
    )

    expect(html).toContain("Processes 1")
    expect(html).toContain("rtk vp dev")
    expect(html).toContain("process-1")
    expect(html).toContain("/project")
    expect(html).toContain("stopped")
    expect(html).toContain("pid 1234")
    expect(html).toContain("duration 4.2 s")
    expect(html).toContain("stdout 6 / stderr 4")
    expect(html).toContain("exit -")
    expect(html).toContain("sandboxed")
  })

  it("renders sandbox command previews", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AgentWorkbenchShellCommandPanel, {
          commands: [
            {
              command: "rtk vp check",
              cwd: "/project",
              durationMs: 1200,
              exitCode: 0,
              id: "event-command-started",
              lastEventSequence: 3,
              outputEventCount: 1,
              pid: 111,
              sandboxed: true,
              shellStatus: "exited",
              startedAt: "2026-05-24T00:00:00.000Z",
              status: "success",
              stderrChars: 0,
              stdoutChars: 6
            }
          ]
        })
      )
    )

    expect(html).toContain("Shell commands 1")
    expect(html).toContain("rtk vp check")
    expect(html).toContain("/project")
    expect(html).toContain("success")
    expect(html).toContain("pid 111")
    expect(html).toContain("duration 1.2 s")
    expect(html).toContain("stdout 6 / stderr 0")
    expect(html).toContain("exit 0")
    expect(html).toContain("exited")
    expect(html).toContain("sandboxed")
  })

  it("renders graph plan stages and nodes", () => {
    const plan = {
      description: "Small bounded implementation with a review child run.",
      id: "solo-coder",
      name: "Solo Coder",
      nodes: [
        {
          activeToolNames: ["read", "edit"],
          attempt: 1,
          childRunId: "run-child-0",
          dependsOn: [],
          id: "coder",
          label: "Implement",
          lastOutput: "Patch is ready.",
          outputContract: "Patch summary and verification notes.",
          profileId: "coder",
          role: "execute",
          stage: 0,
          status: "succeeded",
          toolScope: "approval-gated"
        },
        {
          activeToolNames: ["read"],
          attempt: 0,
          dependsOn: ["coder"],
          id: "review",
          label: "Review",
          outputContract: "Findings ordered by severity.",
          profileId: "review",
          role: "review",
          stage: 1,
          status: "running",
          toolScope: "read-only"
        }
      ],
      stages: [
        {
          id: "stage-0",
          index: 0,
          nodeIds: ["coder"],
          parallel: false
        },
        {
          id: "stage-1",
          index: 1,
          nodeIds: ["review"],
          parallel: false
        }
      ],
      task: "Build graph UI."
    } satisfies AgentRunGraphExecutionPlan
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AgentWorkbenchGraphPlanPanel, {
          graphPlan: plan,
          onSelectRun: vi.fn(),
          retryPolicy: {
            automaticRetryEnabled: true,
            maxAutomaticRetries: 2,
            retryTransientFailures: true
          },
          retries: [
            {
              attempt: 2,
              automatic: true,
              childRunId: "run-child-0",
              errorMessage: "503 service unavailable",
              eventId: "event-retry-1",
              nodeId: "coder",
              sequence: 7
            }
          ]
        })
      )
    )

    expect(html).toContain("Run graph")
    expect(html).toContain("2 nodes")
    expect(html).toContain("Stage 1")
    expect(html).toContain("Implement")
    expect(html).toContain("approval-gated")
    expect(html).toContain("Child run")
    expect(html).toContain("run-child-0")
    expect(html).toContain("Retries 1")
    expect(html).toContain("Retry strategy")
    expect(html).toContain("Retry transient failures")
    expect(html).toContain("Max retries")
    expect(html).toContain("max automatic 2")
    expect(html).toContain("transient on")
    expect(html).toContain("automatic")
    expect(html).toContain("Attempt 2")
    expect(html).toContain("503 service unavailable")
    expect(html).toContain("Stage 2")
    expect(html).toContain("Review")
  })

  it("renders session tree controls", () => {
    const run = {
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "run-root",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-24T00:00:00.000Z",
      status: "succeeded"
    } satisfies AgentRunsOutput["runs"][number]
    const snapshot = {
      context: [
        {
          content: "Start.",
          role: "user",
          type: "model"
        },
        {
          content: "Branch summary:\nUse the compact branch.",
          role: "system",
          type: "model"
        }
      ],
      entries: [
        {
          id: "entry-1",
          message: {
            content: "Start.",
            role: "user",
            type: "model"
          },
          parentId: null,
          sequence: 1,
          type: "message"
        },
        {
          id: "entry-2",
          parentId: null,
          sequence: 2,
          targetEntryId: "entry-1",
          type: "leaf"
        },
        {
          id: "entry-3",
          parentId: "entry-1",
          sequence: 3,
          summary: "Use the compact branch.",
          type: "branch_summary"
        },
        {
          id: "entry-4",
          parentId: "entry-1",
          sequence: 4,
          targetEntryId: "entry-3",
          type: "leaf"
        }
      ],
      events: [
        {
          createdAt: "2026-05-24T00:00:00.000Z",
          id: "event-1",
          payload: {},
          runId: run.id,
          sequence: 1,
          type: "agent_session_entry_appended"
        }
      ],
      run
    } satisfies AgentSessionSnapshotOutput
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(AgentWorkbenchSessionPanel, {
          isLoading: false,
          isPending: false,
          onAppendCompactionSummary: vi.fn(),
          onMoveLeaf: vi.fn(),
          operationErrorMessage: null,
          snapshot
        })
      )
    )

    expect(html).toContain("Session tree")
    expect(html).toContain("Entries 2")
    expect(html).toContain("Context 2")
    expect(html).toContain("Leaf: entry-3")
    expect(html).toContain("#1 user")
    expect(html).toContain("#3 branch summary")
    expect(html).toContain("Move leaf")
    expect(html).toContain("Compact")
  })

  it("renders run list and workspace diff preview", () => {
    const queryClient = createQueryClient()
    const sessionId = "session-1"
    const runsInput = {
      limit: 30,
      sessionId
    }
    const approvalsInput = {
      sessionId
    }
    const run = {
      chatSessionId: sessionId,
      errorMessage: null,
      finishedAt: null,
      id: "run-root",
      modelId: "openai/gpt-4.1",
      parentRunId: null,
      profileId: "coder",
      startedAt: "2026-05-24T00:00:00.000Z",
      status: "suspended"
    } satisfies AgentRunsOutput["runs"][number]
    const inspectSessionInput = {
      runId: run.id,
      sessionId
    }

    queryClient.setQueryData(
      createQueryOptions("agents.listRuns", runsInput).queryKey,
      {
        runs: [run]
      } satisfies AgentRunsOutput
    )
    queryClient.setQueryData(
      createQueryOptions("agents.listPendingApprovals", approvalsInput)
        .queryKey,
      {
        approvals: [
          {
            approvalId: "approval-1",
            approvalState: "pending",
            chatSessionId: sessionId,
            errorMessage: null,
            finishedAt: null,
            id: "tool-1",
            input: {
              path: "src/generated.ts"
            },
            output: null,
            parentToolCallId: null,
            profileId: "coder",
            runId: run.id,
            runStatus: "suspended",
            startedAt: "2026-05-24T00:00:00.000Z",
            state: "approval_requested",
            toolName: "write"
          }
        ]
      } satisfies PendingAgentApprovalsOutput
    )
    queryClient.setQueryData(
      createQueryOptions("agents.listRunGraphTemplates").queryKey,
      {
        templates: [
          {
            description: "Solo coder",
            id: "solo-coder",
            name: "Solo Coder",
            nodes: []
          }
        ]
      } satisfies ListAgentRunGraphTemplatesOutput
    )
    queryClient.setQueryData(
      createQueryOptions("agents.inspectSession", inspectSessionInput).queryKey,
      {
        context: [
          {
            content: "Start.",
            role: "user",
            type: "model"
          },
          {
            content: "Branch summary:\nUse the compact branch.",
            role: "system",
            type: "model"
          }
        ],
        entries: [
          {
            id: "entry-1",
            message: {
              content: "Start.",
              role: "user",
              type: "model"
            },
            parentId: null,
            sequence: 1,
            type: "message"
          },
          {
            id: "entry-2",
            parentId: null,
            sequence: 2,
            targetEntryId: "entry-1",
            type: "leaf"
          },
          {
            id: "entry-3",
            parentId: "entry-1",
            sequence: 3,
            summary: "Use the compact branch.",
            type: "branch_summary"
          },
          {
            id: "entry-4",
            parentId: "entry-1",
            sequence: 4,
            targetEntryId: "entry-3",
            type: "leaf"
          }
        ],
        events: [
          {
            createdAt: "2026-05-24T00:00:00.000Z",
            id: "event-1",
            payload: {},
            runId: run.id,
            sequence: 1,
            type: "agent_session_entry_appended"
          }
        ],
        run
      } satisfies AgentSessionSnapshotOutput
    )

    const panel = createElement(AgentWorkbenchPanel, {
      gitDiff: {
        fileSnapshots: [],
        hasPatch: true,
        patch: [
          "diff --git a/src/value.ts b/src/value.ts",
          "index 1111111..2222222 100644",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1,2 @@",
          "-export const value = 1",
          "+export const value = 2",
          "+export const next = 3"
        ].join("\n"),
        projectPath: "/project",
        truncated: false
      },
      isProjectDiffLoading: false,
      isRequestPending: false,
      sessionId
    })
    const html = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        { locale: "en-US" },
        createElement(QueryClientProvider, { client: queryClient }, panel)
      )
    )

    expect(html).toContain("Agent Workbench")
    expect(html).toContain("coder")
    expect(html).toContain("Session tree")
    expect(html).toContain("Current diff")
    expect(html).toContain("src/value.ts")
    expect(html).toContain("+2")
    expect(html).toContain("-1")
  })
})
