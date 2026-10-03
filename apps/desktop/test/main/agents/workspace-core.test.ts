import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  configureWorkspacePrivateDirectory,
  getWorkspaceCore,
  invalidateWorkspaceCore,
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

const agentsRulesProjectPath = path.join(projectPath, "rules-agents")
const claudeRulesProjectPath = path.join(projectPath, "rules-claude")
const emptyRulesProjectPath = path.join(projectPath, "rules-empty")
const oversizedRulesProjectPath = path.join(projectPath, "rules-oversized")
const symlinkRulesProjectPath = path.join(projectPath, "rules-symlink")

for (const rulesProjectPath of [
  agentsRulesProjectPath,
  claudeRulesProjectPath,
  emptyRulesProjectPath,
  oversizedRulesProjectPath,
  symlinkRulesProjectPath
]) {
  fs.mkdirSync(rulesProjectPath)
}

fs.writeFileSync(
  path.join(agentsRulesProjectPath, "AGENTS.md"),
  "agent rules\n"
)
fs.writeFileSync(
  path.join(agentsRulesProjectPath, "CLAUDE.md"),
  "ignored fallback\n"
)
fs.writeFileSync(
  path.join(claudeRulesProjectPath, "CLAUDE.md"),
  "claude rules\n"
)
fs.writeFileSync(
  path.join(oversizedRulesProjectPath, "AGENTS.md"),
  "x".repeat(24 * 1024 + 1)
)
fs.symlinkSync(
  path.join(outsidePath, "secret.txt"),
  path.join(symlinkRulesProjectPath, "AGENTS.md")
)

const workspace = getWorkspaceCore(projectPath)

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
  fs.rmSync(outsidePath, { force: true, recursive: true })
})

const privacyHome = fs.mkdtempSync(
  path.join(os.tmpdir(), "etyon-workspace-privacy-")
)
const privacyConfig = path.join(privacyHome, "app[data]")
const PRIVATE_MARKER = "private-workspace-canary-48"
const PUBLIC_MARKER = "public-workspace-canary-62"
const privateEntries = [
  "settings.json",
  "database.db",
  "database.db-wal",
  "database.db-shm",
  "cursor-auth.json",
  "hooks.json",
  "screen-awareness-control.json",
  "screen-awareness-status.json",
  "screen-awareness-captures/old-chat-capture.json",
  "screen-awareness-helper/Contents/MacOS/helper",
  "tool-results/other-chat/old-result.json",
  "agent-tasks/other-chat.json",
  "attachments/other-chat.png",
  "checkpoints/objects/prior.json",
  "worktrees/.records/other-workspace.json",
  "future-private-storage/unknown.json"
]
for (const entry of privateEntries) {
  const target = path.join(privacyConfig, entry)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${PRIVATE_MARKER}\n`)
}
for (const directory of ["artifacts", "generated-images"]) {
  fs.mkdirSync(path.join(privacyConfig, directory))
  fs.writeFileSync(
    path.join(privacyConfig, directory, "public.txt"),
    `${PUBLIC_MARKER}\n`
  )
}
const ordinaryProject = path.join(privacyHome, "project")
fs.mkdirSync(ordinaryProject)
fs.writeFileSync(
  path.join(ordinaryProject, "settings.json"),
  `${PUBLIC_MARKER}\n`
)
fs.symlinkSync(privacyConfig, path.join(privacyHome, "config-alias"))
fs.symlinkSync(
  path.join(privacyConfig, "settings.json"),
  path.join(privacyHome, "settings-alias.txt")
)

afterEach(() => {
  configureWorkspacePrivateDirectory(null)
})
afterAll(() => {
  fs.rmSync(privacyHome, { force: true, recursive: true })
})

describe("application private workspace boundaries", () => {
  it("does not search an output root symlinked into private captures", async () => {
    const linkedConfig = path.join(privacyHome, "linked-outputs")
    fs.mkdirSync(path.join(linkedConfig, "screen-awareness-captures"), {
      recursive: true
    })
    fs.writeFileSync(
      path.join(linkedConfig, "screen-awareness-captures/unsent.json"),
      PRIVATE_MARKER
    )
    fs.symlinkSync(
      path.join(linkedConfig, "screen-awareness-captures"),
      path.join(linkedConfig, "artifacts")
    )
    try {
      configureWorkspacePrivateDirectory(linkedConfig)
      const core = getWorkspaceCore(linkedConfig)
      expect(await core.view("artifacts/unsent.json")).toMatchObject({
        error: { code: "secret-path" },
        ok: false
      })
      expect(
        await core.searchContent({
          glob: "**/*",
          limit: 10,
          pattern: PRIVATE_MARKER
        })
      ).toEqual({ ok: true, value: "" })
    } finally {
      fs.rmSync(linkedConfig, { force: true, recursive: true })
    }
  })
  it("protects both explicitly configured release and development roots", async () => {
    const otherConfig = path.join(privacyHome, "other-app")
    fs.mkdirSync(path.join(otherConfig, "screen-awareness-captures"), {
      recursive: true
    })
    fs.writeFileSync(path.join(otherConfig, "settings.json"), PRIVATE_MARKER)
    fs.writeFileSync(
      path.join(otherConfig, "screen-awareness-captures/unsent.json"),
      PRIVATE_MARKER
    )
    fs.mkdirSync(path.join(otherConfig, "artifacts"))
    fs.writeFileSync(
      path.join(otherConfig, "artifacts/report.md"),
      PUBLIC_MARKER
    )
    try {
      configureWorkspacePrivateDirectory([privacyConfig, otherConfig])
      const broad = getWorkspaceCore(privacyHome)
      expect(
        await broad.view("other-app/screen-awareness-captures/unsent.json")
      ).toMatchObject({ error: { code: "secret-path" }, ok: false })
      expect(await broad.view("other-app/settings.json")).toMatchObject({
        error: { code: "secret-path" },
        ok: false
      })
      expect(
        await broad.searchContent({
          glob: "**/*",
          limit: 10,
          pattern: PRIVATE_MARKER
        })
      ).toEqual({ ok: true, value: "" })
      expect(
        await getWorkspaceCore(otherConfig).view("artifacts/report.md")
      ).toMatchObject({ ok: true })
      expect(await getWorkspaceCore(otherConfig).listDir(".")).toMatchObject({
        ok: true,
        value: [{ path: "artifacts" }]
      })
    } finally {
      fs.rmSync(otherConfig, { force: true, recursive: true })
    }
  })
  it("blocks captures, old tool refs, settings, controls and unknown internal storage", async () => {
    const core = getWorkspaceCore(privacyConfig, "private-reader")
    configureWorkspacePrivateDirectory(privacyConfig)
    for (const entry of privateEntries) {
      expect(await core.view(entry)).toMatchObject({
        error: { code: "secret-path" },
        ok: false
      })
      expect(await core.fileStat(entry)).toMatchObject({
        error: { code: "secret-path" },
        ok: false
      })
    }
    expect(await core.listDir("screen-awareness-captures")).toMatchObject({
      error: { code: "secret-path" },
      ok: false
    })
  })
  it("hides private entries from ls while keeping generated output accessible", async () => {
    configureWorkspacePrivateDirectory(privacyConfig)
    const core = getWorkspaceCore(privacyConfig)
    const listed = await core.listDir(".")
    expect(listed.ok).toBe(true)
    if (!listed.ok) {
      throw new Error("Expected directory listing")
    }
    expect(listed.value.map((entry) => entry.path)).toEqual([
      "artifacts",
      "generated-images"
    ])
    expect(await core.view("artifacts/public.txt")).toMatchObject({ ok: true })
    expect(
      await core.writeFile("artifacts/new-report.md", PUBLIC_MARKER)
    ).toMatchObject({ ok: true })
    expect(
      await core.writeBinaryFile(
        "generated-images/new.png",
        new Uint8Array([1, 2])
      )
    ).toMatchObject({ ok: true })
  })
  it("does not read or overwrite app settings through aliases or create new private captures", async () => {
    configureWorkspacePrivateDirectory(privacyConfig)
    const home = getWorkspaceCore(privacyHome)
    expect(await home.view("settings-alias.txt")).toMatchObject({
      error: { code: "secret-path" },
      ok: false
    })
    expect(
      await home.view(
        "config-alias/screen-awareness-captures/old-chat-capture.json"
      )
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      await home.writeFile("config-alias/settings.json", "changed")
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      await home.writeFile(
        "config-alias/screen-awareness-captures/new/deep.json",
        "capture",
        { createParentDirectories: true }
      )
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      await home.writeBinaryFile(
        "config-alias/new-private-file.bin",
        new Uint8Array([1])
      )
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      fs.readFileSync(path.join(privacyConfig, "settings.json"), "utf-8")
    ).toBe(`${PRIVATE_MARKER}\n`)
    expect(
      fs.existsSync(path.join(privacyConfig, "screen-awareness-captures/new"))
    ).toBe(false)
  })
  it("keeps ordinary project settings readable and searchable", async () => {
    configureWorkspacePrivateDirectory(privacyConfig)
    const core = getWorkspaceCore(ordinaryProject)
    expect(await core.view("settings.json")).toMatchObject({ ok: true })
    expect(
      await core.searchContent({
        glob: "**/settings.json",
        limit: 10,
        pattern: PUBLIC_MARKER
      })
    ).toMatchObject({
      ok: true,
      value: expect.stringContaining("settings.json")
    })
  })
  it("searches only generated output from the default config cwd", async () => {
    configureWorkspacePrivateDirectory(privacyConfig)
    const core = getWorkspaceCore(privacyConfig)
    expect(
      await core.searchContent({
        glob: "**/*",
        limit: 10,
        pattern: PRIVATE_MARKER
      })
    ).toEqual({ ok: true, value: "" })
    const publicSearch = await core.searchContent({
      glob: "**/*.txt",
      limit: 10,
      pattern: PUBLIC_MARKER
    })
    expect(publicSearch).toMatchObject({
      ok: true,
      value: expect.stringContaining("artifacts/public.txt")
    })
    expect(
      await core.searchContent({
        limit: 10,
        pattern: PRIVATE_MARKER,
        requestedPath: "tool-results"
      })
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
  })
  it("enforces actual rg exclusions for broad roots, caller globs and config aliases", async () => {
    configureWorkspacePrivateDirectory(privacyConfig)
    const core = getWorkspaceCore(privacyHome)
    expect(
      await core.searchContent({
        glob: "**/*",
        limit: 10,
        pattern: PRIVATE_MARKER
      })
    ).toEqual({ ok: true, value: "" })
    expect(
      await core.searchContent({
        glob: "**/settings.json",
        limit: 10,
        pattern: PRIVATE_MARKER
      })
    ).toEqual({ ok: true, value: "" })
    expect(
      await core.searchContent({
        limit: 10,
        pattern: PRIVATE_MARKER,
        requestedPath: "settings-alias.txt"
      })
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      await core.searchContent({
        limit: 10,
        pattern: PRIVATE_MARKER,
        requestedPath: "config-alias/screen-awareness-captures"
      })
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      await core.searchContent({
        glob: "**/settings.json",
        limit: 10,
        pattern: PUBLIC_MARKER
      })
    ).toMatchObject({
      ok: true,
      value: expect.stringContaining("project/settings.json")
    })
    const filesystemRoot = getWorkspaceCore(path.parse(privacyHome).root)
    expect(
      await filesystemRoot.view(path.join(privacyConfig, "settings.json"))
    ).toMatchObject({ error: { code: "secret-path" }, ok: false })
    expect(
      await filesystemRoot.searchContent({
        glob: "**/*",
        limit: 10,
        pattern: PRIVATE_MARKER,
        requestedPath: privacyHome
      })
    ).toEqual({ ok: true, value: "" })
  })
})

describe("workspace-core", () => {
  it("serializes aliases of the same real target across actors and project roots", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-canonical-lock-"))
    const realRoot = path.join(base, "real")
    const rootAlias = path.join(base, "root-alias")
    fs.mkdirSync(realRoot)
    fs.mkdirSync(path.join(realRoot, "dir"))
    fs.symlinkSync(realRoot, rootAlias)
    fs.symlinkSync(path.join(realRoot, "dir"), path.join(realRoot, "alias"))
    const target = path.join(realRoot, "dir", "shared.txt")
    fs.writeFileSync(target, "baseline")
    const first = getWorkspaceCore(realRoot, "canonical-first")
    const second = getWorkspaceCore(rootAlias, "canonical-second")
    await first.view("dir/shared.txt")
    await second.view("alias/shared.txt")
    const originalWrite = fsPromises.writeFile
    const delayedWrite = vi
      .spyOn(fsPromises, "writeFile")
      .mockImplementation(async (file, data, options) => {
        await delay(10)
        return originalWrite(file, data, options)
      })
    try {
      const results = await Promise.all([
        first.writeFile("dir/shared.txt", "first", {
          requireReadSnapshot: true
        }),
        second.writeFile("alias/shared.txt", "second", {
          requireReadSnapshot: true
        })
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({ code: "stale-write" }),
          ok: false
        })
      ])
      expect(delayedWrite).toHaveBeenCalledTimes(1)
    } finally {
      delayedWrite.mockRestore()
      fs.rmSync(base, { force: true, recursive: true })
    }
  })

  it("does not recreate a file deleted after this actor read it", async () => {
    const target = path.join(projectPath, "deleted-snapshot.txt")
    fs.writeFileSync(target, "old content")
    const actor = getWorkspaceCore(projectPath, "deleted-writer")
    await actor.view("deleted-snapshot.txt")
    fs.unlinkSync(target)
    expect(
      await actor.writeFile("deleted-snapshot.txt", "stale content", {
        requireReadSnapshot: true
      })
    ).toMatchObject({ error: { code: "stale-write" }, ok: false })
    expect(fs.existsSync(target)).toBe(false)
    expect(await actor.view("deleted-snapshot.txt")).toMatchObject({
      error: { code: "not-found" },
      ok: false
    })
    expect(
      await actor.writeFile("deleted-snapshot.txt", "intentional recreation", {
        requireReadSnapshot: true
      })
    ).toMatchObject({ ok: true })
    expect(
      await actor.writeFile("new-snapshot.txt", "new content", {
        requireReadSnapshot: true
      })
    ).toMatchObject({ ok: true })
  })

  it("does not let another actor refresh a stale writer's snapshot", async () => {
    const target = path.join(projectPath, "actors.txt")
    fs.writeFileSync(target, "version-one")
    const first = getWorkspaceCore(projectPath, "first")
    const second = getWorkspaceCore(projectPath, "second")
    expect(first).not.toBe(second)
    expect(getWorkspaceCore(projectPath, "first")).toBe(first)
    await first.view("actors.txt")
    fs.writeFileSync(target, "version-two")
    await second.view("actors.txt")
    const stale = await first.writeFile("actors.txt", "old intent", {
      requireReadSnapshot: true
    })
    expect(stale).toMatchObject({ error: { code: "stale-write" }, ok: false })
    expect(fs.readFileSync(target, "utf-8")).toBe("version-two")
    await first.view("actors.txt")
    expect(
      await first.writeFile("actors.txt", "fresh intent", {
        requireReadSnapshot: true
      })
    ).toMatchObject({ ok: true })
  })

  it("rejects content changes even when the modification time is restored", async () => {
    const target = path.join(projectPath, "same-time.txt")
    fs.writeFileSync(target, "before")
    const time = new Date("2026-01-01T00:00:00Z")
    fs.utimesSync(target, time, time)
    const actor = getWorkspaceCore(projectPath, "hash-writer")
    await actor.view("same-time.txt")
    fs.writeFileSync(target, "after!")
    fs.utimesSync(target, time, time)
    const stale = await actor.writeFile("same-time.txt", "lost update", {
      requireReadSnapshot: true
    })
    expect(stale).toMatchObject({ error: { code: "stale-write" }, ok: false })
    expect(fs.readFileSync(target, "utf-8")).toBe("after!")
  })
  it("reuses one workspace instance per project path", () => {
    expect(getWorkspaceCore(projectPath)).toBe(workspace)
  })

  it("rebuilds a stale core only after its project directory is recreated", async () => {
    // A sibling symlink makes the realpath divergence deterministic across
    // platforms (mirrors the macOS /tmp -> /private/tmp pinning hazard): a core
    // built while the directory is missing pins the unresolved symlink root.
    const base = fs.mkdtempSync(
      path.join(os.tmpdir(), "etyon-workspace-recreate-")
    )
    const realRoot = path.join(base, "real")
    const linkRoot = path.join(base, "link")
    fs.mkdirSync(realRoot)
    fs.symlinkSync(realRoot, linkRoot)

    const recreatedProjectPath = path.join(linkRoot, "project")
    const staleCore = getWorkspaceCore(recreatedProjectPath)

    fs.mkdirSync(path.join(realRoot, "project"))
    fs.writeFileSync(path.join(realRoot, "project", "note.txt"), "hi\n")

    const staleView = await staleCore.view("note.txt")

    expect(staleView.ok).toBe(false)

    if (!staleView.ok) {
      expect(staleView.error.code).toBe("outside-project")
    }

    // Still the same cached (broken) instance until it is invalidated.
    expect(getWorkspaceCore(recreatedProjectPath)).toBe(staleCore)

    invalidateWorkspaceCore(recreatedProjectPath)
    const freshCore = getWorkspaceCore(recreatedProjectPath)

    expect(freshCore).not.toBe(staleCore)

    const freshView = await freshCore.view("note.txt")

    expect(freshView.ok).toBe(true)

    if (freshView.ok) {
      expect(freshView.value.content).toBe("hi\n")
    }

    fs.rmSync(base, { force: true, recursive: true })
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

  it("reads AGENTS.md workspace rules before CLAUDE.md", async () => {
    const result = await getWorkspaceCore(
      agentsRulesProjectPath
    ).readWorkspaceRules()

    expect(result).toEqual({
      content: "agent rules\n",
      relativePath: "AGENTS.md"
    })
  })

  it("falls back to CLAUDE.md workspace rules", async () => {
    const result = await getWorkspaceCore(
      claudeRulesProjectPath
    ).readWorkspaceRules()

    expect(result).toEqual({
      content: "claude rules\n",
      relativePath: "CLAUDE.md"
    })
  })

  it("returns null when workspace rules are absent", async () => {
    const result = await getWorkspaceCore(
      emptyRulesProjectPath
    ).readWorkspaceRules()

    expect(result).toBeNull()
  })

  it("truncates oversized workspace rules with a marker", async () => {
    const result = await getWorkspaceCore(
      oversizedRulesProjectPath
    ).readWorkspaceRules()

    expect(result).not.toBeNull()
    expect(result?.content).toBe(
      `${"x".repeat(24 * 1024)}\n\n[workspace rules truncated at 24KB]`
    )
  })

  it("rejects workspace rules symlinked outside the project root", async () => {
    const result = await getWorkspaceCore(
      symlinkRulesProjectPath
    ).readWorkspaceRules()

    expect(result).toBeNull()
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
