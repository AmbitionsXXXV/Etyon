import type { ChatSessionPlan, ChatSessionPlanStatus } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildPlanIndicatorProps,
  getPlanIndicatorProgress,
  isPlanIndicatorVisible
} from "@/renderer/lib/chat/plan-indicator"
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

describe("isPlanIndicatorVisible", () => {
  it("is visible only while a plan is implementing", () => {
    expect(isPlanIndicatorVisible(plan("implementing"))).toBe(true)
  })

  it("is hidden for proposed, done, and dismissed plans", () => {
    expect(isPlanIndicatorVisible(plan("proposed"))).toBe(false)
    expect(isPlanIndicatorVisible(plan("done"))).toBe(false)
    expect(isPlanIndicatorVisible(plan("dismissed"))).toBe(false)
  })

  it("is hidden when there is no plan", () => {
    expect(isPlanIndicatorVisible(null)).toBe(false)
    expect(isPlanIndicatorVisible()).toBe(false)
  })
})

describe("buildPlanIndicatorProps", () => {
  it("returns nothing while the query is still loading", () => {
    expect(
      buildPlanIndicatorProps({
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop
      })
    ).toBeUndefined()
  })

  it("returns nothing when there is no plan or it is not implementing", () => {
    expect(
      buildPlanIndicatorProps({
        data: { plan: null },
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop
      })
    ).toBeUndefined()
    expect(
      buildPlanIndicatorProps({
        data: { plan: plan("proposed") },
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop
      })
    ).toBeUndefined()
  })

  it("assembles props from an implementing plan", () => {
    const props = buildPlanIndicatorProps({
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
      planMarkdown: "## Steps\n\n1. Do the thing",
      runId: "run-1",
      title: "Refactor auth"
    })
  })
})

describe("getPlanIndicatorProgress", () => {
  it("returns nothing when no snapshot has arrived", () => {
    expect(getPlanIndicatorProgress()).toBeNull()
  })

  it("returns nothing for an empty checklist", () => {
    expect(getPlanIndicatorProgress([])).toBeNull()
  })

  it("counts completed against the total", () => {
    expect(
      getPlanIndicatorProgress(
        todos(["completed", "completed", "in_progress", "pending"])
      )
    ).toEqual({ completed: 2, total: 4 })
  })

  it("counts only completed items, not in-progress ones", () => {
    expect(getPlanIndicatorProgress(todos(["in_progress", "pending"]))).toEqual(
      {
        completed: 0,
        total: 2
      }
    )
  })
})
