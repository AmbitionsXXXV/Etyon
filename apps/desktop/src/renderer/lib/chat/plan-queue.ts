/**
 * Pure logic behind the composer's plan queue — the strip anchored above the
 * prompt input that pins the live todo checklist (and, while a saved plan is
 * being executed, its title and actions) instead of letting it jump around the
 * streaming timeline. No rpc, no React: the route owns the `getSessionPlan`
 * query and the store subscription, but "should the strip show", "which mode",
 * "how far along are the todos", and assembling the props live here so they stay
 * node-testable.
 */

import type { ChatSessionPlan, SessionPlanOutput } from "@etyon/rpc"

import { countTodosByStatus } from "@/shared/chat/stream-data"
import type { ChatTodoItem } from "@/shared/chat/stream-data"

/** The saved plan's identity, surfaced in the strip's header + view popover. */
export interface ComposerPlanQueuePlan {
  planMarkdown: string
  title: string
}

export interface ComposerPlanQueueProps {
  /** Whether a status mutation is in flight — disables the overflow menu. */
  isBusy: boolean
  onDismiss: () => void
  onMarkDone: () => void
  /** Present only while a saved plan is being executed (`implementing`). */
  plan?: ComposerPlanQueuePlan
  /** Active run id for the live todo checklist; omit between turns. */
  runId?: string
}

/**
 * A saved plan is being executed only while `implementing` — that status
 * survives turns and restarts, independent of any live run. `proposed`/`done`/
 * `dismissed` (and no plan at all) mean there is no plan to anchor.
 */
export const hasImplementingSessionPlan = (
  plan?: ChatSessionPlan | null
): plan is ChatSessionPlan => plan?.status === "implementing"

/**
 * Assembles the strip's props from the plan query result, or `undefined` when
 * the strip can never render this turn (no implementing plan and no active run).
 * A run-only turn (todos streaming before / without a saved plan) still returns
 * props — the component's mode then decides whether to show anything. Kept pure:
 * the route supplies the callbacks and live run id.
 */
export const buildComposerPlanQueueProps = ({
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
}): ComposerPlanQueueProps | undefined => {
  const plan = data?.plan
  const isImplementing = hasImplementingSessionPlan(plan)

  if (!isImplementing && runId === undefined) {
    return undefined
  }

  return {
    isBusy,
    onDismiss,
    onMarkDone,
    plan: isImplementing
      ? { planMarkdown: plan.planMarkdown, title: plan.title }
      : undefined,
    runId
  }
}

export type ComposerPlanQueueMode = "header" | "hidden" | "steps"

/**
 * Which face the strip shows: the full step checklist while live todos exist
 * (regardless of a saved plan), the plan header alone while a plan is being
 * executed with no live todos, or nothing at all.
 */
export const getComposerPlanQueueMode = ({
  hasPlan,
  todos
}: {
  hasPlan: boolean
  todos?: ChatTodoItem[]
}): ComposerPlanQueueMode => {
  if (todos !== undefined && todos.length > 0) {
    return "steps"
  }

  return hasPlan ? "header" : "hidden"
}

export interface PlanQueueProgress {
  completed: number
  total: number
}

/**
 * Live `{completed}/{total}` for the streaming run, or `null` when there is
 * nothing to show — no run id, no snapshot yet, or an empty checklist.
 */
export const getPlanQueueProgress = (
  todos?: ChatTodoItem[]
): PlanQueueProgress | null => {
  if (todos === undefined || todos.length === 0) {
    return null
  }

  return { completed: countTodosByStatus(todos).completed, total: todos.length }
}

/** Index of the first in-progress todo, or -1 when none is running. */
export const getActiveTodoIndex = (todos: readonly ChatTodoItem[]): number =>
  todos.findIndex((todo) => todo.status === "in_progress")

/** Present-tense `activeForm` while running, else the plain content. */
export const getTodoDisplayLabel = (todo: ChatTodoItem): string =>
  todo.status === "in_progress" && todo.activeForm
    ? todo.activeForm
    : todo.content
