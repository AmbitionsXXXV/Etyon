import type { WorktreeSidebarSession } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  formatRunProgress,
  getSidebarWorktreeDisplay,
  getVisibleSidebarRun
} from "@/renderer/lib/sidebar/worktree-summary"

const summary = (isResolved: boolean): WorktreeSidebarSession => ({
  hasInterruptedWorktree: false,
  keptWorktreeCount: 0,
  run: {
    candidates: [
      {
        changedFileCount: 3,
        id: "12345678-1234-4123-8123-000000000001",
        modelId: "a",
        recommended: true,
        state: "ready"
      },
      {
        changedFileCount: null,
        id: "12345678-1234-4123-8123-000000000002",
        modelId: "b",
        recommended: false,
        state: "running"
      }
    ],
    id: "12345678-1234-4123-8123-000000000000",
    isResolved
  },
  sessionId: "s"
})

describe("sidebar worktree summary", () => {
  it("nests in projects mode and badges in simple mode", () => {
    expect(
      getSidebarWorktreeDisplay({
        mode: "projects",
        nestWorktrees: true,
        showWorktreeBadges: false
      })
    ).toBe("nested")
    expect(
      getSidebarWorktreeDisplay({
        mode: "simple",
        nestWorktrees: true,
        showWorktreeBadges: true
      })
    ).toBe("badge")
    expect(
      getSidebarWorktreeDisplay({
        mode: "simple",
        nestWorktrees: true,
        showWorktreeBadges: false
      })
    ).toBe("hidden")
  })

  it("counts settled candidates and folds resolved runs when asked", () => {
    const live = summary(false)
    expect(formatRunProgress(live.run?.candidates ?? [])).toBe("1/2")
    expect(getVisibleSidebarRun(live, true)).toBe(live.run)
    expect(getVisibleSidebarRun(summary(true), true)).toBeNull()
    expect(getVisibleSidebarRun(summary(true), false)).not.toBeNull()
    expect(getVisibleSidebarRun(undefined, false)).toBeNull()
  })
})
