import type { ChatSessionPlan, ChatSessionPlanStatus } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildComposerPlanQueueProps,
  getActiveTodoIndex,
  getComposerPlanQueueMode,
  getPlanQueueProgress,
  getTodoDisplayLabel,
  hasImplementingSessionPlan
} from "@/renderer/lib/chat/plan-queue"
import type { ChatTodoItem, ChatTodoStatus } from "@/shared/chat/stream-data"

const plan = (status: ChatSessionPlanStatus): ChatSessionPlan => ({
  createdAt: "2026-07-15T00:00:00.000Z",
  decidedAt: null,
  planMarkdown: "## Steps\n\n1. Do the thing",
  sessionId: "session-1",
  sourceRunId: null,
  sourceToolCallId: null,
  status,
  title: "Refactor auth",
  updatedAt: "2026-07-15T00:00:00.000Z"
})

const todos = (statuses: ChatTodoStatus[]): ChatTodoItem[] =>
  statuses.map((status, index) => ({ content: `task ${index}`, status }))

const noop = (): void => {}
// Distinct references so the assembly test catches a swapped callback.
const onDismissRef = (): void => {}
const onMarkDoneRef = (): void => {}

describe("hasImplementingSessionPlan", () => {
  it("is true only while a plan is implementing", () => {
    expect(hasImplementingSessionPlan(plan("implementing"))).toBe(true)
  })

  it("is false for proposed, done, and dismissed plans", () => {
    expect(hasImplementingSessionPlan(plan("proposed"))).toBe(false)
    expect(hasImplementingSessionPlan(plan("done"))).toBe(false)
    expect(hasImplementingSessionPlan(plan("dismissed"))).toBe(false)
  })

  it("is false when there is no plan", () => {
    expect(hasImplementingSessionPlan(null)).toBe(false)
    expect(hasImplementingSessionPlan()).toBe(false)
  })
})

describe("getComposerPlanQueueMode", () => {
  it("shows steps whenever live todos exist, with or without a plan", () => {
    expect(
      getComposerPlanQueueMode({ hasPlan: false, todos: todos(["pending"]) })
    ).toBe("steps")
    expect(
      getComposerPlanQueueMode({
        hasPlan: true,
        todos: todos(["in_progress"])
      })
    ).toBe("steps")
  })

  it("shows the header for an implementing plan with no live todos", () => {
    expect(getComposerPlanQueueMode({ hasPlan: true })).toBe("header")
    expect(getComposerPlanQueueMode({ hasPlan: true, todos: [] })).toBe(
      "header"
    )
  })

  it("hides when there is neither a plan nor live todos", () => {
    expect(getComposerPlanQueueMode({ hasPlan: false })).toBe("hidden")
    expect(getComposerPlanQueueMode({ hasPlan: false, todos: [] })).toBe(
      "hidden"
    )
  })
})

describe("buildComposerPlanQueueProps", () => {
  it("returns nothing while the query is loading and no run is live", () => {
    expect(
      buildComposerPlanQueueProps({
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop
      })
    ).toBeUndefined()
  })

  it("returns nothing for a non-implementing plan with no live run", () => {
    expect(
      buildComposerPlanQueueProps({
        data: { plan: null },
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop
      })
    ).toBeUndefined()
    expect(
      buildComposerPlanQueueProps({
        data: { plan: plan("proposed") },
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop
      })
    ).toBeUndefined()
  })

  it("assembles props with the plan from an implementing plan", () => {
    const props = buildComposerPlanQueueProps({
      data: { plan: plan("implementing") },
      isBusy: true,
      onDismiss: onDismissRef,
      onMarkDone: onMarkDoneRef,
      runId: "run-1"
    })

    expect(props).toEqual({
      isBusy: true,
      onDismiss: onDismissRef,
      onMarkDone: onMarkDoneRef,
      plan: {
        planMarkdown: "## Steps\n\n1. Do the thing",
        title: "Refactor auth"
      },
      runId: "run-1"
    })
  })

  it("returns run-only props (no plan) for a live run without an implementing plan", () => {
    expect(
      buildComposerPlanQueueProps({
        data: { plan: plan("proposed") },
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop,
        runId: "run-1"
      })
    ).toEqual({
      isBusy: false,
      onDismiss: noop,
      onMarkDone: noop,
      plan: undefined,
      runId: "run-1"
    })
  })

  it("returns run-only props while the plan query is still loading", () => {
    expect(
      buildComposerPlanQueueProps({
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop,
        runId: "run-1"
      })
    ).toEqual({
      isBusy: false,
      onDismiss: noop,
      onMarkDone: noop,
      plan: undefined,
      runId: "run-1"
    })
  })
})

describe("getPlanQueueProgress", () => {
  it("returns nothing when no snapshot has arrived", () => {
    expect(getPlanQueueProgress()).toBeNull()
  })

  it("returns nothing for an empty checklist", () => {
    expect(getPlanQueueProgress([])).toBeNull()
  })

  it("counts completed against the total", () => {
    expect(
      getPlanQueueProgress(
        todos(["completed", "completed", "in_progress", "pending"])
      )
    ).toEqual({ completed: 2, total: 4 })
  })

  it("counts only completed items, not in-progress ones", () => {
    expect(getPlanQueueProgress(todos(["in_progress", "pending"]))).toEqual({
      completed: 0,
      total: 2
    })
  })
})

describe("getActiveTodoIndex", () => {
  it("returns the first in-progress index", () => {
    expect(
      getActiveTodoIndex(todos(["completed", "in_progress", "in_progress"]))
    ).toBe(1)
  })

  it("returns -1 when nothing is in progress", () => {
    expect(getActiveTodoIndex(todos(["completed", "pending"]))).toBe(-1)
    expect(getActiveTodoIndex([])).toBe(-1)
  })
})

describe("getTodoDisplayLabel", () => {
  it("uses activeForm for an in-progress item that has one", () => {
    expect(
      getTodoDisplayLabel({
        activeForm: "Writing tests",
        content: "Write tests",
        status: "in_progress"
      })
    ).toBe("Writing tests")
  })

  it("falls back to content without activeForm or when not in progress", () => {
    expect(
      getTodoDisplayLabel({ content: "Write tests", status: "in_progress" })
    ).toBe("Write tests")
    expect(
      getTodoDisplayLabel({
        activeForm: "Writing tests",
        content: "Write tests",
        status: "pending"
      })
    ).toBe("Write tests")
  })
})
