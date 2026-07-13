import { describe, expect, it } from "vite-plus/test"

import {
  buildTodoTool,
  TodoWriteInputSchema
} from "@/main/agents/minimal/todo-tool"
import { CHAT_TODO_DATA_TYPE } from "@/shared/chat/stream-data"

interface WriterCall {
  data?: unknown
  id?: string
  transient?: boolean
  type: string
}

const buildToolWithWriter = (agentRunId: string | null) => {
  const calls: WriterCall[] = []
  const writer = {
    write: (part: WriterCall) => {
      calls.push(part)
    }
  } as unknown as Parameters<typeof buildTodoTool>[0]["writer"]

  return { calls, tool: buildTodoTool({ agentRunId, writer }) }
}

const execute = async <TOutput>(
  tool: ReturnType<typeof buildTodoTool>,
  input: unknown
): Promise<TOutput> => {
  const { execute: executeTool } = tool as unknown as {
    execute: (inputData: never, context?: never) => Promise<unknown>
  }

  return (await executeTool(input as never)) as TOutput
}

describe("TodoWriteInputSchema", () => {
  it("accepts a valid full todo list", () => {
    const result = TodoWriteInputSchema.safeParse({
      todos: [
        {
          activeForm: "Writing tests",
          content: "Write tests",
          status: "in_progress"
        },
        { content: "Ship it", status: "pending" }
      ]
    })

    expect(result.success).toBe(true)
  })

  it("rejects empty content", () => {
    expect(
      TodoWriteInputSchema.safeParse({
        todos: [{ content: "", status: "pending" }]
      }).success
    ).toBe(false)
  })

  it("rejects an unknown status", () => {
    expect(
      TodoWriteInputSchema.safeParse({
        todos: [{ content: "Do", status: "blocked" }]
      }).success
    ).toBe(false)
  })

  it("rejects unknown item keys (strict)", () => {
    expect(
      TodoWriteInputSchema.safeParse({
        todos: [{ content: "Do", extra: "x", status: "pending" }]
      }).success
    ).toBe(false)
  })
})

describe("todo_write tool", () => {
  it("returns status counts and ok", async () => {
    const { tool } = buildToolWithWriter("run-1")
    const output = await execute<{
      counts: { completed: number; inProgress: number; pending: number }
      ok: true
    }>(tool, {
      todos: [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "pending" },
        { content: "d", status: "pending" }
      ]
    })

    expect(output.ok).toBe(true)
    expect(output.counts).toEqual({ completed: 1, inProgress: 1, pending: 2 })
  })

  it("streams the full list as a transient data-todo part keyed by run", async () => {
    const { calls, tool } = buildToolWithWriter("run-9")
    await execute(tool, { todos: [{ content: "a", status: "pending" }] })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.type).toBe(CHAT_TODO_DATA_TYPE)
    expect(calls[0]?.id).toBe("todo:run-9")
    expect(calls[0]?.transient).toBe(true)
    expect(calls[0]?.data).toEqual({
      runId: "run-9",
      todos: [{ content: "a", status: "pending" }]
    })
  })

  it("full-replaces: each call carries the entire list", async () => {
    const { calls, tool } = buildToolWithWriter("run-2")
    await execute(tool, { todos: [{ content: "a", status: "in_progress" }] })
    await execute(tool, {
      todos: [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" }
      ]
    })

    expect(calls).toHaveLength(2)
    const secondData = calls[1]?.data as { todos: unknown[] } | undefined
    expect(secondData?.todos).toHaveLength(2)
  })

  it("omits the live part when there is no run id", async () => {
    const { calls, tool } = buildToolWithWriter(null)
    const output = await execute<{ ok: true }>(tool, {
      todos: [{ content: "a", status: "pending" }]
    })

    expect(output.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
