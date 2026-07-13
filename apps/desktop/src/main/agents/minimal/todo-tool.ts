import { tool } from "ai"
import type { UIMessage, UIMessageStreamWriter } from "ai"
import { z } from "zod"

import {
  CHAT_TODO_DATA_TYPE,
  countTodosByStatus
} from "@/shared/chat/stream-data"
import type { ChatTodoData } from "@/shared/chat/stream-data"

/**
 * `todo_write` tool: the agent's task checklist for long, multi-step runs.
 *
 * FULL-REPLACE by design — each call carries the ENTIRE list and supersedes the
 * previous one. The tool call itself (input = the todo list) is persisted by the
 * generic agent_tool_calls seam, so the run inspector replays it with no bespoke
 * event type; the transient `data-todo` part written here is only the live wire
 * feeding the work-section checklist, keyed by run id so the latest snapshot
 * always wins. Pure run metadata: it never needs approval.
 */

const MAX_TODO_ITEMS = 50

export const TodoWriteInputSchema = z
  .object({
    todos: z
      .array(
        z
          .object({
            activeForm: z
              .string()
              .min(1)
              .optional()
              .describe(
                'Present-continuous label shown while this item is in progress, e.g. "Writing tests".'
              ),
            content: z
              .string()
              .min(1)
              .describe('The task in imperative form, e.g. "Write tests".'),
            status: z.enum(["pending", "in_progress", "completed"])
          })
          .strict()
      )
      .max(MAX_TODO_ITEMS)
      .describe(
        "The COMPLETE todo list. This replaces the previous list entirely — always send every item, including ones already completed."
      )
  })
  .strict()

const TODO_TOOL_DESCRIPTION = `Maintain a task checklist for the current work so you and the user can see the plan and track progress on long or multi-step tasks.

FULL REPLACE: every call replaces the ENTIRE list with the todos you pass. Always send the complete list — include items already done (marked "completed"), not just the ones that changed. Any item you omit is dropped.

When to use it: for non-trivial work of roughly three or more steps, write the plan as todos up front, then call again to update statuses as you go. Skip it for single-step or trivial tasks.

Each todo has content (imperative, what to do), status (pending | in_progress | completed), and an optional activeForm (present-continuous, shown while the item is in progress, e.g. "Writing tests"). Keep exactly one item in_progress at a time, and mark an item completed as soon as it is actually done rather than batching completions at the end.`

export interface TodoToolContext {
  /** The persisted run the todos hang under; null only when run-start failed. */
  agentRunId: string | null
  writer?: UIMessageStreamWriter<UIMessage>
}

export const buildTodoTool = ({ agentRunId, writer }: TodoToolContext) =>
  tool({
    description: TODO_TOOL_DESCRIPTION,
    execute: ({ todos }) => {
      // Live wire for the work-section checklist. Keyed by run id (stable part
      // id) so successive snapshots reconcile to the latest one; transient so it
      // never persists — replay comes from the tool call's own input instead.
      if (agentRunId && writer) {
        writer.write({
          data: { runId: agentRunId, todos } satisfies ChatTodoData,
          id: `todo:${agentRunId}`,
          transient: true,
          type: CHAT_TODO_DATA_TYPE
        })
      }

      return { counts: countTodosByStatus(todos), ok: true as const }
    },
    inputSchema: TodoWriteInputSchema
  })
