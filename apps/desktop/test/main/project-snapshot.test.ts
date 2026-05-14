import fs from "node:fs"
import path from "node:path"

import { afterAll, describe, expect, it } from "vite-plus/test"

import {
  buildMentionContext,
  ensureProjectSnapshot,
  listProjectSnapshotFiles
} from "@/main/project-snapshot"

const testProjectPath = `/tmp/etyon-project-snapshot-test-${Date.now()}`
const testProjectPaths = new Set([testProjectPath])

const createTestProjectPath = (name: string): string => {
  const projectPath = `${testProjectPath}-${name}`

  testProjectPaths.add(projectPath)

  return projectPath
}

const writeProjectFile = (
  relativePath: string,
  content: string | Buffer,
  projectPath = testProjectPath
): void => {
  const filePath = path.join(projectPath, relativePath)

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe("project snapshot", () => {
  afterAll(() => {
    for (const projectPath of testProjectPaths) {
      fs.rmSync(projectPath, { force: true, recursive: true })
    }
  })

  it("creates Alma-compatible snapshot files and filters ignored paths", () => {
    writeProjectFile("src/main.ts", "export const value = 1\n")
    writeProjectFile("README.md", "# hello\n")
    writeProjectFile("node_modules/ignored.js", "console.log('ignored')\n")
    writeProjectFile("out/development/app.asar", Buffer.from([0, 1, 2, 3]))
    writeProjectFile("assets/logo.bin", Buffer.from([0, 1, 2, 3]))

    const snapshotState = ensureProjectSnapshot(testProjectPath)
    const snapshotDirPath = path.join(testProjectPath, ".alma-snapshots")
    const listedFiles = listProjectSnapshotFiles({
      projectPath: testProjectPath,
      query: ""
    })

    expect(fs.existsSync(path.join(snapshotDirPath, "config.json"))).toBe(true)
    expect(fs.existsSync(path.join(snapshotDirPath, "history.json"))).toBe(true)
    expect(fs.existsSync(path.join(snapshotDirPath, "index.json"))).toBe(true)
    expect(
      fs.existsSync(
        path.join(
          snapshotDirPath,
          "snapshots",
          `${snapshotState.snapshotId}.json`
        )
      )
    ).toBe(true)
    expect(
      fs.existsSync(
        path.join(
          snapshotDirPath,
          "documents",
          `${snapshotState.snapshotId}.json`
        )
      )
    ).toBe(true)
    expect(listedFiles.snapshotId).toBe(snapshotState.snapshotId)
    expect(
      listedFiles.files.some((file) => file.relativePath === "src/main.ts")
    ).toBe(true)
    expect(
      listedFiles.files.some((file) => file.relativePath === "README.md")
    ).toBe(true)
    expect(
      listedFiles.files.some(
        (file) => file.relativePath === "node_modules/ignored.js"
      )
    ).toBe(false)
    expect(
      listedFiles.files.some(
        (file) => file.relativePath === "out/development/app.asar"
      )
    ).toBe(false)
  })

  it("applies project .gitignore rules when collecting snapshot files", () => {
    const projectPath = createTestProjectPath("gitignore")

    writeProjectFile(
      ".gitignore",
      ["ignored-build/", "*.generated.ts", "!keep.generated.ts"].join("\n"),
      projectPath
    )
    writeProjectFile("src/main.ts", "export const main = true\n", projectPath)
    writeProjectFile(
      "src/ignored.generated.ts",
      "export const ignored = true\n",
      projectPath
    )
    writeProjectFile(
      "keep.generated.ts",
      "export const kept = true\n",
      projectPath
    )
    writeProjectFile(
      "ignored-build/cache.ts",
      "export const ignoredBuild = true\n",
      projectPath
    )

    const listedFiles = listProjectSnapshotFiles({
      projectPath,
      query: ""
    })

    expect(
      listedFiles.files.some((file) => file.relativePath === "src/main.ts")
    ).toBe(true)
    expect(
      listedFiles.files.some(
        (file) => file.relativePath === "src/ignored.generated.ts"
      )
    ).toBe(false)
    expect(
      listedFiles.files.some(
        (file) => file.relativePath === "keep.generated.ts"
      )
    ).toBe(true)
    expect(
      listedFiles.files.some(
        (file) => file.relativePath === "ignored-build/cache.ts"
      )
    ).toBe(false)
  })

  it("reuses the latest snapshot while fresh and builds mention context from referenced files", () => {
    const firstSnapshot = ensureProjectSnapshot(testProjectPath)
    const secondSnapshot = ensureProjectSnapshot(testProjectPath)
    const [file] = listProjectSnapshotFiles({
      projectPath: testProjectPath,
      query: "main"
    }).files

    if (!file) {
      throw new Error("expected a snapshot file fixture")
    }

    const mentionContext = buildMentionContext({
      mentions: [
        {
          kind: "file",
          path: file.path,
          relativePath: file.relativePath,
          snapshotId: file.snapshotId
        }
      ],
      projectPath: testProjectPath
    })

    expect(secondSnapshot.snapshotId).toBe(firstSnapshot.snapshotId)
    expect(mentionContext.snapshotId).toBe(firstSnapshot.snapshotId)
    expect(mentionContext.system).toContain("src/main.ts")
    expect(mentionContext.system).toContain("export const value = 1")
  })

  it("matches project-root mention queries with common root prefixes", () => {
    const queries = ["/src/main", "./src/main", "@/src/main", "@./src/main"]

    for (const query of queries) {
      const listedFiles = listProjectSnapshotFiles({
        projectPath: testProjectPath,
        query
      })

      expect(
        listedFiles.files.some((file) => file.relativePath === "src/main.ts")
      ).toBe(true)
    }
  })

  it("returns folder candidates before file candidates for empty mention queries", () => {
    const projectPath = createTestProjectPath("candidates")

    writeProjectFile("README.md", "# hello\n", projectPath)
    writeProjectFile("assets/logo.bin", Buffer.from([0, 1, 2, 3]), projectPath)
    writeProjectFile(
      "node_modules/ignored.ts",
      "export const ignored = true\n",
      projectPath
    )
    writeProjectFile("src/main.ts", "export const main = true\n", projectPath)
    writeProjectFile(
      "src/renderer/app.tsx",
      "export const app = true\n",
      projectPath
    )

    const listedItems = listProjectSnapshotFiles({
      projectPath,
      query: ""
    }).files
    const firstFileIndex = listedItems.findIndex((item) => item.kind === "file")
    const lastFolderIndex = listedItems.findLastIndex(
      (item) => item.kind === "folder"
    )

    expect(listedItems.some((item) => item.kind === "folder")).toBe(true)
    expect(listedItems.some((item) => item.kind === "file")).toBe(true)
    expect(lastFolderIndex).toBeLessThan(firstFileIndex)
    expect(
      listedItems.some(
        (item) => item.kind === "folder" && item.relativePath === "src"
      )
    ).toBe(true)
    expect(
      listedItems.some(
        (item) => item.kind === "folder" && item.relativePath === "src/renderer"
      )
    ).toBe(true)
    expect(
      listedItems.some((item) => item.relativePath.startsWith("node_modules"))
    ).toBe(false)
    expect(
      listedItems.some(
        (item) => item.kind === "folder" && item.relativePath === "assets"
      )
    ).toBe(false)
  })

  it("limits empty mention candidates to 50 items by default", () => {
    const projectPath = createTestProjectPath("limit")

    for (let index = 0; index < 60; index += 1) {
      writeProjectFile(
        `file-${index.toString().padStart(2, "0")}.md`,
        `# file ${index}\n`,
        projectPath
      )
    }

    expect(
      listProjectSnapshotFiles({
        projectPath,
        query: ""
      }).files
    ).toHaveLength(50)
  })

  it("builds folder mention context from files under the referenced folder only", () => {
    const projectPath = createTestProjectPath("folder-context")

    writeProjectFile(
      "src/main.ts",
      "export const outside = true\n",
      projectPath
    )
    writeProjectFile(
      "src/renderer/app.tsx",
      "export const rendererApp = true\n",
      projectPath
    )
    writeProjectFile(
      "src/renderer/lib/util.ts",
      "export const rendererUtil = true\n",
      projectPath
    )

    const folder = listProjectSnapshotFiles({
      projectPath,
      query: "src/renderer"
    }).files.find(
      (item) => item.kind === "folder" && item.relativePath === "src/renderer"
    )

    if (!folder) {
      throw new Error("expected a folder snapshot fixture")
    }

    const mentionContext = buildMentionContext({
      mentions: [
        {
          kind: "folder",
          path: folder.path,
          relativePath: folder.relativePath,
          snapshotId: folder.snapshotId
        }
      ],
      projectPath
    })

    expect(mentionContext.system).toContain("src/renderer/app.tsx")
    expect(mentionContext.system).toContain("rendererApp")
    expect(mentionContext.system).toContain("src/renderer/lib/util.ts")
    expect(mentionContext.system).toContain("rendererUtil")
    expect(mentionContext.system).not.toContain("src/main.ts")
    expect(mentionContext.system).not.toContain("outside")
  })

  it("rebuilds the snapshot when the latest history entry is stale", () => {
    const firstSnapshot = ensureProjectSnapshot(testProjectPath)
    const historyPath = path.join(
      testProjectPath,
      ".alma-snapshots",
      "history.json"
    )
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8")) as {
      id: string
      message: string
      parentId: string | null
      stats: {
        added: number
        deleted: number
        modified: number
      }
      timestamp: string
    }[]
    const latestEntry = history.at(-1)

    if (!latestEntry) {
      throw new Error("expected a snapshot history entry")
    }

    latestEntry.timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2))

    const secondSnapshot = ensureProjectSnapshot(testProjectPath)

    expect(secondSnapshot.snapshotId).not.toBe(firstSnapshot.snapshotId)
    expect(secondSnapshot.refreshedAt).not.toBe(firstSnapshot.refreshedAt)
  })
})
