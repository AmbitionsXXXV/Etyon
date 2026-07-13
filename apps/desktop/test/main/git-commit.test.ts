import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vite-plus/test"

import { commitFiles } from "@/main/git-commit"

const tempProjectPaths: string[] = []

const createTempProject = async (): Promise<string> => {
  const projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "etyon-git-commit-")
  )
  tempProjectPaths.push(projectPath)

  return projectPath
}

const runGit = (cwd: string, args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8"
  }).trim()

const initializeRepository = async ({
  configureIdentity = true
}: {
  configureIdentity?: boolean
} = {}): Promise<string> => {
  const projectPath = await createTempProject()

  runGit(projectPath, ["init"])

  if (configureIdentity) {
    runGit(projectPath, ["config", "user.email", "test@example.com"])
    runGit(projectPath, ["config", "user.name", "Etyon Test"])
  } else {
    runGit(projectPath, ["config", "user.email", ""])
    runGit(projectPath, ["config", "user.name", ""])
  }

  return projectPath
}

afterEach(async () => {
  await Promise.all(
    tempProjectPaths.splice(0).map((projectPath) =>
      fs.rm(projectPath, {
        force: true,
        recursive: true
      })
    )
  )
})

describe("commitFiles", () => {
  it("commits selected files and returns the short hash", async () => {
    const projectPath = await initializeRepository()
    await fs.writeFile(path.join(projectPath, "notes.md"), "hello\n")

    const result = await commitFiles({
      message: "add notes\n\nkeep the body",
      paths: ["notes.md"],
      projectPath
    })

    expect(result).toMatchObject({
      committedFileCount: 1,
      ok: true
    })

    if (!result.ok) {
      throw new Error(`Expected commit to succeed: ${result.reason}`)
    }

    expect(result.shortHash).toBe(
      runGit(projectPath, ["rev-parse", "--short", "HEAD"])
    )
    expect(runGit(projectPath, ["rev-list", "--count", "HEAD"])).toBe("1")
    expect(runGit(projectPath, ["log", "-1", "--pretty=%B"])).toBe(
      "add notes\n\nkeep the body"
    )
  })

  it("returns identity-missing when the repository has no identity", async () => {
    const projectPath = await initializeRepository({
      configureIdentity: false
    })
    await fs.writeFile(path.join(projectPath, "notes.md"), "hello\n")

    await expect(
      commitFiles({
        message: "add notes",
        paths: ["notes.md"],
        projectPath
      })
    ).resolves.toEqual({
      ok: false,
      reason: "identity-missing"
    })
  })

  it("returns merge-in-progress when MERGE_HEAD exists", async () => {
    const projectPath = await initializeRepository()
    await fs.writeFile(path.join(projectPath, ".git/MERGE_HEAD"), "deadbeef\n")
    await fs.writeFile(path.join(projectPath, "notes.md"), "hello\n")

    await expect(
      commitFiles({
        message: "add notes",
        paths: ["notes.md"],
        projectPath
      })
    ).resolves.toEqual({
      ok: false,
      reason: "merge-in-progress"
    })
  })

  it("rejects empty selections before invoking Git", async () => {
    await expect(
      commitFiles({
        message: "add notes",
        paths: [],
        projectPath: "/path/that/does/not/exist"
      })
    ).resolves.toEqual({
      ok: false,
      reason: "empty-selection"
    })
  })

  it("rejects empty messages before invoking Git", async () => {
    await expect(
      commitFiles({
        message: " \n\t ",
        paths: ["notes.md"],
        projectPath: "/path/that/does/not/exist"
      })
    ).resolves.toEqual({
      ok: false,
      reason: "empty-message"
    })
  })

  it("returns git-failed with stderr for an unmatched pathspec", async () => {
    const projectPath = await initializeRepository()

    const result = await commitFiles({
      message: "add missing file",
      paths: ["missing.txt"],
      projectPath
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "git-failed"
    })

    if (result.ok || result.reason !== "git-failed") {
      throw new Error("Expected a git-failed result")
    }

    expect(result.detail).toContain("pathspec 'missing.txt'")
  })

  it("serializes concurrent commits without interleaving Git steps", async () => {
    const projectPath = await initializeRepository()
    await fs.writeFile(path.join(projectPath, "a.txt"), "a\n")
    await fs.writeFile(path.join(projectPath, "b.txt"), "b\n")
    const firstAddReached = Promise.withResolvers<null>()
    const releaseFirstAdd = Promise.withResolvers<null>()
    const steps: string[] = []

    const firstCommit = commitFiles(
      {
        message: "add a",
        paths: ["a.txt"],
        projectPath
      },
      {
        onStep: async (step) => {
          steps.push(`a:${step}`)

          if (step === "add") {
            firstAddReached.resolve(null)
            await releaseFirstAdd.promise
          }
        }
      }
    )
    const secondCommit = commitFiles(
      {
        message: "add b",
        paths: ["b.txt"],
        projectPath
      },
      {
        onStep: (step) => {
          steps.push(`b:${step}`)
          return Promise.resolve()
        }
      }
    )

    await firstAddReached.promise
    expect(steps).toEqual(["a:preflight", "a:add"])
    releaseFirstAdd.resolve(null)

    await expect(Promise.all([firstCommit, secondCommit])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true })
    ])
    expect(steps).toEqual([
      "a:preflight",
      "a:add",
      "a:commit",
      "a:rev-parse",
      "b:preflight",
      "b:add",
      "b:commit",
      "b:rev-parse"
    ])
    expect(runGit(projectPath, ["rev-list", "--count", "HEAD"])).toBe("2")
  })
})
