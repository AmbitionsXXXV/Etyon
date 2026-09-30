import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { z } from "zod"

const MAX_TASKS = 100
const TaskSchema = z.object({
  activeForm: z.string().min(1).max(500).nullable(),
  blockedBy: z.array(z.string()).max(MAX_TASKS),
  description: z.string().max(8000),
  id: z.string(),
  owner: z.string().min(1).max(200).nullable(),
  revision: z.number().int().positive(),
  status: z.enum(["pending", "in_progress", "completed"]),
  subject: z.string().min(1).max(500)
})
const TaskListSchema = z.object({
  tasks: z.array(TaskSchema).max(MAX_TASKS),
  version: z.literal(1)
})

export type AgentTask = z.infer<typeof TaskSchema>
export type CreateAgentTask = Pick<AgentTask, "subject"> &
  Partial<Pick<AgentTask, "activeForm" | "blockedBy" | "description" | "owner">>
export type UpdateAgentTask = Pick<AgentTask, "id" | "revision"> &
  Partial<Omit<AgentTask, "id" | "revision">>

const validateDependencies = (tasks: AgentTask[]): void => {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visited = new Set<string>()
  const visiting = new Set<string>()

  const visit = (task: AgentTask): void => {
    if (visiting.has(task.id)) {
      throw new Error("Task dependencies cannot contain a cycle.")
    }
    if (visited.has(task.id)) {
      return
    }
    visiting.add(task.id)
    for (const dependencyId of task.blockedBy) {
      const dependency = byId.get(dependencyId)
      if (!dependency) {
        throw new Error(`Unknown dependency: ${dependencyId}`)
      }
      if (task.status !== "pending" && dependency.status !== "completed") {
        throw new Error(
          "Complete dependencies before starting or completing a task."
        )
      }
      visit(dependency)
    }
    visiting.delete(task.id)
    visited.add(task.id)
  }

  for (const task of tasks) {
    visit(task)
  }
}

/** Synchronous read/modify/rename keeps calls in Electron's main process atomic.
 * The session scope survives turns and restarts and is shared with its delegates.
 */
export const createTaskStore = ({
  chatSessionId,
  projectPath,
  storageRoot
}: {
  chatSessionId: string
  projectPath: string
  storageRoot: string
}) => {
  const scope = createHash("sha256")
    .update(JSON.stringify([path.resolve(projectPath), chatSessionId]))
    .digest("hex")
  const filePath = path.join(storageRoot, `${scope}.json`)

  const list = (): AgentTask[] => {
    if (!fs.existsSync(filePath)) {
      return []
    }
    return TaskListSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")))
      .tasks
  }

  const save = (tasks: AgentTask[]): void => {
    const data = TaskListSchema.parse({ tasks, version: 1 })
    validateDependencies(data.tasks)
    fs.mkdirSync(storageRoot, { mode: 0o700, recursive: true })
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(data), { mode: 0o600 })
      fs.renameSync(temporaryPath, filePath)
    } finally {
      fs.rmSync(temporaryPath, { force: true })
    }
  }

  const get = (id: string): AgentTask => {
    const task = list().find((entry) => entry.id === id)
    if (!task) {
      throw new Error(`Unknown task: ${id}`)
    }
    return task
  }

  const create = (input: CreateAgentTask): AgentTask => {
    const tasks = list()
    const task: AgentTask = {
      activeForm: input.activeForm ?? null,
      blockedBy: [...new Set(input.blockedBy)],
      description: input.description ?? "",
      id: randomUUID(),
      owner: input.owner ?? null,
      revision: 1,
      status: "pending",
      subject: input.subject
    }
    save([...tasks, task])
    return task
  }

  const update = ({ id, revision, ...changes }: UpdateAgentTask): AgentTask => {
    const tasks = list()
    const index = tasks.findIndex((entry) => entry.id === id)
    const current = tasks[index]
    if (!current) {
      throw new Error(`Unknown task: ${id}`)
    }
    if (current.revision !== revision) {
      throw new Error(
        "Task changed. Read it with task_get and retry with its current revision."
      )
    }
    const task: AgentTask = {
      ...current,
      ...changes,
      blockedBy: [...new Set(changes.blockedBy ?? current.blockedBy)],
      revision: revision + 1
    }
    tasks[index] = task
    save(tasks)
    return task
  }

  const remove = ({
    id,
    revision
  }: Pick<AgentTask, "id" | "revision">): AgentTask => {
    const tasks = list()
    const task = tasks.find((entry) => entry.id === id)
    if (!task || task.revision !== revision) {
      throw new Error(
        "Task missing or changed. Read the current task before deleting it."
      )
    }
    if (tasks.some((entry) => entry.blockedBy.includes(id))) {
      throw new Error(
        "Remove dependent tasks' references before deleting this task."
      )
    }
    save(tasks.filter((entry) => entry.id !== id))
    return task
  }

  return { create, get, list, remove, update }
}

export type AgentTaskStore = ReturnType<typeof createTaskStore>
