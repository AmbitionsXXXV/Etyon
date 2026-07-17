import type { AgentRunTraceRun, AgentRunTraceToolCall } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import type { ChatToolPart } from "@/renderer/lib/chat/assistant-message-timeline"
import type { SubagentLiveState } from "@/renderer/lib/chat/subagent-stream-store"
import {
  delegatePartViewModel,
  isUnsettledRunStatus,
  liveSubagentViewModel,
  selectWorkflowChildRuns,
  subagentStatusFromPartState,
  subagentStatusFromRunStatus,
  traceToolCallsToParts,
  workflowChildRunViewModel
} from "@/renderer/lib/chat/subagent-view-model"
import { WORKFLOW_CHILD_PROFILE_ID } from "@/shared/agents/subagent-tools"
import type { ChatSubagentApprovalData } from "@/shared/chat/stream-data"

const partState = (state: string): Pick<ChatToolPart, "state"> =>
  ({ state }) as unknown as Pick<ChatToolPart, "state">

const delegatePart = (overrides: Record<string, unknown>): ChatToolPart =>
  ({
    toolCallId: "tc-1",
    type: "tool-delegate",
    ...overrides
  }) as unknown as ChatToolPart

const run = (overrides: Partial<AgentRunTraceRun>): AgentRunTraceRun => ({
  chatSessionId: "s1",
  errorMessage: null,
  finishedAt: null,
  id: "run-1",
  modelId: null,
  parentRunId: "parent-run",
  parentToolCallId: null,
  profileId: WORKFLOW_CHILD_PROFILE_ID,
  startedAt: "2026-07-17T00:00:00.000Z",
  status: "succeeded",
  ...overrides
})

const toolCall = (
  overrides: Partial<AgentRunTraceToolCall>
): AgentRunTraceToolCall => ({
  approvalState: "not_required",
  errorMessage: null,
  finishedAt: null,
  id: "tc-1",
  input: {},
  output: undefined,
  parentToolCallId: null,
  runId: "run-1",
  startedAt: "2026-07-17T00:00:00.000Z",
  state: "finished",
  toolName: "read",
  ...overrides
})

const liveState = (
  overrides: Partial<SubagentLiveState>
): SubagentLiveState => ({
  blockIndexById: {},
  childRunId: "c1",
  meta: { childRunId: "c1", profileId: "coder", task: "build the thing" },
  parts: [],
  startedAtMs: 1000,
  status: "running",
  ...overrides
})

const approval = (
  overrides: Partial<ChatSubagentApprovalData> &
    Pick<ChatSubagentApprovalData, "approvalId" | "childRunId">
): ChatSubagentApprovalData => ({
  canRemember: false,
  commandOrPath: "src/a.ts",
  dangerous: false,
  toolName: "edit",
  ...overrides
})

describe("subagentStatusFromRunStatus", () => {
  it("maps every run status to a displayed status", () => {
    expect(subagentStatusFromRunStatus("succeeded")).toBe("succeeded")
    expect(subagentStatusFromRunStatus("failed")).toBe("failed")
    expect(subagentStatusFromRunStatus("superseded")).toBe("aborted")
    expect(subagentStatusFromRunStatus("running")).toBe("running")
    expect(subagentStatusFromRunStatus("suspended")).toBe("running")
  })
})

describe("subagentStatusFromPartState", () => {
  it("maps every relevant tool part state to a displayed status", () => {
    expect(subagentStatusFromPartState(partState("output-available"))).toBe(
      "succeeded"
    )
    expect(subagentStatusFromPartState(partState("output-error"))).toBe(
      "failed"
    )
    expect(subagentStatusFromPartState(partState("output-denied"))).toBe(
      "failed"
    )
    expect(subagentStatusFromPartState(partState("input-available"))).toBe(
      "running"
    )
    expect(subagentStatusFromPartState(partState("input-streaming"))).toBe(
      "running"
    )
    expect(subagentStatusFromPartState(partState("approval-requested"))).toBe(
      "running"
    )
  })
})

describe("isUnsettledRunStatus", () => {
  it("treats running and suspended as unsettled, the rest as settled", () => {
    expect(isUnsettledRunStatus("running")).toBe(true)
    expect(isUnsettledRunStatus("suspended")).toBe(true)
    expect(isUnsettledRunStatus("succeeded")).toBe(false)
    expect(isUnsettledRunStatus("failed")).toBe(false)
    expect(isUnsettledRunStatus("superseded")).toBe(false)
  })
})

describe("delegatePartViewModel", () => {
  it("opens a trace body from the recorded child run id and reads profile/task", () => {
    const vm = delegatePartViewModel(
      delegatePart({
        input: { profileId: "coder", task: "do X" },
        output: { childRunId: "run-9", summary: "did it" },
        state: "output-available"
      })
    )

    expect(vm).toEqual({
      approvals: [],
      body: { kind: "trace", runId: "run-9" },
      origin: "delegate",
      profileId: "coder",
      status: "succeeded",
      task: "do X"
    })
  })

  it("falls back to the summary body when there is no child run id", () => {
    const vm = delegatePartViewModel(
      delegatePart({
        input: { profileId: "explore", task: "look around" },
        output: { summary: "just a summary" },
        state: "output-available"
      })
    )

    expect(vm.body).toEqual({ kind: "summary", text: "just a summary" })
    expect(vm.status).toBe("succeeded")
  })

  it("renders no body when a succeeded output carries neither field", () => {
    const vm = delegatePartViewModel(
      delegatePart({ input: {}, output: {}, state: "output-available" })
    )

    expect(vm.body).toEqual({ kind: "none" })
    expect(vm.profileId).toBe("")
    expect(vm.task).toBeUndefined()
  })

  it("stays running with no body while the output has not arrived", () => {
    const vm = delegatePartViewModel(
      delegatePart({
        input: { profileId: "coder", task: "t" },
        state: "input-available"
      })
    )

    expect(vm.status).toBe("running")
    expect(vm.body).toEqual({ kind: "none" })
  })

  it("marks output-error as failed and never reads the output field", () => {
    const vm = delegatePartViewModel(
      delegatePart({
        input: { profileId: "coder", task: "t" },
        output: { childRunId: "run-x" },
        state: "output-error"
      })
    )

    expect(vm.status).toBe("failed")
    expect(vm.body).toEqual({ kind: "none" })
  })

  it("marks output-denied as failed", () => {
    const vm = delegatePartViewModel(
      delegatePart({ input: {}, state: "output-denied" })
    )

    expect(vm.status).toBe("failed")
    expect(vm.body).toEqual({ kind: "none" })
  })
})

describe("workflowChildRunViewModel", () => {
  it("reports a duration once the run has a finished timestamp", () => {
    const vm = workflowChildRunViewModel(
      run({
        finishedAt: "2026-07-17T00:00:05.000Z",
        id: "r1",
        startedAt: "2026-07-17T00:00:00.000Z",
        status: "succeeded"
      })
    )

    expect(vm).toEqual({
      approvals: [],
      body: { kind: "trace", runId: "r1" },
      durationMs: 5000,
      origin: "workflow",
      profileId: WORKFLOW_CHILD_PROFILE_ID,
      status: "succeeded"
    })
  })

  it("omits the duration while the run is still unfinished", () => {
    const vm = workflowChildRunViewModel(
      run({ finishedAt: null, id: "r2", status: "running" })
    )

    expect(vm.durationMs).toBeUndefined()
    expect(vm.status).toBe("running")
    expect(vm.body).toEqual({ kind: "trace", runId: "r2" })
  })

  it("clamps a finished-before-started duration to zero", () => {
    const vm = workflowChildRunViewModel(
      run({
        finishedAt: "2026-07-17T00:00:00.000Z",
        startedAt: "2026-07-17T00:00:05.000Z"
      })
    )

    expect(vm.durationMs).toBe(0)
  })
})

describe("liveSubagentViewModel", () => {
  it("carries running activity, the live timer base, and forwards approvals", () => {
    const parts = [
      { state: "done", text: "hi", type: "text" }
    ] as SubagentLiveState["parts"]
    const approvals = [approval({ approvalId: "c1:tc", childRunId: "c1" })]
    const vm = liveSubagentViewModel(
      liveState({ activity: "read a.ts", parts, status: "running" }),
      approvals
    )

    expect(vm.origin).toBe("delegate")
    expect(vm.status).toBe("running")
    expect(vm.activity).toBe("read a.ts")
    expect(vm.startedAtMs).toBe(1000)
    expect(vm.profileId).toBe("coder")
    expect(vm.task).toBe("build the thing")
    expect(vm.durationMs).toBeUndefined()
    expect(vm.body).toEqual({ isRunActive: true, kind: "live-parts", parts })
    expect(vm.approvals).toBe(approvals)
  })

  it("freezes the duration and drops the active flag once settled", () => {
    const vm = liveSubagentViewModel(
      liveState({ durationMs: 4200, status: "succeeded" }),
      []
    )

    expect(vm.status).toBe("succeeded")
    expect(vm.durationMs).toBe(4200)
    expect(vm.body).toEqual({
      isRunActive: false,
      kind: "live-parts",
      parts: []
    })
  })
})

describe("traceToolCallsToParts", () => {
  it("maps a failed call to an output-error part with its message", () => {
    expect(
      traceToolCallsToParts([
        toolCall({
          errorMessage: "boom",
          id: "tc1",
          input: { pattern: "TODO" },
          state: "failed",
          toolName: "grep"
        })
      ])
    ).toEqual([
      {
        errorText: "boom",
        input: { pattern: "TODO" },
        state: "output-error",
        toolCallId: "tc1",
        type: "tool-grep"
      }
    ])
  })

  it("falls back to a generic error text when the failure has no message", () => {
    const [part] = traceToolCallsToParts([
      toolCall({ errorMessage: null, state: "failed" })
    ])

    expect(part).toMatchObject({ errorText: "error", state: "output-error" })
  })

  it("maps any non-failed call to an output-available part carrying the output", () => {
    expect(
      traceToolCallsToParts([
        toolCall({
          id: "tc2",
          input: { path: "a.ts" },
          output: "1\tx",
          state: "finished",
          toolName: "read"
        }),
        toolCall({ id: "tc3", output: "still going", state: "running" })
      ])
    ).toEqual([
      {
        input: { path: "a.ts" },
        output: "1\tx",
        state: "output-available",
        toolCallId: "tc2",
        type: "tool-read"
      },
      {
        input: {},
        output: "still going",
        state: "output-available",
        toolCallId: "tc3",
        type: "tool-read"
      }
    ])
  })
})

describe("selectWorkflowChildRuns", () => {
  it("returns only the runs tagged with this tool call, chronologically", () => {
    // listRuns is DESC (newest first); r2 is a sibling under the same parent run
    // but a different tool call and must not leak in.
    const runs = [
      run({ id: "r3", parentToolCallId: "wf-1" }),
      run({ id: "r2", parentToolCallId: "wf-2" }),
      run({ id: "r1", parentToolCallId: "wf-1" })
    ]

    expect(
      selectWorkflowChildRuns(runs, "wf-1").map((entry) => entry.id)
    ).toEqual(["r1", "r3"])
  })

  it("returns nothing when tagged data exists but none matches this call", () => {
    const runs = [
      run({ id: "r2", parentToolCallId: "wf-2" }),
      run({ id: "r1", parentToolCallId: "wf-3" })
    ]

    expect(selectWorkflowChildRuns(runs, "wf-1")).toEqual([])
  })

  it("falls back to the explore-profile filter for pure legacy rows", () => {
    // Every parentToolCallId is null (pre-migration); a non-explore sibling is
    // excluded and the explore rows come back chronologically.
    const runs = [
      run({
        id: "rb",
        parentToolCallId: null,
        profileId: WORKFLOW_CHILD_PROFILE_ID
      }),
      run({ id: "rx", parentToolCallId: null, profileId: "coder" }),
      run({
        id: "ra",
        parentToolCallId: null,
        profileId: WORKFLOW_CHILD_PROFILE_ID
      })
    ]

    expect(
      selectWorkflowChildRuns(runs, "wf-1").map((entry) => entry.id)
    ).toEqual(["ra", "rb"])
  })
})
