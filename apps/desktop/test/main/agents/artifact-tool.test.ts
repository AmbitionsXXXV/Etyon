import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vite-plus/test"

import {
  ARTIFACT_MAX_BYTES,
  buildArtifactTool,
  getArtifactKind
} from "@/main/agents/minimal/artifact-tool"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"

const projectPath = fs.mkdtempSync(
  path.join(os.tmpdir(), "etyon-artifact-tool-")
)

fs.mkdirSync(path.join(projectPath, "artifacts"))
fs.writeFileSync(
  path.join(projectPath, "artifacts", "report.html"),
  "<!doctype html><html><head><title>r</title></head><body>ok</body></html>"
)
fs.writeFileSync(path.join(projectPath, "artifacts", "notes.md"), "# Notes\n")
fs.writeFileSync(path.join(projectPath, "artifacts", "data.txt"), "plain\n")

const tool = buildArtifactTool(getWorkspaceCore(projectPath))

const execute = async <TOutput>(input: unknown): Promise<TOutput> => {
  const { execute: executeTool } = tool as unknown as {
    execute: (inputData: never, context?: never) => Promise<unknown>
  }

  return (await executeTool(input as never)) as TOutput
}

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
})

describe("artifact tool", () => {
  it("maps file extensions to artifact kinds", () => {
    expect(getArtifactKind("a/report.html")).toBe("html")
    expect(getArtifactKind("A/REPORT.HTM")).toBe("html")
    expect(getArtifactKind("notes.md")).toBe("markdown")
    expect(getArtifactKind("notes.markdown")).toBe("markdown")
    expect(getArtifactKind("data.txt")).toBeNull()
    expect(getArtifactKind("no-extension")).toBeNull()
  })

  it("publishes an existing html file with kind, size and title", async () => {
    const output = await execute<{
      byteLength: number
      kind: string
      path: string
      title: string
    }>({
      path: "artifacts/report.html",
      title: "Quarterly report"
    })

    expect(output.kind).toBe("html")
    expect(output.path).toBe("artifacts/report.html")
    expect(output.title).toBe("Quarterly report")
    expect(output.byteLength).toBeGreaterThan(0)
  })

  it("publishes markdown files and carries the description through", async () => {
    const output = await execute<{ description?: string; kind: string }>({
      description: "Meeting notes",
      path: "artifacts/notes.md",
      title: "Notes"
    })

    expect(output.kind).toBe("markdown")
    expect(output.description).toBe("Meeting notes")
  })

  it("rejects unsupported extensions", async () => {
    await expect(
      execute({ path: "artifacts/data.txt", title: "Data" })
    ).rejects.toThrow(/\.html or \.md/u)
  })

  it("rejects missing files and paths outside the project", async () => {
    await expect(
      execute({ path: "artifacts/absent.html", title: "Absent" })
    ).rejects.toThrow(/not-found/u)
    await expect(
      execute({ path: "../outside.html", title: "Outside" })
    ).rejects.toThrow(/outside-project/u)
  })

  it("rejects files over the size limit", async () => {
    fs.writeFileSync(
      path.join(projectPath, "artifacts", "huge.html"),
      "x".repeat(ARTIFACT_MAX_BYTES + 1)
    )

    await expect(
      execute({ path: "artifacts/huge.html", title: "Huge" })
    ).rejects.toThrow(/too large/u)
  })
})
