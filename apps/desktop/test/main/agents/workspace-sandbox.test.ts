import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"

import {
  createWorkspaceSandbox,
  detectWorkspaceSandboxSupport,
  sanitizeWorkspaceSandboxEnv
} from "@/main/agents/workspace-sandbox"

const testProjectPath = `/tmp/etyon-workspace-sandbox-test-${Date.now()}`

const sandboxSettings = {
  allowNetwork: false,
  autoAllowSandboxedShell: false,
  enabled: true,
  failIfUnavailable: true
} as const

describe("workspace sandbox", () => {
  beforeAll(() => {
    fs.mkdirSync(testProjectPath, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(testProjectPath, { force: true, recursive: true })
  })

  it("reports unsupported platforms as unavailable", () => {
    expect(
      detectWorkspaceSandboxSupport({
        platform: "win32"
      })
    ).toEqual({
      available: false,
      engine: "unsupported",
      message: "Workspace sandbox is not supported on this platform."
    })
  })

  it("scrubs secret-like environment variables", () => {
    expect(
      sanitizeWorkspaceSandboxEnv({
        LANG: "en_US.UTF-8",
        OPENAI_API_KEY: "secret",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        VITE_TOKEN: "secret"
      })
    ).toEqual({
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin"
    })
  })

  it("fails closed when sandbox support is unavailable", async () => {
    const sandbox = createWorkspaceSandbox({
      platform: "win32",
      projectPath: testProjectPath,
      settings: sandboxSettings
    })

    await expect(
      sandbox.prepareShellCommand({
        command: "printf ok",
        cwd: testProjectPath,
        env: {}
      })
    ).resolves.toEqual({
      error: {
        code: "unsupported",
        message: "Workspace sandbox is not supported on this platform."
      },
      ok: false
    })
  })

  it("prepares macOS Seatbelt commands with project write and network limits", async () => {
    const sandbox = createWorkspaceSandbox({
      platform: "darwin",
      projectPath: testProjectPath,
      sandboxExecPath: "/usr/bin/sandbox-exec",
      settings: sandboxSettings
    })
    const result = await sandbox.prepareShellCommand({
      command: "printf ok",
      cwd: testProjectPath,
      env: {
        OPENAI_API_KEY: "secret",
        PATH: "/usr/bin"
      }
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        command: "/usr/bin/sandbox-exec",
        cwd: testProjectPath,
        env: {
          PATH: "/usr/bin"
        },
        sandboxed: true
      }
    })

    if (!result.ok) {
      throw new Error(result.error.message)
    }

    const [, profilePath] = result.value.args
    const profile = fs.readFileSync(profilePath, "utf-8")

    expect(profile).toContain("(deny network*)")
    expect(profile).toContain(JSON.stringify(testProjectPath))
    expect(profile).toContain(JSON.stringify(os.tmpdir()))
    expect(profile).toContain("\\.env")

    await result.value.cleanup()

    expect(fs.existsSync(profilePath)).toBe(false)
  })

  it("prepares Linux bwrap commands with network isolation", async () => {
    const sandbox = createWorkspaceSandbox({
      bwrapPath: "/usr/bin/bwrap",
      platform: "linux",
      projectPath: testProjectPath,
      settings: sandboxSettings
    })
    const result = await sandbox.prepareShellCommand({
      command: "printf ok",
      cwd: path.join(testProjectPath, "src"),
      env: {
        PATH: "/usr/bin"
      }
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        command: "/usr/bin/bwrap",
        cwd: path.join(testProjectPath, "src"),
        sandboxed: true
      }
    })

    if (!result.ok) {
      throw new Error(result.error.message)
    }

    expect(result.value.args).toContain("--unshare-net")
    expect(result.value.args).toContain("--bind")
    expect(result.value.args).toContain(testProjectPath)
  })
})
