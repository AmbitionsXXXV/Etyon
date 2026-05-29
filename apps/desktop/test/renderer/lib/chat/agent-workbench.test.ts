import type {
  AgentRunGraphExecutionNodeStatus,
  AgentRunGraphExecutionPlan,
  AgentRunTraceRun,
  AgentSessionSnapshotOutput,
  InspectAgentRunOutput,
  PendingAgentApproval
} from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  getAgentWorkbenchControlState,
  getAgentWorkbenchDiffPreview,
  getAgentWorkbenchFirstFailedNode,
  getAgentWorkbenchGraphPreview,
  getAgentWorkbenchGraphRetryPreview,
  getAgentWorkbenchGraphPlan,
  getAgentWorkbenchOperationErrorMessage,
  getAgentWorkbenchPendingApprovals,
  getAgentWorkbenchRootRun,
  getAgentWorkbenchRootRunOrNull,
  getAgentWorkbenchRootTrace,
  getAgentWorkbenchRunDepth,
  getAgentWorkbenchSelectedRun,
  getAgentWorkbenchRetryPolicyPreview,
  getAgentWorkbenchSessionPreview,
  getGraphApprovalOperationRunIds,
  getGraphOperationRunIds,
  hasRunningRunGraphNode
} from "@/renderer/lib/chat/agent-workbench"

const createRun = ({
  id,
  parentRunId,
  profileId = "coder",
  status = "running"
}: {
  id: string
  parentRunId: string | null
  profileId?: string
  status?: AgentRunTraceRun["status"]
}): AgentRunTraceRun => ({
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: null,
  id,
  modelId: "openai/gpt-4.1",
  parentRunId,
  profileId,
  startedAt: "2026-05-24T00:00:00.000Z",
  status
})

const createPlan = (
  statuses: AgentRunGraphExecutionNodeStatus[]
): AgentRunGraphExecutionPlan => ({
  description: "Small bounded implementation with a review child run.",
  id: "solo-coder",
  name: "Solo Coder",
  nodes: statuses.map((status, index) => ({
    activeToolNames: ["read"],
    attempt: index,
    dependsOn: index === 0 ? [] : ["node-0"],
    id: `node-${index}`,
    label: `Node ${index}`,
    outputContract: "Patch summary and verification notes.",
    profileId: index === 0 ? "coder" : "review",
    role: index === 0 ? "execute" : "review",
    stage: index,
    status,
    toolScope: index === 0 ? "approval-gated" : "read-only"
  })),
  stages: statuses.map((_, index) => ({
    id: `stage-${index}`,
    index,
    nodeIds: [`node-${index}`],
    parallel: false
  })),
  task: "Build the workbench."
})

const createTrace = ({
  plan,
  run
}: {
  plan: AgentRunGraphExecutionPlan
  run: AgentRunTraceRun
}): InspectAgentRunOutput => ({
  artifacts: [],
  events: [
    {
      createdAt: "2026-05-24T00:00:00.000Z",
      id: "event-1",
      payload: {
        plan
      },
      runId: run.id,
      sequence: 1,
      type: "agent_run_graph_instantiated"
    }
  ],
  run,
  toolCalls: []
})

const createApproval = ({
  runId,
  toolName = "write"
}: {
  runId: string
  toolName?: string
}): PendingAgentApproval => ({
  approvalId: `approval-${runId}`,
  approvalState: "pending",
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: null,
  id: `tool-${runId}`,
  input: {
    path: "src/generated.ts"
  },
  output: null,
  parentToolCallId: null,
  profileId: "coder",
  runId,
  runStatus: "suspended",
  startedAt: "2026-05-24T00:00:00.000Z",
  state: "approval_requested",
  toolName
})

describe("agent workbench helpers", () => {
  it("selects a run and resolves its root run", () => {
    const rootRun = createRun({
      id: "run-root",
      parentRunId: null,
      profileId: "plan"
    })
    const childRun = createRun({
      id: "run-child",
      parentRunId: rootRun.id,
      profileId: "explore"
    })
    const grandchildRun = createRun({
      id: "run-grandchild",
      parentRunId: childRun.id,
      profileId: "review"
    })
    const runsById = new Map(
      [rootRun, childRun, grandchildRun].map((run) => [run.id, run])
    )

    expect(
      getAgentWorkbenchSelectedRun({
        runsById,
        selectedRunId: grandchildRun.id
      })
    ).toBe(grandchildRun)
    expect(
      getAgentWorkbenchRootRun({
        run: grandchildRun,
        runsById
      })
    ).toBe(rootRun)
    expect(
      getAgentWorkbenchRootRunOrNull({
        run: grandchildRun,
        runsById
      })
    ).toBe(rootRun)
    expect(
      getAgentWorkbenchRunDepth({
        run: grandchildRun,
        runsById
      })
    ).toBe(2)
  })

  it("keeps run tree traversal bounded for missing parents and cycles", () => {
    const orphanRun = createRun({
      id: "run-orphan",
      parentRunId: "missing-parent"
    })
    const cycleRunA = createRun({
      id: "run-cycle-a",
      parentRunId: "run-cycle-b"
    })
    const cycleRunB = createRun({
      id: "run-cycle-b",
      parentRunId: cycleRunA.id
    })
    const runsById = new Map(
      [orphanRun, cycleRunA, cycleRunB].map((run) => [run.id, run])
    )

    expect(
      getAgentWorkbenchRootRun({
        run: orphanRun,
        runsById
      })
    ).toBe(orphanRun)
    expect(
      getAgentWorkbenchRootRun({
        maxDepth: 1,
        run: cycleRunA,
        runsById
      })
    ).toBe(cycleRunB)
    expect(
      getAgentWorkbenchRunDepth({
        maxDepth: 1,
        run: cycleRunA,
        runsById
      })
    ).toBe(1)
  })

  it("chooses the selected trace for root runs and the root trace for child runs", () => {
    const rootRun = createRun({
      id: "run-root",
      parentRunId: null
    })
    const childRun = createRun({
      id: "run-child",
      parentRunId: rootRun.id
    })
    const rootTrace = createTrace({
      plan: createPlan(["failed"]),
      run: rootRun
    })
    const childTrace = createTrace({
      plan: createPlan(["succeeded"]),
      run: childRun
    })

    expect(
      getAgentWorkbenchRootTrace({
        inspectedRootRun: undefined,
        inspectedRun: rootTrace,
        rootRun,
        selectedRun: rootRun
      })
    ).toBe(rootTrace)
    expect(
      getAgentWorkbenchRootTrace({
        inspectedRootRun: rootTrace,
        inspectedRun: childTrace,
        rootRun,
        selectedRun: childRun
      })
    ).toBe(rootTrace)
  })

  it("extracts graph state used by workbench controls", () => {
    const run = createRun({
      id: "run-root",
      parentRunId: null
    })
    const plan = createPlan(["succeeded", "failed"])
    const graphPlan = getAgentWorkbenchGraphPlan(
      createTrace({
        plan,
        run
      })
    )
    const failedNode = getAgentWorkbenchFirstFailedNode(graphPlan)

    expect(failedNode?.id).toBe("node-1")
    expect(hasRunningRunGraphNode(graphPlan)).toBe(false)
    expect(
      getAgentWorkbenchControlState({
        failedNode,
        graphPlan,
        isPending: false,
        templateCount: 1
      })
    ).toEqual({
      canAdvanceGraph: true,
      canCreateGraph: true,
      canRetryFailedNode: true,
      canStartNextStage: true
    })
    expect(
      getAgentWorkbenchControlState({
        failedNode,
        graphPlan,
        isPending: true,
        templateCount: 1
      })
    ).toEqual({
      canAdvanceGraph: false,
      canCreateGraph: false,
      canRetryFailedNode: false,
      canStartNextStage: false
    })
  })

  it("builds stage and dependency previews for workbench graph UI", () => {
    const basePlan = createPlan(["succeeded", "running"])
    const plan = {
      ...basePlan,
      nodes: basePlan.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              childRunId: "run-child-0",
              lastOutput: "Implementation finished."
            }
          : node
      )
    } satisfies AgentRunGraphExecutionPlan
    const preview = getAgentWorkbenchGraphPreview(plan)

    expect(preview?.totalNodeCount).toBe(2)
    expect(preview?.stages).toHaveLength(2)
    expect(preview?.stages[0]?.nodes[0]).toMatchObject({
      activeToolCount: 1,
      childRunId: "run-child-0",
      dependsOn: [],
      label: "Node 0",
      lastOutputPreview: "Implementation finished.",
      status: "succeeded"
    })
    expect(preview?.stages[1]?.nodes[0]).toMatchObject({
      dependsOn: [
        {
          fromLabel: "Node 0",
          fromNodeId: "node-0",
          toLabel: "Node 1",
          toNodeId: "node-1"
        }
      ],
      label: "Node 1",
      status: "running"
    })
    expect(preview?.edges).toEqual([
      {
        fromLabel: "Node 0",
        fromNodeId: "node-0",
        toLabel: "Node 1",
        toNodeId: "node-1"
      }
    ])
    expect(getAgentWorkbenchGraphPreview(null)).toBeNull()
  })

  it("projects automatic and manual graph retry events for workbench UI", () => {
    const run = createRun({
      id: "run-root",
      parentRunId: null
    })
    const trace = createTrace({
      plan: createPlan(["failed"]),
      run
    })

    trace.events.push(
      {
        createdAt: "2026-05-24T00:00:01.000Z",
        id: "event-retry-auto",
        payload: {
          attempt: 1,
          automatic: true,
          childRunId: "run-child-0",
          errorMessage: "503 service unavailable",
          nodeId: "node-0"
        },
        runId: run.id,
        sequence: 2,
        type: "agent_run_graph_node_retrying"
      },
      {
        createdAt: "2026-05-24T00:00:02.000Z",
        id: "event-retry-manual",
        payload: {
          attempt: 2,
          automatic: false,
          nodeId: "node-0"
        },
        runId: run.id,
        sequence: 3,
        type: "agent_run_graph_node_retrying"
      }
    )

    expect(getAgentWorkbenchGraphRetryPreview(trace)).toEqual([
      {
        attempt: 1,
        automatic: true,
        childRunId: "run-child-0",
        errorMessage: "503 service unavailable",
        eventId: "event-retry-auto",
        nodeId: "node-0",
        sequence: 2
      },
      {
        attempt: 2,
        automatic: false,
        eventId: "event-retry-manual",
        nodeId: "node-0",
        sequence: 3
      }
    ])
    expect(getAgentWorkbenchGraphRetryPreview()).toEqual([])
  })

  it("projects retry settings into a strategy preview", () => {
    expect(
      getAgentWorkbenchRetryPolicyPreview({
        maxAutomaticRetries: 2,
        retryTransientFailures: true
      })
    ).toEqual({
      automaticRetryEnabled: true,
      maxAutomaticRetries: 2,
      retryTransientFailures: true
    })
    expect(
      getAgentWorkbenchRetryPolicyPreview({
        maxAutomaticRetries: 0,
        retryTransientFailures: true
      })
    ).toMatchObject({
      automaticRetryEnabled: false,
      retryTransientFailures: true
    })
    expect(getAgentWorkbenchRetryPolicyPreview(null)).toEqual({
      automaticRetryEnabled: false,
      maxAutomaticRetries: 0,
      retryTransientFailures: false
    })
  })

  it("disables stage start while a graph node is running", () => {
    const graphPlan = createPlan(["running"])
    const controlState = getAgentWorkbenchControlState({
      failedNode: null,
      graphPlan,
      isPending: false,
      templateCount: 1
    })

    expect(hasRunningRunGraphNode(graphPlan)).toBe(true)
    expect(controlState).toEqual({
      canAdvanceGraph: true,
      canCreateGraph: true,
      canRetryFailedNode: false,
      canStartNextStage: false
    })
  })

  it("returns operation run ids and readable operation errors", () => {
    const rootRun = createRun({
      id: "run-root",
      parentRunId: null
    })
    const childRun = createRun({
      id: "run-child",
      parentRunId: rootRun.id
    })

    expect(
      getGraphOperationRunIds({
        run: rootRun,
        startedRuns: [childRun]
      })
    ).toEqual(["run-root", "run-child"])
    expect(
      getGraphApprovalOperationRunIds({
        childRun,
        run: rootRun,
        startedRuns: [childRun]
      })
    ).toEqual(["run-root", "run-child"])
    expect(getAgentWorkbenchOperationErrorMessage(new Error("failed"))).toBe(
      "failed"
    )
    expect(getAgentWorkbenchOperationErrorMessage("raw error")).toBe(
      "raw error"
    )
    expect(getAgentWorkbenchOperationErrorMessage(null)).toBeNull()
  })

  it("filters pending approvals to the selected graph root", () => {
    const rootRun = createRun({
      id: "run-root",
      parentRunId: null
    })
    const childRun = createRun({
      id: "run-child",
      parentRunId: rootRun.id
    })
    const unrelatedRun = createRun({
      id: "run-unrelated",
      parentRunId: null
    })
    const runsById = new Map(
      [rootRun, childRun, unrelatedRun].map((run) => [run.id, run])
    )

    expect(
      getAgentWorkbenchPendingApprovals({
        approvals: [
          createApproval({
            runId: childRun.id
          }),
          createApproval({
            runId: unrelatedRun.id
          })
        ],
        rootRun,
        runsById
      }).map((approval) => approval.runId)
    ).toEqual([childRun.id])
  })

  it("builds session previews for branch and compaction controls", () => {
    const run = createRun({
      id: "run-root",
      parentRunId: null
    })
    const snapshot = {
      context: [
        {
          content: "Start.",
          role: "user",
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
          summary: "Forked after start.",
          type: "branch_summary"
        },
        {
          id: "entry-4",
          message: {
            data: {
              checkpointId: "checkpoint-1"
            },
            type: "checkpoint"
          },
          parentId: "entry-3",
          sequence: 4,
          type: "custom_message"
        },
        {
          id: "entry-5",
          parentId: "entry-3",
          sequence: 5,
          targetEntryId: "entry-4",
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

    expect(getAgentWorkbenchSessionPreview(snapshot)).toEqual({
      contextCount: 1,
      entries: [
        {
          detail: "Start.",
          id: "entry-1",
          label: "#1 user",
          type: "message"
        },
        {
          detail: "Forked after start.",
          id: "entry-3",
          label: "#3 branch summary",
          type: "branch_summary"
        },
        {
          detail:
            '{"data":{"checkpointId":"checkpoint-1"},"type":"checkpoint"}',
          id: "entry-4",
          label: "#4 checkpoint",
          type: "custom_message"
        }
      ],
      leafEntryId: "entry-4",
      sessionEventCount: 1
    })
    expect(
      getAgentWorkbenchSessionPreview({
        context: [],
        entries: [],
        events: [],
        run: null
      })
    ).toBeNull()
  })

  it("summarizes the current workspace diff for the workbench", () => {
    const preview = getAgentWorkbenchDiffPreview({
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
      truncated: true
    })

    expect(preview).toEqual({
      additions: 2,
      changedFileCount: 1,
      deletions: 1,
      files: [
        {
          additions: 2,
          deletions: 1,
          path: "src/value.ts"
        }
      ],
      hasChanges: true,
      truncated: true
    })
    expect(getAgentWorkbenchDiffPreview()).toMatchObject({
      changedFileCount: 0,
      hasChanges: false
    })
  })
})
