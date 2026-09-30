import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { UIMessage, UIMessageStreamWriter } from "ai"
import { afterEach, describe, expect, it } from "vite-plus/test"

import { buildTaskTools } from "@/main/agents/minimal/task-tools"
import { createTaskStore } from "@/main/agents/task-store"

const roots: string[] = []
const createStores = () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-tasks-"))
  roots.push(storageRoot)
  const options = {
    chatSessionId: "chat-1",
    projectPath: "/project",
    storageRoot
  }
  return { options, parent: createTaskStore(options) }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe("durable shared tasks", () => {
  it("shares incremental changes with a new store and isolates chats/projects", () => {
    const { options, parent } = createStores()
    const first = parent.create({ owner: "parent", subject: "Implement" })
    const child = createTaskStore(options)
    const second = child.create({ subject: "Review" })
    child.update({
      id: first.id,
      revision: first.revision,
      status: "in_progress"
    })
    parent.update({
      id: second.id,
      revision: second.revision,
      status: "in_progress"
    })

    expect(createTaskStore(options).list()).toEqual([
      expect.objectContaining({
        id: first.id,
        owner: "parent",
        revision: 2,
        status: "in_progress"
      }),
      expect.objectContaining({
        id: second.id,
        revision: 2,
        status: "in_progress"
      })
    ])
    expect(
      createTaskStore({ ...options, chatSessionId: "chat-2" }).list()
    ).toEqual([])
    expect(
      createTaskStore({ ...options, projectPath: "/other" }).list()
    ).toEqual([])
  })

  it("rejects stale updates without overwriting the other owner's change", () => {
    const { options, parent } = createStores()
    const task = parent.create({ subject: "Implement" })
    createTaskStore(options).update({
      id: task.id,
      owner: "child",
      revision: 1
    })

    expect(() =>
      parent.update({ id: task.id, revision: 1, status: "completed" })
    ).toThrow("Task changed")
    expect(parent.get(task.id)).toMatchObject({
      owner: "child",
      revision: 2,
      status: "pending"
    })
  })

  it("blocks starting/completing until dependencies are actually complete", () => {
    const { parent } = createStores()
    const prerequisite = parent.create({ subject: "Implement" })
    const dependent = parent.create({
      blockedBy: [prerequisite.id],
      subject: "Review"
    })

    for (const status of ["in_progress", "completed"] as const) {
      expect(() =>
        parent.update({ id: dependent.id, revision: 1, status })
      ).toThrow("Complete dependencies")
    }
    parent.update({ id: prerequisite.id, revision: 1, status: "completed" })
    expect(
      parent.update({ id: dependent.id, revision: 1, status: "in_progress" })
        .status
    ).toBe("in_progress")
    expect(() =>
      parent.update({ id: prerequisite.id, revision: 2, status: "pending" })
    ).toThrow("Complete dependencies")
  })

  it("rejects unknown, self, and cyclic dependencies without committing them", () => {
    const { parent } = createStores()
    const first = parent.create({ subject: "First" })
    const second = parent.create({ blockedBy: [first.id], subject: "Second" })

    expect(() =>
      parent.create({ blockedBy: ["missing"], subject: "Unknown" })
    ).toThrow("Unknown dependency")
    expect(() =>
      parent.update({ blockedBy: [first.id], id: first.id, revision: 1 })
    ).toThrow("cycle")
    expect(() =>
      parent.update({ blockedBy: [second.id], id: first.id, revision: 1 })
    ).toThrow("cycle")
    expect(parent.list()).toHaveLength(2)
    expect(parent.get(first.id)).toMatchObject({ blockedBy: [], revision: 1 })
  })

  it("can clean up tasks without leaving broken dependencies or deleting stale revisions", () => {
    const { parent } = createStores()
    const first = parent.create({ subject: "First" })
    const second = parent.create({ blockedBy: [first.id], subject: "Second" })
    expect(() => parent.remove({ id: first.id, revision: 1 })).toThrow(
      "references"
    )
    expect(() => parent.remove({ id: second.id, revision: 2 })).toThrow(
      "changed"
    )
    parent.remove({ id: second.id, revision: 1 })
    parent.remove({ id: first.id, revision: 1 })
    expect(parent.list()).toEqual([])
  })

  it("keeps corruption visible instead of resetting the task board", () => {
    const { options, parent } = createStores()
    parent.create({ subject: "Keep" })
    const file = fs.readdirSync(options.storageRoot)[0] as string
    fs.writeFileSync(path.join(options.storageRoot, file), "broken")
    expect(() => parent.create({ subject: "New" })).toThrow()
    expect(fs.readFileSync(path.join(options.storageRoot, file), "utf-8")).toBe(
      "broken"
    )
  })
})

describe("task tool snapshots", () => {
  it("streams dependency/owner metadata and keeps full snapshots out of model output", async () => {
    const { parent } = createStores()
    const parts: unknown[] = []
    const writer = {
      write: (part: unknown) => parts.push(part)
    } as unknown as UIMessageStreamWriter<UIMessage>
    const tools = buildTaskTools({ agentRunId: "run-1", store: parent, writer })
    const input = { owner: "coder", subject: "Implement" }
    const context = {
      context: undefined as never,
      messages: [],
      toolCallId: "call-1"
    }
    const output = await tools.task_create.execute?.(input, context)
    expect(output).toBeDefined()
    if (!output || !("task" in output) || !tools.task_create.toModelOutput) {
      throw new Error("Missing task output")
    }
    expect(parts[0]).toMatchObject({
      data: {
        runId: "run-1",
        todos: [
          expect.objectContaining({ content: "Implement", owner: "coder" })
        ]
      },
      id: "todo:run-1",
      transient: true,
      type: "data-todo"
    })
    const modelOutput = await tools.task_create.toModelOutput({
      input,
      output,
      toolCallId: "call-1"
    })
    expect(modelOutput).toMatchObject({
      type: "json",
      value: { task: expect.objectContaining({ subject: "Implement" }) }
    })
    expect(JSON.stringify(modelOutput)).not.toContain('"todos"')
  })
})
