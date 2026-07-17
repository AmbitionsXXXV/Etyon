/**
 * Pure logic behind the composer's plan execution indicator (Feature C). No rpc,
 * no React — the route owns the `getSessionPlan` query and the store subscription,
 * but "should the row show", "how far along are the todos", and assembling the
 * indicator's props live here so they stay node-testable.
 */

import type { ChatSessionPlan, SessionPlanOutput } from "@etyon/rpc"

import { countTodosByStatus } from "@/shared/chat/stream-data"
import type { ChatTodoItem } from "@/shared/chat/stream-data"

export interface ComposerPlanIndicatorProps {
  /** Whether a status mutation is in flight — disables the overflow menu. */
  isBusy: boolean
  onDismiss: () => void
  onMarkDone: () => void
  planMarkdown: string
  /** Active run id for the live todo checklist; omit between turns. */
  runId?: string
  title: string
}

/**
 * The indicator is visible only while a saved plan is being executed — the
 * `implementing` status survives turns and restarts, independent of any live run.
 * `proposed`/`done`/`dismissed` (and no plan at all) hide it.
 */
export const isPlanIndicatorVisible = (
  plan?: ChatSessionPlan | null
): plan is ChatSessionPlan => plan?.status === "implementing"

/**
 * Assembles the indicator's props from the plan query result, or `undefined`
 * when the row should not render. Kept pure — the route supplies the callbacks
 * and live run id — so both the visibility rule and the prop shape are
 * node-testable, and the decision stays out of the composer route.
 */
export const buildPlanIndicatorProps = ({
  data,
  isBusy,
  onDismiss,
  onMarkDone,
  runId
}: {
  data?: SessionPlanOutput
  isBusy: boolean
  onDismiss: () => void
  onMarkDone: () => void
  runId?: string
}): ComposerPlanIndicatorProps | undefined => {
  const plan = data?.plan

  if (!isPlanIndicatorVisible(plan)) {
    return undefined
  }

  return {
    isBusy,
    onDismiss,
    onMarkDone,
    planMarkdown: plan.planMarkdown,
    runId,
    title: plan.title
  }
}

export interface PlanIndicatorProgress {
  completed: number
  total: number
}

/**
 * Live `{completed}/{total}` for the streaming run, or `null` when there is
 * nothing to show — no run id, no snapshot yet, or an empty checklist. Between
 * turns the todo store is cleared, so this returns `null` and the row falls back
 * to the title only.
 */
export const getPlanIndicatorProgress = (
  todos?: ChatTodoItem[]
): PlanIndicatorProgress | null => {
  if (todos === undefined || todos.length === 0) {
    return null
  }

  return { completed: countTodosByStatus(todos).completed, total: todos.length }
}
