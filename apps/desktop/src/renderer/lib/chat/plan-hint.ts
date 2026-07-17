/**
 * Pure heuristic + frequency-guard reducer behind the timed plan-mode hint
 * (Feature D). No rpc, no React — the composer hook layers debounce, motion, and
 * the countdown on top, but the "is this plan-worthy" and "may we show it again"
 * rules live here so they stay node-testable.
 */

const PLAN_HINT_MIN_DRAFT_LENGTH = 60
const MIN_SENTENCE_ENDERS = 3

// Top-level literals (never constructed in a loop): a zh/en plan-intent keyword
// hit — the English ones word-boundaried so "plan" doesn't fire inside
// "planning" — or a multi-requirement shape (a list line or 3+ sentences).
const PLAN_INTENT_KEYWORD_PATTERN =
  /设计|方案|架构|重构|规划|迁移|新功能|\b(?:redesign|refactor|architect|plan|migrate|implement a|build a)\b/iu
const MULTI_REQUIREMENT_LIST_PATTERN = /^\s*(?:\d+[.、)]|[-*])\s/mu
const SENTENCE_ENDER_PATTERN = /[。！？.!?]/gu

/**
 * True when the draft looks like a task worth planning first: at least
 * {@link PLAN_HINT_MIN_DRAFT_LENGTH} characters AND either a plan-intent keyword
 * or a multi-requirement shape (numbered/bulleted list, or 3+ sentence enders).
 */
export const shouldSuggestPlanMode = (draft: string): boolean => {
  const trimmed = draft.trim()

  if (trimmed.length < PLAN_HINT_MIN_DRAFT_LENGTH) {
    return false
  }

  if (
    PLAN_INTENT_KEYWORD_PATTERN.test(trimmed) ||
    MULTI_REQUIREMENT_LIST_PATTERN.test(trimmed)
  ) {
    return true
  }

  const enders = trimmed.match(SENTENCE_ENDER_PATTERN)

  return (enders?.length ?? 0) >= MIN_SENTENCE_ENDERS
}

export const MAX_PLAN_HINT_DISMISSALS = 2

export interface PlanHintState {
  /** Session-wide count of explicit dismissals (X / Escape). */
  dismissCount: number
  /** Whether the hint has already been shown for the current draft lifecycle. */
  shownForDraft: boolean
  visible: boolean
}

export const INITIAL_PLAN_HINT_STATE: PlanHintState = {
  dismissCount: 0,
  shownForDraft: false,
  visible: false
}

export type PlanHintEvent =
  | { canShow: boolean; type: "evaluate" }
  // conceal = auto-timeout, mode switch, or eligibility loss — NOT a dismissal.
  | { type: "conceal" }
  // dismiss = explicit close (X / Escape) — counts toward the session guard.
  | { type: "dismiss" }
  // reset = draft was sent or cleared, so a fresh draft may show the hint again.
  | { type: "reset" }

export const planHintReducer = (
  state: PlanHintState,
  event: PlanHintEvent
): PlanHintState => {
  switch (event.type) {
    case "evaluate": {
      if (
        !event.canShow ||
        state.visible ||
        state.shownForDraft ||
        state.dismissCount >= MAX_PLAN_HINT_DISMISSALS
      ) {
        return state
      }

      return { ...state, shownForDraft: true, visible: true }
    }
    case "dismiss": {
      if (!state.visible) {
        return state
      }

      return {
        ...state,
        dismissCount: state.dismissCount + 1,
        visible: false
      }
    }
    case "conceal": {
      if (!state.visible) {
        return state
      }

      return { ...state, visible: false }
    }
    case "reset": {
      if (!state.shownForDraft && !state.visible) {
        return state
      }

      return { ...state, shownForDraft: false, visible: false }
    }
    default: {
      return state
    }
  }
}
