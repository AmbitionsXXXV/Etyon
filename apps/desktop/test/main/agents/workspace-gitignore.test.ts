import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  buildNextGitignoreContents,
  ensureGitignored
} from "@/main/agents/minimal/workspace-gitignore"

const HEADER = "# Etyon-generated files (auto-added)"

const readGitignore = (projectPath: string): string =>
  fs.readFileSync(path.join(projectPath, ".gitignore"), "utf-8")

describe("buildNextGitignoreContents", () => {
  it("adds a header and entry to empty contents", () => {
    expect(buildNextGitignoreContents("", "generated-images/")).toBe(
      `${HEADER}\ngenerated-images/\n`
    )
  })

  it("appends after existing content with a blank-line separator", () => {
    expect(
      buildNextGitignoreContents("node_modules\ndist\n", "generated-images/")
    ).toBe(`node_modules\ndist\n\n${HEADER}\ngenerated-images/\n`)
  })

  it("normalizes a missing trailing newline before appending", () => {
    expect(
      buildNextGitignoreContents("node_modules", "generated-images/")
    ).toBe(`node_modules\n\n${HEADER}\ngenerated-images/\n`)
  })

  it("reuses an existing generated section header", () => {
    const existing = `${HEADER}\ngenerated-images/\n`

    expect(buildNextGitignoreContents(existing, "artifacts/scratch/")).toBe(
      `${HEADER}\ngenerated-images/\nartifacts/scratch/\n`
    )
  })

  it("returns null when the entry is already present", () => {
    expect(
      buildNextGitignoreContents("generated-images/\n", "generated-images/")
    ).toBeNull()
  })

  it("treats slash and non-slash entries as equivalent", () => {
    // Matches the entry hand-added to this repo's .gitignore (no trailing slash).
    expect(
      buildNextGitignoreContents("generated-images\n", "generated-images/")
    ).toBeNull()
  })
})

describe("ensureGitignored", () => {
  const tempDirs: string[] = []

  const makeProject = ({ git }: { git: boolean }): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-gitignore-"))

    tempDirs.push(dir)

    if (git) {
      fs.mkdirSync(path.join(dir, ".git"))
    }

    return dir
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()

      if (dir) {
        fs.rmSync(dir, { force: true, recursive: true })
      }
    }
  })

  it("creates .gitignore with the entry in a git repo", async () => {
    const projectPath = makeProject({ git: true })

    await ensureGitignored({ entry: "generated-images/", projectPath })

    const contents = readGitignore(projectPath)

    expect(contents).toContain("generated-images/")
    expect(contents).toContain(HEADER)
  })

  it("appends to an existing .gitignore without disturbing it", async () => {
    const projectPath = makeProject({ git: true })

    fs.writeFileSync(path.join(projectPath, ".gitignore"), "node_modules\n")

    await ensureGitignored({ entry: "generated-images/", projectPath })

    const contents = readGitignore(projectPath)

    expect(contents.startsWith("node_modules\n")).toBe(true)
    expect(contents).toContain("generated-images/")
  })

  it("does not duplicate an entry that is already ignored", async () => {
    const projectPath = makeProject({ git: true })

    fs.writeFileSync(path.join(projectPath, ".gitignore"), "generated-images\n")

    await ensureGitignored({ entry: "generated-images/", projectPath })

    expect(readGitignore(projectPath)).toBe("generated-images\n")
  })

  it("no-ops when the project is not a git repository", async () => {
    const projectPath = makeProject({ git: false })

    await ensureGitignored({ entry: "generated-images/", projectPath })

    expect(fs.existsSync(path.join(projectPath, ".gitignore"))).toBe(false)
  })
})
