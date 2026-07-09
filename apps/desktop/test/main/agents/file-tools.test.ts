import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vite-plus/test"

import { buildFileTools } from "@/main/agents/minimal/file-tools"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"

const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-file-tools-"))

fs.writeFileSync(path.join(projectPath, "notes.md"), "alpha\nbeta\ngamma\n")

const tools = buildFileTools(getWorkspaceCore(projectPath))

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

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
})

describe("file tools", () => {
  it("marks edit and write as approval-gated and the rest as free", () => {
    expect(tools.edit.needsApproval).toBe(true)
    expect(tools.write.needsApproval).toBe(true)
    expect(tools.read.needsApproval).toBeFalsy()
    expect(tools.ls.needsApproval).toBeFalsy()
    expect(tools.grep.needsApproval).toBeFalsy()
  })

  it("reads files with line numbers and offset/limit", async () => {
    const output = await execute<{
      content: string
      totalLines: number
      truncated: boolean
    }>(tools.read, {
      limit: 1,
      offset: 2,
      path: "notes.md"
    })

    expect(output.content).toBe("2\tbeta")
    expect(output.totalLines).toBe(4)
    expect(output.truncated).toBe(true)
  })

  it("lists directory entries", async () => {
    const output = await execute<{
      entries: { kind: string; name: string }[]
    }>(tools.ls, {
      limit: 500
    })

    expect(output.entries.map((entry) => entry.name)).toContain("notes.md")
  })

  it("greps file contents", async () => {
    const output = await execute<{ matches: string }>(tools.grep, {
      limit: 100,
      pattern: "beta"
    })

    expect(output.matches).toContain("notes.md")
    expect(output.matches).toContain("beta")
  })

  it("applies unique exact edits and rejects ambiguous ones", async () => {
    const output = await execute<{ appliedEdits: number; path: string }>(
      tools.edit,
      {
        edits: [
          {
            newText: "beta-edited",
            oldText: "beta"
          }
        ],
        path: "notes.md"
      }
    )

    expect(output.appliedEdits).toBe(1)
    expect(fs.readFileSync(path.join(projectPath, "notes.md"), "utf-8")).toBe(
      "alpha\nbeta-edited\ngamma\n"
    )

    fs.writeFileSync(path.join(projectPath, "dupes.md"), "same\nsame\n")

    await expect(
      execute(tools.edit, {
        edits: [
          {
            newText: "other",
            oldText: "same"
          }
        ],
        path: "dupes.md"
      })
    ).rejects.toThrow(/not unique/u)
  })

  it("writes new files and surfaces workspace errors", async () => {
    const output = await execute<{ bytesWritten: number; path: string }>(
      tools.write,
      {
        content: "fresh\n",
        path: "fresh.md"
      }
    )

    expect(output.bytesWritten).toBe(6)

    await expect(
      execute(tools.write, {
        content: "nope\n",
        path: "../outside.md"
      })
    ).rejects.toThrow(/outside-project/u)
  })
})
