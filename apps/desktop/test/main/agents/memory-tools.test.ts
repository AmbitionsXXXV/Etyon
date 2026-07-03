import { describe, expect, it, vi } from "vite-plus/test"

import {
  buildSaveMemoryTool,
  buildSearchMemoryTool
} from "@/main/agents/minimal/memory-tools"

const {
  buildMemorySystemPromptMock,
  getSettingsMock,
  saveAgentMemoryNoteMock
} = vi.hoisted(() => ({
  buildMemorySystemPromptMock: vi.fn(),
  getSettingsMock: vi.fn(() => ({ memory: { enabled: true } })),
  saveAgentMemoryNoteMock: vi.fn()
}))

vi.mock("@/main/memory", () => ({
  buildMemorySystemPrompt: buildMemorySystemPromptMock,
  saveAgentMemoryNote: saveAgentMemoryNoteMock
}))

vi.mock("@/main/settings", () => ({
  getSettings: getSettingsMock
}))

const execute = async <TOutput>(
  tool: unknown,
  input: unknown
): Promise<TOutput> => {
  const { execute: executeTool } = tool as {
    execute?: (inputData: never, context?: never) => Promise<unknown>
  }

  if (!executeTool) {
    throw new Error("tool has no execute")
  }

  return (await executeTool(input as never)) as TOutput
}

describe("search_memory tool", () => {
  it("returns the formatted memory when something is found", async () => {
    buildMemorySystemPromptMock.mockResolvedValueOnce("Long-term memory: X")

    const tool = buildSearchMemoryTool({
      db: {} as never,
      projectPath: "/project"
    })
    const result = await execute<string>(tool, {
      query: "What did we decide?"
    })

    expect(result).toBe("Long-term memory: X")
    expect(buildMemorySystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: {},
        projectPath: "/project",
        query: "What did we decide?"
      })
    )
  })

  it("reports plainly when nothing relevant is found", async () => {
    buildMemorySystemPromptMock.mockResolvedValueOnce("")

    const tool = buildSearchMemoryTool({
      db: {} as never,
      projectPath: "/project"
    })
    const result = await execute<string>(tool, { query: "anything" })

    expect(result).toBe("No relevant memories found.")
  })
})

describe("save_memory tool", () => {
  it("reports success when the note is saved", async () => {
    saveAgentMemoryNoteMock.mockResolvedValueOnce({ id: "note-1" })

    const tool = buildSaveMemoryTool({
      db: {} as never,
      projectPath: "/project"
    })
    const result = await execute<{ saved: boolean }>(tool, {
      content: "User prefers dark mode."
    })

    expect(result).toEqual({ saved: true })
    expect(saveAgentMemoryNoteMock).toHaveBeenCalledWith({
      content: "User prefers dark mode.",
      db: {},
      projectPath: "/project"
    })
  })

  it("reports failure when the write is skipped", async () => {
    saveAgentMemoryNoteMock.mockResolvedValueOnce(null)

    const tool = buildSaveMemoryTool({
      db: {} as never,
      projectPath: "/project"
    })
    const result = await execute<{ saved: boolean }>(tool, { content: "x" })

    expect(result).toEqual({ saved: false })
  })
})
