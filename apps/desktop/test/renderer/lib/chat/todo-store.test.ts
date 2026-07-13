import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  clearTodos,
  getTodosSnapshot,
  setTodos
} from "@/renderer/lib/chat/todo-store"
import type { ChatTodoItem, ChatTodoStatus } from "@/shared/chat/stream-data"

const todos = (statuses: ChatTodoStatus[]): ChatTodoItem[] =>
  statuses.map((status, index) => ({ content: `task ${index}`, status }))

describe("todo store", () => {
  afterEach(() => {
    clearTodos()
  })

  it("publishes a run's latest list and reads it back", () => {
    setTodos("run-1", todos(["in_progress", "pending"]))

    expect(getTodosSnapshot("run-1")).toEqual([
      { content: "task 0", status: "in_progress" },
      { content: "task 1", status: "pending" }
    ])
  })

  it("full-replaces the list on each set (latest wins)", () => {
    setTodos("run-1", todos(["in_progress"]))
    setTodos("run-1", todos(["completed", "in_progress"]))

    expect(getTodosSnapshot("run-1")).toHaveLength(2)
  })

  it("keeps runs isolated", () => {
    setTodos("run-1", todos(["pending"]))
    setTodos("run-2", todos(["completed"]))

    expect(getTodosSnapshot("run-1")?.[0]?.status).toBe("pending")
    expect(getTodosSnapshot("run-2")?.[0]?.status).toBe("completed")
  })

  it("returns undefined for an unknown or absent run id", () => {
    expect(getTodosSnapshot("nope")).toBeUndefined()
    expect(getTodosSnapshot()).toBeUndefined()
  })

  it("clears every run's todos", () => {
    setTodos("run-1", todos(["pending"]))
    setTodos("run-2", todos(["pending"]))
    clearTodos()

    expect(getTodosSnapshot("run-1")).toBeUndefined()
    expect(getTodosSnapshot("run-2")).toBeUndefined()
  })
})
