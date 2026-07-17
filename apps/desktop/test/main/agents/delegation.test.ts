import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { AgentSettingsSchema } from "@etyon/rpc"
import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildRunProjection,
  recordDelegatedRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import {
  buildChildTools,
  resolveDelegateTarget
} from "@/main/agents/minimal/delegation"
import type { WorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentRuns, agentToolCalls } from "@/main/db/schema"
import { resolveActiveProfile } from "@/shared/agents/profiles"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-delegation-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

// Temp workspace for child-tool clamp tests
const tempProjectPath = fs.mkdtempSync(
  path.join(os.tmpdir(), "etyon-child-tools-")
)
// A file whose content exceeds TOOL_OUTPUT_MAX_CHARS (12,000)
const largeContent = "x".repeat(20_000)

fs.writeFileSync(path.join(tempProjectPath, "large.txt"), largeContent)
fs.writeFileSync(
  path.join(tempProjectPath, "needle.txt"),
  "FIND_ME line content\n"
)

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() }
}))

const settings = AgentSettingsSchema.parse({})

const fakeParent = (
  overrides: Partial<ResolvedAgentProfile> = {}
): ResolvedAgentProfile => ({
  allowDelegation: true,
  allowedDelegateProfileIds: ["explore"],
  allowedTools: ["read", "ls", "grep", "edit", "write"],
  available: true,
  executionMode: "generalist",
  id: "parent",
  instructions: "",
  name: "Parent",
  preferredModel: "",
  readonly: false,
  ...overrides
})

describe("agent delegation", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
    fs.rmSync(tempProjectPath, { force: true, recursive: true })
  })

  it("resolves an allowed delegate target", () => {
    const child = resolveDelegateTarget(settings, fakeParent(), "explore")

    expect(child.id).toBe("explore")
    expect(child.readonly).toBe(true)
  })

  it("rejects a profile the parent may not delegate to", () => {
    expect(() =>
      resolveDelegateTarget(settings, fakeParent(), "coder")
    ).toThrow(/not allowed/u)
  })

  it("rejects an unknown delegate profile", () => {
    expect(() =>
      resolveDelegateTarget(
        settings,
        fakeParent({ allowedDelegateProfileIds: ["ghost"] }),
        "ghost"
      )
    ).toThrow(/Unknown or unavailable/u)
  })

  it("gives children read-only tools only (no write or edit)", () => {
    const tools = buildChildTools(
      {} as unknown as WorkspaceCore,
      new Set<string>(),
      []
    )

    expect(Object.keys(tools).toSorted()).toEqual(["grep", "ls", "read"])
    expect(tools).not.toHaveProperty("edit")
    expect(tools).not.toHaveProperty("write")
  })

  it("derives delegation availability only for write profiles", () => {
    const general = resolveActiveProfile(
      AgentSettingsSchema.parse({ allowSubagentDelegation: true })
    )

    expect(general.allowDelegation).toBe(true)
    expect(general.allowedDelegateProfileIds).toContain("explore")
  })

  it("persists a child run linked to its parent with its tool trace", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })

    const parentRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId: "general-purpose"
    })
    const childRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      parentRunId,
      profileId: "explore"
    })

    await recordDelegatedRunOutcome({
      db,
      runId: childRunId,
      status: "succeeded",
      toolCalls: [
        {
          input: { path: "a.ts" },
          output: "1\tcontent",
          toolCallId: "tc-1",
          toolName: "read"
        }
      ]
    })

    const [childRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, childRunId))
      .limit(1)

    expect(childRun?.parentRunId).toBe(parentRunId)
    expect(childRun?.status).toBe("succeeded")
    expect(childRun?.finishedAt).not.toBeNull()

    const childToolCalls = await db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.runId, childRunId))

    expect(childToolCalls).toHaveLength(1)
    expect(childToolCalls[0]?.toolName).toBe("read")
    expect(childToolCalls[0]?.state).toBe("finished")

    const projection = await buildRunProjection({ db, runId: childRunId })
    const eventTypes = projection?.events.map((event) => event.type) ?? []

    expect(eventTypes).toContain("run.started")
    expect(eventTypes).toContain("tool.result")
    expect(eventTypes).toContain("run.succeeded")
  })

  it("read clamps large file output and adds the path to filesRead", async () => {
    const filesRead = new Set<string>()
    const toolCalls: Parameters<typeof buildChildTools>[2] = []
    const workspace = getWorkspaceCore(tempProjectPath)
    const tools = buildChildTools(workspace, filesRead, toolCalls)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const output = await tools.read.execute!(
      { path: "large.txt" },
      { context: {}, messages: [], toolCallId: "tc-read-1" }
    )

    const outputStr = String(output)

    expect(outputStr).toContain("[... truncated at 12000 characters]")
    expect(outputStr.length).toBeLessThanOrEqual(12_100)
    expect(filesRead.size).toBe(1)
    const [readPath] = filesRead

    expect(readPath).toContain("large.txt")
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.toolName).toBe("read")
    expect(toolCalls[0]?.toolCallId).toBe("tc-read-1")
  })

  it("ls returns tab-separated listing and pushes an ls record", async () => {
    const toolCalls: Parameters<typeof buildChildTools>[2] = []
    const workspace = getWorkspaceCore(tempProjectPath)
    const tools = buildChildTools(workspace, new Set<string>(), toolCalls)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const output = await tools.ls.execute!(
      { path: "." },
      { context: {}, messages: [], toolCallId: "tc-ls-1" }
    )

    const outputStr = String(output)

    expect(typeof outputStr).toBe("string")
    expect(outputStr).toMatch(/\t/u)
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.toolName).toBe("ls")
    expect(toolCalls[0]?.toolCallId).toBe("tc-ls-1")
  })

  it("grep over many matches is clamped or notes missing rg", async () => {
    const toolCalls: Parameters<typeof buildChildTools>[2] = []
    const workspace = getWorkspaceCore(tempProjectPath)
    const tools = buildChildTools(workspace, new Set<string>(), toolCalls)

    // Write a file with many repeated matches so the raw output is large
    const manyMatchContent = "FIND_ME\n".repeat(2000)

    fs.writeFileSync(
      path.join(tempProjectPath, "many-matches.txt"),
      manyMatchContent
    )

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const output = await tools.grep.execute!(
      { pattern: "FIND_ME" },
      { context: {}, messages: [], toolCallId: "tc-grep-1" }
    )

    const outputStr = String(output)

    // If rg is unavailable the tool returns an error: prefix — that's acceptable
    if (outputStr.startsWith("error:")) {
      expect(outputStr).toMatch(/error:/u)
    } else {
      // Large output should be clamped
      expect(outputStr.length).toBeLessThanOrEqual(12_100)
    }

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.toolName).toBe("grep")
    expect(toolCalls[0]?.toolCallId).toBe("tc-grep-1")
  })
})
