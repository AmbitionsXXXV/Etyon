import { AgentSettingsSchema } from "@etyon/rpc"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  buildAgentToolset,
  resolveToolsetProfile
} from "@/main/agents/minimal/agent-toolset"
import { READONLY_FILE_TOOLS } from "@/shared/agents/profiles"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

const { getSettingsMock, isImageGenerationAvailableMock, mockedHomeDir } =
  vi.hoisted(() => ({
    getSettingsMock: vi.fn(),
    isImageGenerationAvailableMock: vi.fn(() => true),
    mockedHomeDir: `/tmp/etyon-agent-toolset-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  }))

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () =>
      process.cwd().endsWith("/apps/desktop")
        ? process.cwd()
        : `${process.cwd()}/apps/desktop`,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() }
}))

vi.mock("@/main/settings", () => ({
  getSettings: getSettingsMock
}))

vi.mock("@/main/server/lib/providers", () => ({
  isImageGenerationAvailable: isImageGenerationAvailableMock,
  resolveModel: vi.fn(() => ({}))
}))

vi.mock("@/main/db", () => ({
  getDb: vi.fn()
}))

const settingsFixture = () => ({
  agents: AgentSettingsSchema.parse({ allowSubagentDelegation: true }),
  memory: { enabled: false }
})

const writableProfile = (): ResolvedAgentProfile => ({
  allowDelegation: true,
  // "coder" is writable and "explore" read-only in the built-in roster.
  allowedDelegateProfileIds: ["coder", "explore"],
  allowedTools: ["read", "ls", "grep", "edit", "write"],
  available: true,
  executionMode: "generalist",
  id: "general-purpose",
  instructions: "",
  name: "General",
  preferredModel: "",
  readonly: false
})

const buildToolset = (agentMode: "agent" | "plan") =>
  buildAgentToolset({
    agentMode,
    agentRunId: "run-1",
    chatSessionId: "session-1",
    modelId: null,
    permissionMode: "default",
    profile: writableProfile(),
    projectPath: "/tmp"
  })

describe("buildAgentToolset plan-mode policy", () => {
  it("drops the write surface and registers the input tools in plan mode", () => {
    getSettingsMock.mockReturnValue(settingsFixture())
    isImageGenerationAvailableMock.mockReturnValue(true)

    const tools = buildToolset("plan")
    const names = Object.keys(tools)

    expect(names).toEqual(
      expect.arrayContaining([
        "read",
        "ls",
        "grep",
        "todo_write",
        "ask_user",
        "propose_plan"
      ])
    )

    for (const dropped of ["edit", "write", "bash", "artifact", "imagen"]) {
      expect(names).not.toContain(dropped)
    }

    // No execute: calling either suspends the run until the user answers.
    expect(tools.ask_user?.execute).toBeUndefined()
    expect(tools.propose_plan?.execute).toBeUndefined()
  })

  it("keeps read-only delegation available in plan mode", () => {
    getSettingsMock.mockReturnValue(settingsFixture())

    const tools = buildToolset("plan")

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["delegate", "workflow"])
    )
  })

  it("keeps the write surface and omits the input tools in agent mode", () => {
    getSettingsMock.mockReturnValue(settingsFixture())
    isImageGenerationAvailableMock.mockReturnValue(true)

    const tools = buildToolset("agent")
    const names = Object.keys(tools)

    expect(names).toEqual(
      expect.arrayContaining(["read", "ls", "grep", "edit", "write", "bash"])
    )
    expect(names).not.toContain("ask_user")
    expect(names).not.toContain("propose_plan")
  })
})

describe("resolveToolsetProfile", () => {
  it("returns the profile untouched outside plan mode", () => {
    const profile = writableProfile()

    expect(
      resolveToolsetProfile({
        agentMode: "agent",
        profile,
        readonlyProfileIds: new Set(["explore"])
      })
    ).toBe(profile)
  })

  it("flips read-only and narrows delegation to read-only profiles in plan mode", () => {
    const resolved = resolveToolsetProfile({
      agentMode: "plan",
      profile: writableProfile(),
      readonlyProfileIds: new Set(["explore"])
    })

    expect(resolved.readonly).toBe(true)
    expect(resolved.allowedTools).toEqual(READONLY_FILE_TOOLS)
    expect(resolved.allowedDelegateProfileIds).toEqual(["explore"])
  })
})
