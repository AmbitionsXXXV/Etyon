import type { BestOfNRun, ManagedWorktree } from "@etyon/rpc/schemas/worktrees"
import { describe, expect, it } from "vite-plus/test"

import { buildWorktreeSidebarSummary } from "@/main/agents/worktrees/sidebar-summary"

const uuid = (suffix: number): string =>
  `12345678-1234-4123-8123-${String(suffix).padStart(12, "0")}`

const tree = (
  id: number,
  sessionId: string,
  state: ManagedWorktree["state"]
): ManagedWorktree => ({
  baseCommit: "base",
  createdAt: "2026-10-01T00:00:00Z",
  directory: `/trees/${id}`,
  id: uuid(id),
  label: `tree-${id}`,
  projectPath: "/project",
  repositoryRoot: "/project",
  runId: "run",
  sessionId,
  state,
  workspacePath: `/trees/${id}`
})

const run = (
  id: number,
  sessionId: string,
  createdAt: string,
  state: BestOfNRun["state"],
  worktreeId?: number
): BestOfNRun => ({
  candidates: [
    {
      id: uuid(id + 100),
      modelId: "model-a",
      state: "ready",
      stats: { additions: 4, changedFileCount: 3, deletions: 1 },
      summary: "",
      ...(worktreeId === undefined ? {} : { worktreeId: uuid(worktreeId) })
    },
    { id: uuid(id + 200), modelId: "model-b", state: "running", summary: "" }
  ],
  createdAt,
  id: uuid(id),
  prompt: "task",
  review: { recommendation: "", recommendedCandidateId: uuid(id + 100) },
  runId: "run",
  sessionId,
  state
})

describe("buildWorktreeSidebarSummary", () => {
  it("keeps only the latest run per session and marks the recommendation", () => {
    const [summary] = buildWorktreeSidebarSummary(
      [
        run(1, "s1", "2026-10-01T00:00:00Z", "applied"),
        run(2, "s1", "2026-10-02T00:00:00Z", "running", 9)
      ],
      [tree(9, "s1", "ready")]
    )

    expect(summary).toEqual({
      hasInterruptedWorktree: false,
      keptWorktreeCount: 0,
      run: {
        candidates: [
          {
            changedFileCount: 3,
            id: uuid(102),
            modelId: "model-a",
            recommended: true,
            state: "ready"
          },
          {
            changedFileCount: null,
            id: uuid(202),
            modelId: "model-b",
            recommended: false,
            state: "running"
          }
        ],
        id: uuid(2),
        isResolved: false
      },
      sessionId: "s1"
    })
  })

  it("counts kept workspaces outside runs and flags interrupted ones", () => {
    expect(
      buildWorktreeSidebarSummary(
        [run(1, "s1", "2026-10-01T00:00:00Z", "cancelled")],
        [
          tree(5, "s2", "orphaned"),
          tree(6, "s2", "ready"),
          tree(7, "s2", "applied")
        ]
      )
    ).toEqual([
      expect.objectContaining({
        keptWorktreeCount: 0,
        run: expect.objectContaining({ isResolved: true }),
        sessionId: "s1"
      }),
      {
        hasInterruptedWorktree: true,
        keptWorktreeCount: 2,
        run: null,
        sessionId: "s2"
      }
    ])
  })
})
