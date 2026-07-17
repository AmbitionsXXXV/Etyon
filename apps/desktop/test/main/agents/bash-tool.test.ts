import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { AgentSettingsSchema } from "@etyon/rpc"
import type { AgentCommandApprovalRule, AgentSettings } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { buildAgentToolset } from "@/main/agents/minimal/agent-toolset"
import {
  buildBashTool,
  matchesCommandAllowlist
} from "@/main/agents/minimal/bash-tool"
import { buildFileTools } from "@/main/agents/minimal/file-tools"
import { resetRtkAvailabilityCacheForTests } from "@/main/agents/minimal/rtk-rewrite"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

const { getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(() => ({
    agents: {
      approvals: {
        approvalTtlMs: 3_600_000,
        commandAllowlist: [] as AgentCommandApprovalRule[]
      },
      rtk: { autoRewrite: false }
    },
    memory: { enabled: false }
  }))
}))

vi.mock("@/main/settings", () => ({
  getSettings: getSettingsMock
}))

vi.mock("@/main/db", () => ({
  getDb: vi.fn()
}))

vi.mock("@/main/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

vi.mock("@/main/memory", () => ({
  buildMemorySystemPrompt: vi.fn(),
  saveAgentMemoryNote: vi.fn()
}))

vi.mock("@/main/server/lib/providers", () => ({
  IMAGE_MODEL_ID: "gpt-image-2",
  isImageGenerationAvailable: () => false,
  resolveImageModel: vi.fn(),
  resolveModel: vi.fn()
}))

const STDOUT_TAIL_MAX_CHARS = 9000
const ALLOWLIST_TTL_MS = 3_600_000
const ALLOWLIST_NOW_MS = Date.parse("2026-07-11T12:00:00.000Z")

const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-bash-tool-"))
const makeAgentSettings = (
  overrides: Partial<AgentSettings> = {}
): AgentSettings => AgentSettingsSchema.parse(overrides)
const bashTool = buildBashTool(
  getWorkspaceCore(projectPath),
  "default",
  makeAgentSettings({ rtk: { autoRewrite: false } })
)

const execute = async <TOutput>(
  tool: unknown,
  input: unknown,
  context?: unknown
): Promise<TOutput> => {
  const { execute: executeTool } = tool as {
    execute?: (inputData: never, options?: never) => Promise<unknown>
  }

  if (!executeTool) {
    throw new Error("tool has no execute")
  }

  return (await executeTool(input as never, context as never)) as TOutput
}

const makeProfile = (
  overrides: Partial<ResolvedAgentProfile> = {}
): ResolvedAgentProfile => ({
  allowDelegation: false,
  allowedDelegateProfileIds: [],
  allowedTools: ["edit", "grep", "ls", "read", "write"],
  available: true,
  executionMode: "generalist",
  id: "bash-test-profile",
  instructions: "",
  name: "Bash Test Profile",
  preferredModel: "",
  readonly: false,
  ...overrides
})

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
  resetRtkAvailabilityCacheForTests()
})

describe("bash tool", () => {
  it("captures stdout and completes with exit code 0", async () => {
    const output = await execute<{
      durationMs: number
      exitCode: number | null
      status: string
      stderrPreview: string
      stdoutPreview: string
      truncated: boolean
    }>(bashTool, { command: "printf 'hello from bash'" })

    expect(output.status).toBe("completed")
    expect(output.exitCode).toBe(0)
    expect(output.stdoutPreview).toBe("hello from bash")
    expect(output.stderrPreview).toBe("")
    expect(output.truncated).toBe(false)
    expect(output.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("runs from the workspace project path", async () => {
    const output = await execute<{ stdoutPreview: string }>(bashTool, {
      command: "pwd"
    })

    expect(output.stdoutPreview.trim()).toBe(fs.realpathSync(projectPath))
  })

  it("returns non-zero exit codes with stderr instead of throwing", async () => {
    const output = await execute<{
      exitCode: number | null
      status: string
      stderrPreview: string
    }>(bashTool, { command: "printf 'boom' >&2; exit 3" })

    expect(output.status).toBe("completed")
    expect(output.exitCode).toBe(3)
    expect(output.stderrPreview).toBe("boom")
  })

  it("keeps only the tail of oversized output and flags truncation", async () => {
    const output = await execute<{
      stdoutPreview: string
      truncated: boolean
    }>(bashTool, {
      command:
        "i=0; while [ \"$i\" -lt 1200 ]; do printf '0123456789'; i=$((i+1)); done; printf 'TAIL_MARKER'"
    })

    expect(output.truncated).toBe(true)
    expect(output.stdoutPreview.length).toBeLessThanOrEqual(
      STDOUT_TAIL_MAX_CHARS
    )
    expect(output.stdoutPreview.endsWith("TAIL_MARKER")).toBe(true)
  })

  it("kills long-running commands and reports a timeout", async () => {
    const output = await execute<{
      durationMs: number
      exitCode: number | null
      status: string
    }>(bashTool, { command: "sleep 5", timeoutSeconds: 1 })

    expect(output.status).toBe("timeout")
    expect(output.exitCode).toBeNull()
    expect(output.durationMs).toBeLessThan(4000)
  })

  it("stops the command when the abort signal fires", async () => {
    const controller = new AbortController()
    const resultPromise = execute<{
      exitCode: number | null
      status: string
    }>(bashTool, { command: "sleep 5" }, { abortSignal: controller.signal })

    setTimeout(() => controller.abort(), 100)

    const output = await resultPromise

    expect(output.status).toBe("aborted")
    expect(output.exitCode).toBeNull()
  })

  it("short-circuits without spawning when already aborted", async () => {
    const controller = new AbortController()

    controller.abort()

    const output = await execute<{
      durationMs: number
      status: string
    }>(
      bashTool,
      { command: "printf 'never'" },
      {
        abortSignal: controller.signal
      }
    )

    expect(output.status).toBe("aborted")
    expect(output.durationMs).toBe(0)
  })

  it("rewrites an allowlisted command only for execution", async () => {
    const fakeBinPath = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-rtk-bin-"))
    const fakeRtkPath = path.join(fakeBinPath, "rtk")
    const originalPath = process.env.PATH

    fs.writeFileSync(
      fakeRtkPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'rtk test'
  exit 0
fi
printf '%s' "$*"
`
    )
    fs.chmodSync(fakeRtkPath, 0o755)
    process.env.PATH = [
      fakeBinPath,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      originalPath
    ]
      .filter(Boolean)
      .join(path.delimiter)
    resetRtkAvailabilityCacheForTests()

    try {
      const rtkTool = buildBashTool(
        getWorkspaceCore(projectPath),
        "default",
        makeAgentSettings({ rtk: { autoRewrite: true } })
      )
      const output = await execute<{
        details: {
          command: string
          executedCommand: string
          rtkApplied: boolean
        }
        stdoutPreview: string
      }>(rtkTool, { command: "git status" })

      expect(output.details).toEqual({
        command: "git status",
        executedCommand: "rtk git status",
        rtkApplied: true
      })
      expect(output.stdoutPreview).toBe("git status")
    } finally {
      process.env.PATH = originalPath
      fs.rmSync(fakeBinPath, { force: true, recursive: true })
      resetRtkAvailabilityCacheForTests()
    }
  })
})

describe("bash tool needsApproval", () => {
  const callNeedsApproval = (
    command: string,
    settings = makeAgentSettings({ rtk: { autoRewrite: false } })
  ): boolean | Promise<boolean> => {
    const { needsApproval } = buildBashTool(
      getWorkspaceCore(projectPath),
      "default",
      settings
    ) as unknown as {
      needsApproval: (
        input: unknown,
        options: unknown
      ) => boolean | Promise<boolean>
    }

    return needsApproval({ command }, {})
  }

  it("requires approval when no allowlist entry matches", async () => {
    expect(await callNeedsApproval("vp test")).toBe(true)
  })

  it("skips approval for a remembered command in this project", async () => {
    const settings = makeAgentSettings({
      approvals: {
        approvalTtlMs: ALLOWLIST_TTL_MS,
        commandAllowlist: [
          {
            command: "vp test",
            createdAt: new Date().toISOString(),
            projectPath,
            toolName: "bash"
          }
        ]
      }
    })

    expect(await callNeedsApproval("vp test", settings)).toBe(false)
  })
})

describe("permission-mode gating", () => {
  const workspace = getWorkspaceCore(projectPath)

  const bashNeedsApproval = (
    mode: AgentPermissionMode,
    command: string
  ): boolean | Promise<boolean> => {
    const { needsApproval } = buildBashTool(
      workspace,
      mode,
      makeAgentSettings({ rtk: { autoRewrite: false } })
    ) as unknown as {
      needsApproval: (
        input: unknown,
        options: unknown
      ) => boolean | Promise<boolean>
    }

    return needsApproval({ command }, {})
  }

  const editNeedsApproval = (mode: AgentPermissionMode): boolean => {
    const { edit } = buildFileTools(workspace, mode) as unknown as {
      edit: { needsApproval: boolean }
    }

    return edit.needsApproval
  }

  it("never gates bash in bypass, even for an unremembered safe command", async () => {
    expect(await bashNeedsApproval("bypass", "vp test")).toBe(false)
  })

  it("gates an unremembered safe command in default", async () => {
    expect(await bashNeedsApproval("default", "vp test")).toBe(true)
  })

  it("keeps shell gated in acceptEdits (only edits auto-run)", async () => {
    expect(await bashNeedsApproval("acceptEdits", "vp test")).toBe(true)
  })

  it("always gates a dangerous command outside bypass", async () => {
    expect(await bashNeedsApproval("default", "rm -rf build")).toBe(true)
    expect(await bashNeedsApproval("acceptEdits", "rm -rf build")).toBe(true)
  })

  it("does not gate a dangerous command in bypass", async () => {
    expect(await bashNeedsApproval("bypass", "rm -rf build")).toBe(false)
  })

  it("does not gate a remembered safe command in default", async () => {
    const { needsApproval } = buildBashTool(
      workspace,
      "default",
      makeAgentSettings({
        approvals: {
          approvalTtlMs: ALLOWLIST_TTL_MS,
          commandAllowlist: [
            {
              command: "vp test",
              createdAt: new Date().toISOString(),
              projectPath,
              toolName: "bash"
            }
          ]
        }
      })
    ) as unknown as {
      needsApproval: (
        input: unknown,
        options: unknown
      ) => boolean | Promise<boolean>
    }

    expect(await needsApproval({ command: "vp test" }, {})).toBe(false)
  })

  it("gates file edits only in default mode", () => {
    expect(editNeedsApproval("default")).toBe(true)
    expect(editNeedsApproval("acceptEdits")).toBe(false)
    expect(editNeedsApproval("bypass")).toBe(false)
  })
})

describe("matchesCommandAllowlist", () => {
  const baseRule = {
    command: "vp test",
    createdAt: "2026-07-11T11:30:00.000Z",
    projectPath: "/tmp/project-a",
    toolName: "bash"
  }
  const baseInput = {
    approvalTtlMs: ALLOWLIST_TTL_MS,
    command: "vp test",
    nowMs: ALLOWLIST_NOW_MS,
    projectPath: "/tmp/project-a",
    toolName: "bash"
  }

  it("matches an exact remembered command", () => {
    expect(
      matchesCommandAllowlist({ ...baseInput, allowlist: [baseRule] })
    ).toBe(true)
  })

  it("trims commands and resolves project paths before comparing", () => {
    expect(
      matchesCommandAllowlist({
        ...baseInput,
        allowlist: [baseRule],
        command: "  vp test  ",
        projectPath: "/tmp/project-a/"
      })
    ).toBe(true)
  })

  it("misses when the project differs", () => {
    expect(
      matchesCommandAllowlist({
        ...baseInput,
        allowlist: [baseRule],
        projectPath: "/tmp/project-b"
      })
    ).toBe(false)
  })

  it("misses when the tool differs", () => {
    expect(
      matchesCommandAllowlist({
        ...baseInput,
        allowlist: [baseRule],
        toolName: "rtkCommand"
      })
    ).toBe(false)
  })

  it("misses when the approval has expired", () => {
    expect(
      matchesCommandAllowlist({
        ...baseInput,
        allowlist: [{ ...baseRule, createdAt: "2026-07-11T10:30:00.000Z" }]
      })
    ).toBe(false)
  })

  it("misses when createdAt is not a valid date", () => {
    expect(
      matchesCommandAllowlist({
        ...baseInput,
        allowlist: [{ ...baseRule, createdAt: "not-a-date" }]
      })
    ).toBe(false)
  })
})

describe("agent toolset wiring", () => {
  const buildToolsetFor = (profile: ResolvedAgentProfile) =>
    buildAgentToolset({
      agentMode: "agent",
      agentRunId: null,
      chatSessionId: null,
      modelId: null,
      permissionMode: "default",
      profile,
      projectPath
    })

  it("offers bash to writable profiles", () => {
    const toolset = buildToolsetFor(makeProfile())

    expect(Object.keys(toolset)).toContain("bash")
    expect(Object.keys(toolset)).toContain("write")
  })

  it("withholds bash from readonly profiles", () => {
    const toolset = buildToolsetFor(
      makeProfile({
        allowedTools: ["grep", "ls", "read"],
        readonly: true
      })
    )

    expect(Object.keys(toolset)).not.toContain("bash")
    expect(Object.keys(toolset)).toContain("read")
  })

  it("offers workflow and delegate when a delegation-enabled profile has a run", () => {
    const toolset = buildAgentToolset({
      agentMode: "agent",
      agentRunId: "run-1",
      chatSessionId: "session-1",
      modelId: null,
      permissionMode: "default",
      profile: makeProfile({
        allowDelegation: true,
        allowedDelegateProfileIds: ["explore"]
      }),
      projectPath
    })

    expect(Object.keys(toolset)).toContain("delegate")
    expect(Object.keys(toolset)).toContain("workflow")
  })

  it("withholds workflow without a persisted run", () => {
    const toolset = buildToolsetFor(
      makeProfile({
        allowDelegation: true,
        allowedDelegateProfileIds: ["explore"]
      })
    )

    expect(Object.keys(toolset)).not.toContain("workflow")
  })
})
