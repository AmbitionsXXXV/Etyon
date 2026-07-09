import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vite-plus/test"

import {
  getWorkspaceCore,
  isSecretWorkspacePath
} from "@/main/agents/minimal/workspace-core"

const projectPath = fs.mkdtempSync(
  path.join(os.tmpdir(), "etyon-workspace-core-")
)
const outsidePath = fs.mkdtempSync(
  path.join(os.tmpdir(), "etyon-workspace-outside-")
)

fs.writeFileSync(path.join(projectPath, "readme.md"), "hello world\n")
fs.mkdirSync(path.join(projectPath, "src"))
fs.writeFileSync(
  path.join(projectPath, "src", "index.ts"),
  "export const answer = 42\n"
)
fs.writeFileSync(path.join(outsidePath, "secret.txt"), "outside\n")
fs.symlinkSync(
  path.join(outsidePath, "secret.txt"),
  path.join(projectPath, "escape-link")
)

const workspace = getWorkspaceCore(projectPath)

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
  fs.rmSync(outsidePath, { force: true, recursive: true })
})

describe("workspace-core", () => {
  it("reuses one workspace instance per project path", () => {
    expect(getWorkspaceCore(projectPath)).toBe(workspace)
  })

  it("views files inside the project", async () => {
    const result = await workspace.view("readme.md")

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value.content).toBe("hello world\n")
      expect(result.value.info.kind).toBe("file")
    }
  })

  it("rejects paths outside the project root", async () => {
    const result = await workspace.view("../etyon-escape")

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error.code).toBe("outside-project")
    }
  })

  it("rejects reading through symlinks", async () => {
    const result = await workspace.view("escape-link")

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error.code).toBe("not-file")
    }
  })

  it("rejects secret-looking paths", async () => {
    expect(isSecretWorkspacePath(".env")).toBe(true)
    expect(isSecretWorkspacePath("config/keys/server.pem")).toBe(true)
    expect(isSecretWorkspacePath("src/index.ts")).toBe(false)

    const result = await workspace.view(".env")

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error.code).toBe("secret-path")
    }
  })

  it("lists directories with entry metadata", async () => {
    const result = await workspace.listDir("src")

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value.map((entry) => entry.path)).toEqual(["src/index.ts"])
    }
  })

  it("requires a read before overwriting an existing file", async () => {
    const blindOverwrite = await workspace.writeFile(
      "src/blind.ts",
      "created\n",
      {
        requireReadSnapshot: true
      }
    )

    expect(blindOverwrite.ok).toBe(true)

    const staleOverwrite = await workspace.writeFile(
      "src/blind.ts",
      "overwritten\n",
      {
        requireReadSnapshot: true
      }
    )

    expect(staleOverwrite.ok).toBe(false)

    if (!staleOverwrite.ok) {
      expect(staleOverwrite.error.code).toBe("stale-write")
    }

    const view = await workspace.view("src/blind.ts")

    expect(view.ok).toBe(true)

    const informedOverwrite = await workspace.writeFile(
      "src/blind.ts",
      "overwritten\n",
      {
        requireReadSnapshot: true
      }
    )

    expect(informedOverwrite.ok).toBe(true)
  })

  it("detects external modification through expectedMtimeMs", async () => {
    const view = await workspace.view("readme.md")

    expect(view.ok).toBe(true)

    if (!view.ok) {
      return
    }

    const externalMtime = new Date(Date.now() + 5000)

    fs.utimesSync(
      path.join(projectPath, "readme.md"),
      externalMtime,
      externalMtime
    )

    const staleWrite = await workspace.writeFile("readme.md", "stale\n", {
      expectedMtimeMs: view.value.info.mtimeMs
    })

    expect(staleWrite.ok).toBe(false)

    if (!staleWrite.ok) {
      expect(staleWrite.error.code).toBe("stale-write")
    }
  })

  it("creates parent directories when asked", async () => {
    const result = await workspace.writeFile("deep/nested/file.txt", "x\n", {
      createParentDirectories: true
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value.bytesWritten).toBe(2)
    }
  })

  it("writes binary files and creates their parent directories", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const result = await workspace.writeBinaryFile(
      "artifacts/images/pic.png",
      bytes
    )

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value.bytesWritten).toBe(6)
      expect(result.value.info.path).toBe("artifacts/images/pic.png")
      const written = fs.readFileSync(
        path.join(projectPath, "artifacts", "images", "pic.png")
      )
      expect([...written]).toEqual([...bytes])
    }
  })

  it("rejects binary writes outside the project root", async () => {
    const result = await workspace.writeBinaryFile(
      "../escape.png",
      new Uint8Array([1, 2, 3])
    )

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error.code).toBe("outside-project")
    }
  })

  it("searches file contents with ripgrep", async () => {
    const result = await workspace.searchContent({
      limit: 10,
      pattern: "answer"
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value).toContain("src/index.ts")
      expect(result.value).toContain("answer = 42")
    }
  })

  it("returns empty output when ripgrep finds no matches", async () => {
    const result = await workspace.searchContent({
      limit: 10,
      pattern: "definitely-not-present-anywhere"
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value).toBe("")
    }
  })
})
