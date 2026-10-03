// @vitest-environment happy-dom

import type { BestOfNRun, WorktreeDiff } from "@etyon/rpc/schemas/worktrees"
import { act, createElement } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vite-plus/test"

import { BestOfNPanel } from "@/renderer/components/chat/best-of-n-panel"
import type { BestOfNPanelProps } from "@/renderer/components/chat/best-of-n-panel"

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

const run: BestOfNRun = {
  candidates: [
    {
      id: "12345678-1234-4123-8123-123456789001",
      modelId: "model-one",
      state: "ready",
      summary: "First candidate",
      worktreeId: "12345678-1234-4123-8123-123456789010"
    },
    {
      id: "12345678-1234-4123-8123-123456789002",
      modelId: "model-two",
      state: "ready",
      summary: "Second candidate",
      worktreeId: "12345678-1234-4123-8123-123456789020"
    }
  ],
  createdAt: "2026-10-02T12:00:00Z",
  id: "12345678-1234-4123-8123-123456789000",
  prompt: "Implement the task",
  review: {
    recommendation: "First candidate meets the task",
    recommendedCandidateId: "12345678-1234-4123-8123-123456789001"
  },
  runId: "run",
  sessionId: "session",
  state: "ready"
}
const diff: WorktreeDiff = {
  additions: 1,
  conflicts: [],
  deletions: 1,
  fingerprint: "reviewed-fingerprint",
  patch: "-before\n+candidate implementation",
  paths: ["main.txt"],
  worktree: {
    baseCommit: "base",
    createdAt: "2026-10-02T12:00:00Z",
    directory: "/isolated",
    id: "12345678-1234-4123-8123-123456789010",
    label: "candidate",
    projectPath: "/project",
    repositoryRoot: "/project",
    runId: "run",
    sessionId: "session",
    state: "ready",
    workspacePath: "/isolated"
  }
}

const render = (element: ReactElement) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
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
    container
  }
}
const button = (container: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label
  )
  if (!found) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}
const fixture = (): BestOfNPanelProps => ({
  models: [
    { id: "model-one", label: "Model One" },
    { id: "model-two", label: "Model Two" }
  ],
  onApply: vi.fn(() =>
    Promise.resolve({
      appliedPaths: [],
      conflicts: [],
      error: "Files changed since preview.",
      ok: false
    })
  ),
  onCancel: vi.fn(() => Promise.resolve()),
  onDiscard: vi.fn(() => Promise.resolve()),
  onPreview: vi.fn(() => Promise.resolve(diff)),
  onStart: vi.fn(() => Promise.resolve()),
  runs: [run]
})

describe("Best-of-N selection UI", () => {
  it("requires a real preview before applying and surfaces a stale-fingerprint failure", async () => {
    const props = fixture()
    const view = render(createElement(BestOfNPanel, props))
    try {
      expect(view.container.textContent).toContain("First candidate")
      expect(view.container.textContent).toContain("评审建议")
      expect(
        [...view.container.querySelectorAll("button")].some(
          (candidate) => candidate.textContent === "采纳此方案"
        )
      ).toBe(false)
      await act(async () => {
        button(view.container, "预览改动").click()
        await Promise.resolve()
      })
      expect(props.onPreview).toHaveBeenCalledWith(
        run.id,
        run.candidates[0]?.id
      )
      expect(view.container.textContent).toContain("candidate implementation")
      expect(button(view.container, "采纳此方案").disabled).toBe(false)
      await act(async () => {
        button(view.container, "采纳此方案").click()
        await Promise.resolve()
      })
      expect(props.onApply).toHaveBeenCalledWith(
        run.id,
        run.candidates[0]?.id,
        diff.fingerprint
      )
      expect(
        view.container.querySelector('[role="alert"]')?.textContent
      ).toContain("Files changed since preview")
    } finally {
      view.cleanup()
    }
  })

  it("disables selection on conflicts and asks before discarding retained alternatives", async () => {
    const props = fixture()
    props.onPreview = vi.fn(() =>
      Promise.resolve({ ...diff, conflicts: ["main.txt"] })
    )
    const view = render(createElement(BestOfNPanel, props))
    try {
      await act(async () => {
        button(view.container, "预览改动").click()
        await Promise.resolve()
      })
      expect(button(view.container, "采纳此方案").disabled).toBe(true)
      expect(
        view.container.querySelector('[role="alert"]')?.textContent
      ).toContain("main.txt")
      await act(async () => {
        button(view.container, "丢弃候选方案").click()
        await Promise.resolve()
      })
      expect(props.onDiscard).not.toHaveBeenCalled()
      await act(async () => {
        button(view.container, "确认丢弃").click()
        await Promise.resolve()
      })
      expect(props.onDiscard).toHaveBeenCalledWith(run.id)
    } finally {
      view.cleanup()
    }
  })
})
