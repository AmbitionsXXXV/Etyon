import type { UIMessage, UIMessageStreamWriter } from "ai"
import { tool } from "ai"
import { z } from "zod"

import type { AgentTask, AgentTaskStore } from "@/main/agents/task-store"
import {
  CHAT_TODO_DATA_TYPE,
  countTodosByStatus
} from "@/shared/chat/stream-data"
import type { ChatTodoItem } from "@/shared/chat/stream-data"

const TaskFields = {
  activeForm: z.string().trim().min(1).max(500).nullable().optional(),
  blockedBy: z.array(z.string().min(1)).max(100).optional(),
  description: z.string().max(8000).optional(),
  owner: z.string().trim().min(1).max(200).nullable().optional(),
  subject: z.string().trim().min(1).max(500)
}

export const TaskCreateInputSchema = z.object(TaskFields).strict()
export const TaskUpdateInputSchema = z
  .object({
    ...TaskFields,
    id: z.string().min(1),
    revision: z.number().int().positive(),
    status: z
      .enum(["pending", "in_progress", "completed", "deleted"])
      .optional(),
    subject: TaskFields.subject.optional()
  })
  .strict()

const toTodo = (task: AgentTask, tasks: AgentTask[]): ChatTodoItem => ({
  ...(task.activeForm ? { activeForm: task.activeForm } : {}),
  blockedBy: tasks
    .filter(
      (entry) =>
        task.blockedBy.includes(entry.id) && entry.status !== "completed"
    )
    .map((entry) => entry.subject),
  content: task.subject,
  id: task.id,
  ...(task.owner ? { owner: task.owner } : {}),
  status: task.status
})

export const buildTaskTools = ({
  agentRunId,
  store,
  writer
}: {
  agentRunId: string | null
  store: AgentTaskStore
  writer?: UIMessageStreamWriter<UIMessage>
}) => {
  const snapshot = () => {
    const tasks = store.list()
    const todos = tasks.map((task) => toTodo(task, tasks))
    if (agentRunId && writer) {
      writer.write({
        data: { runId: agentRunId, todos },
        id: `todo:${agentRunId}`,
        transient: true,
        type: CHAT_TODO_DATA_TYPE
      })
    }
    return { counts: countTodosByStatus(todos), todos }
  }

  return {
    task_create: tool({
      description:
        "Create a durable task for complex work needing dependencies, ownership, or progress across turns. Skip task tools for small, self-contained work. Returns a stable id and revision; no need to resend the list.",
      execute: (input) => {
        const task = store.create(input)
        return { ...snapshot(), task }
      },
      inputSchema: TaskCreateInputSchema,
      toModelOutput: ({ output }) => ({
        type: "json",
        value: { counts: { ...output.counts }, task: output.task }
      })
    }),
    task_get: tool({
      description:
        "Read a task's current details and revision before updating it. Tasks are shared by this chat's turns and delegates.",
      execute: ({ id }) => store.get(id),
      inputSchema: z.object({ id: z.string().min(1) }).strict()
    }),
    task_list: tool({
      description:
        "List the chat's durable tasks, owners, dependencies, and current revisions. Dependencies with status completed no longer block work.",
      execute: () => ({ ...snapshot(), tasks: store.list() }),
      inputSchema: z.object({}).strict(),
      toModelOutput: ({ output }) => ({
        type: "json",
        value: { counts: { ...output.counts }, tasks: output.tasks }
      })
    }),
    task_update: tool({
      description:
        "Update only the changed fields of one task using its current revision. blockedBy replaces that task's dependency ids; owner=null clears ownership. Dependencies must be completed before starting/completing. Multiple independent tasks may be in_progress. A revision conflict requires task_get before retrying. Mark completed only after verifying the result. status=deleted removes an unreferenced task from this chat's metadata without deleting project files.",
      execute: ({ status, ...input }) => {
        const deleted = status === "deleted"
        const task =
          status === "deleted"
            ? store.remove(input)
            : store.update({ ...input, ...(status ? { status } : {}) })
        return { ...snapshot(), deleted, task }
      },
      inputSchema: TaskUpdateInputSchema,
      toModelOutput: ({ output }) => ({
        type: "json",
        value: {
          counts: { ...output.counts },
          deleted: output.deleted,
          task: output.task
        }
      })
    })
  }
}
