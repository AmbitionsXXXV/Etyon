import fs from "node:fs"

import { AgentSettingsSchema } from "@etyon/rpc"
import type * as Ai from "ai"
import { and, eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { startAgentRun } from "@/main/agents/agent-event-store"
import { buildDelegateTool } from "@/main/agents/minimal/delegation"
import type { DelegateToolContext } from "@/main/agents/minimal/delegation"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentRuns } from "@/main/db/schema"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

interface DelegateInput {
  context?: string
  profileId: string
  task: string
}
type DelegateFn = (input: DelegateInput, ctx: unknown) => Promise<unknown>

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before module imports
// ---------------------------------------------------------------------------

const { getSettingsMock, mockedHomeDir, resolveModelMock, streamTextMock } =
  vi.hoisted(() => ({
    getSettingsMock: vi.fn(),
    mockedHomeDir: `/tmp/etyon-delegate-tool-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
    resolveModelMock: vi.fn(() => ({})),
    streamTextMock: vi.fn()
  }))

// A minimal `streamText` result stand-in: `runDelegatedAgent` self-consumes it
// via `await result.text` (headless path — no writer here), so only `.text`
// (and, defensively, an empty UI stream) needs to behave.
const emptyUiStream = (): ReadableStream =>
  new ReadableStream({
    start(controller) {
      controller.close()
    }
  })

const streamTextResult = (options: { error?: Error; text?: string }) => ({
  get text() {
    return options.error
      ? Promise.reject(options.error)
      : Promise.resolve(options.text ?? "")
  },
  toUIMessageStream: () => emptyUiStream()
})

// Electron stubs — copied verbatim from delegation.test.ts
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

// Partial-mock `ai` — only override streamText so the real `tool` / `z`
// helpers stay intact for the delegate tool's inputSchema parsing.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>()

  return { ...actual, streamText: streamTextMock }
})

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: resolveModelMock
}))

vi.mock("@/main/settings", () => ({
  getSettings: getSettingsMock
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const agentSettings = (maxConcurrentSubagents: number) =>
  AgentSettingsSchema.parse({
    allowSubagentDelegation: true,
    maxConcurrentSubagents
  })

const fakeParentProfile = (
  overrides: Partial<ResolvedAgentProfile> = {}
): ResolvedAgentProfile => ({
  allowDelegation: true,
  allowedDelegateProfileIds: ["explore"],
  allowedTools: ["read", "ls", "grep", "edit", "write"],
  available: true,
  executionMode: "generalist",
  id: "general-purpose",
  instructions: "",
  name: "General",
  preferredModel: "",
  readonly: false,
  ...overrides
})

const buildCtx = async (): Promise<DelegateToolContext> => {
  await ensureDatabaseReady()
  const db = getDb()
  const session = await createChatSession({ db })
  const parentRunId = await startAgentRun({
    chatSessionId: session.id,
    db,
    modelId: null,
    profileId: "general-purpose"
  })

  return {
    chatSessionId: session.id,
    parentModelId: null,
    parentProfile: fakeParentProfile(),
    parentRunId,
    permissionMode: "default" as const,
    projectPath: "/tmp"
  }
}

// Cast buildDelegateTool's result to a callable for tests — the Mastra Tool
// type marks .execute as optional (it may be omitted in some configurations),
// but buildDelegateTool always provides it, and the tests drive it directly.
const callDelegate = (
  delegate: ReturnType<typeof buildDelegateTool>,
  input: DelegateInput,
  context: unknown = {}
): Promise<unknown> =>
  (delegate.execute as unknown as DelegateFn)(input, context)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDelegateTool execute path", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("respects maxConcurrentSubagents=1: rejects a second concurrent call", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(1) })

    // Build a deferred before handing it to the mock so resolve is captured
    // synchronously at the time streamText is invoked. The child holds its slot
    // while `result.text` stays pending.
    const deferred = Promise.withResolvers<string>()

    streamTextMock.mockImplementationOnce(() => ({
      get text() {
        return deferred.promise
      },
      toUIMessageStream: () => emptyUiStream()
    }))

    const ctx = await buildCtx()
    const delegate = buildDelegateTool(ctx)

    // Fire first call without awaiting — it holds the only concurrency slot.
    // tryAcquireChildSlot runs synchronously inside execute before the first
    // real await (startAgentRun). Yield enough microtasks so the slot is
    // acquired before the second call attempts to acquire it.
    const firstCall = callDelegate(delegate, {
      profileId: "explore",
      task: "first task"
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Second call should be rejected (slot exhausted)
    await expect(
      callDelegate(delegate, { profileId: "explore", task: "second task" })
    ).rejects.toThrow(/Concurrent sub-agent limit/u)

    // Release the first child and confirm it resolves
    deferred.resolve("done")
    const result = await firstCall

    expect(result).toMatchObject({
      filesRead: expect.any(Array),
      summary: expect.any(String)
    })

    // After the first call resolved, the slot should be free — third call accepted
    streamTextMock.mockReturnValueOnce(streamTextResult({ text: "third done" }))

    await expect(
      callDelegate(delegate, { profileId: "explore", task: "third task" })
    ).resolves.toMatchObject({ summary: expect.any(String) })
  })

  it("records a failed child run and rethrows 'Delegation failed' on streamText error", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(2) })
    streamTextMock.mockReturnValueOnce(
      streamTextResult({ error: new Error("boom") })
    )

    const ctx = await buildCtx()
    const delegate = buildDelegateTool(ctx)

    await expect(
      callDelegate(delegate, { profileId: "explore", task: "broken task" })
    ).rejects.toThrow(/Delegation failed: boom/u)

    // The child run must be recorded as failed and linked to the parent
    const db = getDb()
    const failedRuns = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.parentRunId, ctx.parentRunId),
          eq(agentRuns.status, "failed")
        )
      )

    expect(failedRuns.length).toBeGreaterThanOrEqual(1)
    expect(failedRuns[0]?.errorMessage).toBe("boom")
  })

  it("records the initiating toolCallId on the child run row", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(2) })
    streamTextMock.mockReturnValueOnce(streamTextResult({ text: "done" }))

    const ctx = await buildCtx()
    const delegate = buildDelegateTool(ctx)

    const result = await callDelegate(
      delegate,
      { profileId: "explore", task: "investigate" },
      { toolCallId: "tc-delegate" }
    )
    const { childRunId } = result as { childRunId: string }

    const db = getDb()
    const [childRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, childRunId))

    expect(childRun?.parentToolCallId).toBe("tc-delegate")
    expect(childRun?.parentRunId).toBe(ctx.parentRunId)
  })

  it("releases the concurrency slot after a failure so the next call is accepted", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(1) })
    streamTextMock.mockReturnValueOnce(
      streamTextResult({ error: new Error("transient") })
    )

    const ctx = await buildCtx()
    const delegate = buildDelegateTool(ctx)

    // First call fails — slot must be released in the finally block
    await expect(
      callDelegate(delegate, { profileId: "explore", task: "will fail" })
    ).rejects.toThrow(/Delegation failed/u)

    // Subsequent call should NOT be blocked by the failed slot
    streamTextMock.mockReturnValueOnce(streamTextResult({ text: "recovery" }))

    await expect(
      callDelegate(delegate, { profileId: "explore", task: "recovery" })
    ).resolves.toMatchObject({ summary: expect.any(String) })
  })
})
