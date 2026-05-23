import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import {
  getGitProjectDiff,
  parseGitStatusPorcelain
} from "@/main/git-project-status"

const NULL_BYTE = String.fromCodePoint(0)

const runGit = (cwd: string, args: string[]): void => {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore"
  })
}

describe("git project status", () => {
  it("parses porcelain status into compact counts and tree entries", () => {
    const status = parseGitStatusPorcelain({
      projectPath: "/tmp/project-a",
      stdout: [
        " M src/app.tsx",
        "A  src/new-file.ts",
        "D  src/old-file.ts",
        "R  src/new-name.ts",
        "src/old-name.ts",
        "?? README.md",
        ""
      ].join(NULL_BYTE)
    })

    expect(status).toEqual({
      added: 1,
      changedFileCount: 5,
      deleted: 1,
      error: undefined,
      files: [
        {
          path: "src/app.tsx",
          status: "modified"
        },
        {
          path: "src/new-file.ts",
          status: "added"
        },
        {
          path: "src/old-file.ts",
          status: "deleted"
        },
        {
          path: "src/new-name.ts",
          status: "renamed"
        },
        {
          path: "README.md",
          status: "untracked"
        }
      ],
      isRepository: true,
      modified: 1,
      projectPath: "/tmp/project-a",
      renamed: 1,
      untracked: 1
    })
  })

  it("returns full file snapshots for tracked diffs", async () => {
    const projectPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "etyon-git-diff-")
    )

    try {
      runGit(projectPath, ["init"])
      runGit(projectPath, ["config", "user.email", "test@example.com"])
      runGit(projectPath, ["config", "user.name", "Etyon Test"])
      await fs.mkdir(path.join(projectPath, "src"))
      await fs.writeFile(path.join(projectPath, "src/app.ts"), "one\nold\n")
      runGit(projectPath, ["add", "."])
      runGit(projectPath, ["commit", "-m", "initial"])
      await fs.writeFile(path.join(projectPath, "src/app.ts"), "one\nnew\n")

      const diff = await getGitProjectDiff(projectPath)

      expect(diff.hasPatch).toBe(true)
      expect(diff.fileSnapshots).toEqual([
        {
          newContent: "one\nnew\n",
          oldContent: "one\nold\n",
          oldPath: undefined,
          path: "src/app.ts",
          stage: "unstaged"
        }
      ])
    } finally {
      await fs.rm(projectPath, {
        force: true,
        recursive: true
      })
    }
  })
})
