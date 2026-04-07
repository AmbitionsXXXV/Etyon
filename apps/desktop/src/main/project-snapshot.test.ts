import fs from "node:fs"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  buildMentionContext,
  ensureProjectSnapshot,
  listProjectSnapshotFiles
} from "./project-snapshot"

const testProjectPath = `/tmp/etyon-project-snapshot-test-${Date.now()}`

const writeProjectFile = (
  relativePath: string,
  content: string | Buffer
): void => {
  const filePath = path.join(testProjectPath, relativePath)

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe("project snapshot", () => {
  afterAll(() => {
    fs.rmSync(testProjectPath, { force: true, recursive: true })
  })

  it("creates Alma-compatible snapshot files and filters ignored paths", () => {
    writeProjectFile("src/main.ts", "export const value = 1\n")
    writeProjectFile("README.md", "# hello\n")
    writeProjectFile("node_modules/ignored.js", "console.log('ignored')\n")
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

  it("rebuilds the snapshot when the latest history entry is stale", () => {
    const firstSnapshot = ensureProjectSnapshot(testProjectPath)
    const historyPath = path.join(
      testProjectPath,
      ".alma-snapshots",
      "history.json"
    )
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8")) as {
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
