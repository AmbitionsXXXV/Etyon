import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  applySubagentApproval,
  clearSubagents,
  getHasSubagentApprovalPendingSnapshot,
  getSubagentApprovalsSnapshot,
  reduceSubagentChunk
} from "@/renderer/lib/chat/subagent-stream-store"
import type { SubagentPartsAcc } from "@/renderer/lib/chat/subagent-stream-store"
import type { ChatSubagentApprovalData } from "@/shared/chat/stream-data"

const EMPTY: SubagentPartsAcc = { blockIndexById: {}, parts: [] }

const fold = (chunks: unknown[]): SubagentPartsAcc => {
  let acc: SubagentPartsAcc = EMPTY

  for (const chunk of chunks) {
    acc = reduceSubagentChunk(acc, chunk)
  }

  return acc
}

describe("reduceSubagentChunk", () => {
  it("assembles a streamed text block and marks it done", () => {
    const { parts } = fold([
      { id: "t1", type: "text-start" },
      { delta: "Hel", id: "t1", type: "text-delta" },
      { delta: "lo", id: "t1", type: "text-delta" },
      { id: "t1", type: "text-end" }
    ])

    expect(parts).toEqual([{ state: "done", text: "Hello", type: "text" }])
  })

  it("assembles a reasoning block independently of text", () => {
    const { parts } = fold([
      { id: "r1", type: "reasoning-start" },
      { delta: "think", id: "r1", type: "reasoning-delta" },
      { id: "r1", type: "reasoning-end" }
    ])

    expect(parts).toEqual([{ state: "done", text: "think", type: "reasoning" }])
  })

  it("builds a tool part across input/output and derives an activity label", () => {
    const acc = fold([
      { toolCallId: "c1", toolName: "read", type: "tool-input-start" },
      {
        input: { path: "a.ts" },
        toolCallId: "c1",
        toolName: "read",
        type: "tool-input-available"
      },
      { output: "1\tx", toolCallId: "c1", type: "tool-output-available" }
    ])

    expect(acc.parts).toEqual([
      {
        input: { path: "a.ts" },
        output: "1\tx",
        state: "output-available",
        toolCallId: "c1",
        type: "tool-read"
      }
    ])
    expect(acc.activity).toBe("read a.ts")
  })

  it("records a tool output error with its text", () => {
    const { parts } = fold([
      {
        input: { pattern: "TODO" },
        toolCallId: "c9",
        toolName: "grep",
        type: "tool-input-available"
      },
      { errorText: "no ripgrep", toolCallId: "c9", type: "tool-output-error" }
    ])

    expect(parts).toEqual([
      {
        errorText: "no ripgrep",
        input: { pattern: "TODO" },
        state: "output-error",
        toolCallId: "c9",
        type: "tool-grep"
      }
    ])
  })

  it("interleaves reasoning, text, and tools in stream order", () => {
    const { parts } = fold([
      { id: "r1", type: "reasoning-start" },
      { delta: "plan", id: "r1", type: "reasoning-delta" },
      { id: "r1", type: "reasoning-end" },
      {
        input: { path: "." },
        toolCallId: "c1",
        toolName: "ls",
        type: "tool-input-available"
      },
      { output: "file\ta.ts", toolCallId: "c1", type: "tool-output-available" },
      { id: "t1", type: "text-start" },
      { delta: "done", id: "t1", type: "text-delta" },
      { id: "t1", type: "text-end" }
    ])

    expect(parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool-ls",
      "text"
    ])
  })

  it("ignores unknown chunks and returns the same accumulator reference", () => {
    const acc: SubagentPartsAcc = { blockIndexById: {}, parts: [] }

    expect(reduceSubagentChunk(acc, { type: "start" })).toBe(acc)
    expect(reduceSubagentChunk(acc, { type: "finish-step" })).toBe(acc)
    expect(reduceSubagentChunk(acc, null)).toBe(acc)
  })
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

describe("subagent approval routing", () => {
  afterEach(() => {
    clearSubagents()
  })

  it("adds a pending prompt and flags a global pending", () => {
    applySubagentApproval(
      approval({ approvalId: "child-1:tc-1", childRunId: "child-1" })
    )

    expect(getSubagentApprovalsSnapshot("child-1")).toHaveLength(1)
    expect(getHasSubagentApprovalPendingSnapshot()).toBe(true)
  })

  it("keeps a stable array reference across unrelated commits", () => {
    applySubagentApproval(
      approval({ approvalId: "child-1:tc-1", childRunId: "child-1" })
    )
    const first = getSubagentApprovalsSnapshot("child-1")

    // A commit for a different child must not churn child-1's snapshot.
    applySubagentApproval(
      approval({ approvalId: "child-2:tc-1", childRunId: "child-2" })
    )

    expect(getSubagentApprovalsSnapshot("child-1")).toBe(first)
  })

  it("drops a resolved prompt and clears the child when empty", () => {
    applySubagentApproval(
      approval({ approvalId: "child-1:tc-1", childRunId: "child-1" })
    )
    applySubagentApproval(
      approval({ approvalId: "child-1:tc-2", childRunId: "child-1" })
    )
    applySubagentApproval(
      approval({
        approvalId: "child-1:tc-1",
        childRunId: "child-1",
        resolved: "approved"
      })
    )

    expect(getSubagentApprovalsSnapshot("child-1")).toHaveLength(1)
    expect(getHasSubagentApprovalPendingSnapshot()).toBe(true)

    applySubagentApproval(
      approval({
        approvalId: "child-1:tc-2",
        childRunId: "child-1",
        resolved: "denied"
      })
    )

    expect(getSubagentApprovalsSnapshot("child-1")).toEqual([])
    expect(getHasSubagentApprovalPendingSnapshot()).toBe(false)
  })

  it("clears every pending approval when the turn is cleared", () => {
    applySubagentApproval(
      approval({ approvalId: "child-1:tc-1", childRunId: "child-1" })
    )
    clearSubagents()

    expect(getHasSubagentApprovalPendingSnapshot()).toBe(false)
    expect(getSubagentApprovalsSnapshot("child-1")).toEqual([])
  })
})
