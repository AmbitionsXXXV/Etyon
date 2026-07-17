import { describe, expect, it } from "vite-plus/test"

import {
  INITIAL_PLAN_HINT_STATE,
  planHintReducer,
  shouldSuggestPlanMode
} from "@/renderer/lib/chat/plan-hint"
import type { PlanHintState } from "@/renderer/lib/chat/plan-hint"

describe("shouldSuggestPlanMode", () => {
  it("suggests for a long zh draft with a plan-intent keyword", () => {
    expect(
      shouldSuggestPlanMode(
        "我们需要重新设计整个智能体运行时的事件溯源架构，并迁移现有的数据库结构以支持并发子代理的写入，同时保证审批流程的正确性。"
      )
    ).toBe(true)
  })

  it("suggests for a long en draft with a plan-intent keyword", () => {
    expect(
      shouldSuggestPlanMode(
        "We should refactor the authentication layer and redesign how chat sessions persist across the desktop app."
      )
    ).toBe(true)
  })

  it("suggests for a long draft shaped as a bulleted list", () => {
    expect(
      shouldSuggestPlanMode(
        "Please take care of the following items for the dashboard view:\n- align the header spacing\n- tidy up the empty state"
      )
    ).toBe(true)
  })

  it("does not suggest for a short draft even with a keyword", () => {
    expect(shouldSuggestPlanMode("refactor this")).toBe(false)
  })

  it("does not suggest for a long plain single-sentence draft", () => {
    expect(
      shouldSuggestPlanMode(
        "The small login button on the account settings screen looks slightly off center on my display"
      )
    ).toBe(false)
  })
})

const show = (state: PlanHintState): PlanHintState =>
  planHintReducer(state, { canShow: true, type: "evaluate" })

describe("planHintReducer", () => {
  it("shows once per draft and stays hidden after an auto-timeout", () => {
    const shown = show(INITIAL_PLAN_HINT_STATE)
    expect(shown.visible).toBe(true)

    const timedOut = planHintReducer(shown, { type: "conceal" })
    expect(timedOut.visible).toBe(false)
    // Auto-timeout is not a dismissal, so the session guard is untouched…
    expect(timedOut.dismissCount).toBe(0)

    // …but the same draft must not resurface the hint.
    expect(show(timedOut).visible).toBe(false)

    // A fresh draft lifecycle clears the per-draft guard.
    const afterReset = planHintReducer(timedOut, { type: "reset" })
    expect(show(afterReset).visible).toBe(true)
  })

  it("stops suggesting for the session after two dismissals", () => {
    let state = show(INITIAL_PLAN_HINT_STATE)
    state = planHintReducer(state, { type: "dismiss" })
    state = planHintReducer(planHintReducer(state, { type: "reset" }), {
      canShow: true,
      type: "evaluate"
    })
    state = planHintReducer(state, { type: "dismiss" })
    expect(state.dismissCount).toBe(2)

    const afterReset = planHintReducer(state, { type: "reset" })
    expect(show(afterReset).visible).toBe(false)
  })

  it("ignores an evaluate when the heuristic declines", () => {
    expect(
      planHintReducer(INITIAL_PLAN_HINT_STATE, {
        canShow: false,
        type: "evaluate"
      }).visible
    ).toBe(false)
  })
})
