import fs from "node:fs"

import { AgentSettingsSchema } from "@etyon/rpc"
import type * as Ai from "ai"
import { and, eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { startAgentRun } from "@/main/agents/agent-event-store"
import type { DelegateToolContext } from "@/main/agents/minimal/delegation"
import type * as WorkflowEngine from "@/main/agents/minimal/workflow/engine"
import { buildWorkflowTool } from "@/main/agents/minimal/workflow/workflow-tool"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { agentRuns } from "@/main/db/schema"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

interface WorkflowInput {
  args?: unknown
  script: string
}
type WorkflowFn = (input: WorkflowInput, ctx: unknown) => Promise<unknown>

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before module imports
// ---------------------------------------------------------------------------

const {
  getSettingsMock,
  mockedHomeDir,
  resolveModelMock,
  runWorkflowOptionsMock,
  streamTextMock
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  mockedHomeDir: `/tmp/etyon-workflow-tool-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`,
  resolveModelMock: vi.fn(() => ({})),
  runWorkflowOptionsMock: vi.fn(),
  streamTextMock: vi.fn()
}))

// Minimal `streamText` result stand-in for the shared child runner. Without a
// writer `runDelegatedAgent` self-consumes via `await result.text`; with one it
// also drains `toUIMessageStream()`, so an empty (immediately closed) stream is
// enough for both paths.
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
// helpers stay intact for the workflow tool's inputSchema parsing.
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

vi.mock("@/main/agents/minimal/workflow/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkflowEngine>()

  return {
    ...actual,
    runWorkflow: (
      script: string,
      options: WorkflowEngine.WorkflowRunOptions
    ) => {
      runWorkflowOptionsMock(options)
      return actual.runWorkflow(script, options)
    }
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const agentSettings = (
  maxConcurrentSubagents: number,
  maxWorkflowConcurrency = 1
) =>
  AgentSettingsSchema.parse({
    allowSubagentDelegation: true,
    maxConcurrentSubagents,
    maxWorkflowConcurrency
  })

const fakeParentProfile = (): ResolvedAgentProfile => ({
  allowDelegation: true,
  allowedDelegateProfileIds: ["explore"],
  allowedTools: ["read", "ls", "grep", "edit", "write"],
  available: true,
  executionMode: "generalist",
  id: "general-purpose",
  instructions: "",
  name: "General",
  preferredModel: "",
  readonly: false
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

const callWorkflow = (
  workflow: ReturnType<typeof buildWorkflowTool>,
  input: WorkflowInput,
  context: unknown = {}
): Promise<unknown> =>
  (workflow.execute as unknown as WorkflowFn)(input, context)

const META =
  'export const meta = { name: "scan", description: "scan the repo" }'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildWorkflowTool execute path", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("fans out to read-only child runs recorded under the parent", async () => {
    // Concurrency 1 keeps the two child runs' event-store transactions
    // sequential — a single libsql connection rejects concurrent write
    // transactions, which the mocked (instant) model would otherwise force.
    getSettingsMock.mockReturnValue({ agents: agentSettings(1) })
    streamTextMock.mockReturnValue(streamTextResult({ text: "child findings" }))

    const ctx = await buildCtx()
    const workflow = buildWorkflowTool(ctx)

    const result = await callWorkflow(workflow, {
      script: `${META}\nreturn await parallel([() => agent("look at a"), () => agent("look at b")])`
    })

    expect(result).toMatchObject({
      agentCount: 2,
      summary: expect.stringContaining("scan the repo")
    })

    const db = getDb()
    const childRuns = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.parentRunId, ctx.parentRunId),
          eq(agentRuns.status, "succeeded")
        )
      )

    expect(childRuns).toHaveLength(2)
    expect(childRuns.every((run) => run.profileId === "explore")).toBe(true)
  })

  it("records the workflow call's toolCallId on each child run", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(1) })
    streamTextMock.mockReturnValue(streamTextResult({ text: "child findings" }))

    const ctx = await buildCtx()
    const workflow = buildWorkflowTool(ctx)

    await callWorkflow(
      workflow,
      {
        script: `${META}\nreturn await parallel([() => agent("a"), () => agent("b")])`
      },
      { toolCallId: "workflow-tc" }
    )

    const db = getDb()
    const childRuns = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.parentRunId, ctx.parentRunId),
          eq(agentRuns.parentToolCallId, "workflow-tc")
        )
      )

    expect(childRuns).toHaveLength(2)
  })

  it("provides the dedicated workflow concurrency setting", () => {
    const settings = AgentSettingsSchema.parse({})

    expect(settings.maxWorkflowConcurrency).toBe(8)
  })

  it("uses the dedicated workflow concurrency instead of the delegate cap", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(1, 2) })

    const workflow = buildWorkflowTool(await buildCtx())
    await callWorkflow(workflow, {
      script: `${META}\nreturn 1`
    })

    expect(runWorkflowOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ concurrency: 2 })
    )
  })

  it("threads schema output and a per-agent model override", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(1) })
    streamTextMock.mockImplementation(
      (options: {
        tools: Record<string, { execute?: (...args: unknown[]) => unknown }>
      }) => {
        // The child's submit_findings execute is synchronous (it records the
        // structured output), so invoking it before returning the result stand-in
        // guarantees `structured` is set by the time `result.text` is awaited.
        options.tools.submit_findings?.execute?.(
          { answer: 42 },
          { toolCallId: "submit-1" }
        )
        return streamTextResult({ text: "fallback" })
      }
    )

    const workflow = buildWorkflowTool(await buildCtx())
    const result = await callWorkflow(workflow, {
      script: `${META}\nreturn await agent("x", { model: "custom/model", schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] } })`
    })

    expect(result).toMatchObject({ result: '{"answer":42}' })
    expect(resolveModelMock).toHaveBeenCalledWith("custom/model")
  })

  it("emits transient workflow progress parts", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(1) })
    streamTextMock.mockReturnValue(streamTextResult({ text: "ok" }))
    const write = vi.fn()
    const workflow = buildWorkflowTool({
      ...(await buildCtx()),
      writer: { merge: vi.fn(), onError: undefined, write }
    })

    await callWorkflow(
      workflow,
      { script: `${META}\nphase("Scan"); return await agent("x")` },
      { toolCallId: "workflow-call" }
    )

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "workflow-call",
        transient: true,
        type: "data-workflow-progress"
      })
    )
  })

  it("returns a structured error on a parse error instead of throwing", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(4) })

    const ctx = await buildCtx()
    const workflow = buildWorkflowTool(ctx)

    const result = await callWorkflow(workflow, { script: "const x = 1" })

    expect(result).toMatchObject({
      error: expect.stringMatching(/first statement/u)
    })
  })

  it("returns a structured error when the script runs no agents", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(4) })

    const ctx = await buildCtx()
    const workflow = buildWorkflowTool(ctx)

    const result = await callWorkflow(workflow, {
      script: `${META}\nreturn 1`
    })

    expect(result).toMatchObject({
      error: expect.stringMatching(/no agents/u)
    })
  })

  it("records a failed child run yet stays fail-soft when the model errors", async () => {
    getSettingsMock.mockReturnValue({ agents: agentSettings(4) })
    streamTextMock.mockReturnValue(
      streamTextResult({ error: new Error("model boom") })
    )

    const ctx = await buildCtx()
    const workflow = buildWorkflowTool(ctx)

    const result = await callWorkflow(workflow, {
      script: `${META}\nconst r = await agent("x")\nreturn r`
    })

    // Fail-soft: a failed sub-agent resolves to null, so the workflow still
    // finishes with one recorded agent and a null result.
    expect(result).toMatchObject({ agentCount: 1, result: "null" })

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
    expect(failedRuns[0]?.errorMessage).toBe("model boom")
  })
})

type NeedsApprovalFn = (
  input: unknown,
  options: unknown
) => boolean | Promise<boolean>

describe("buildWorkflowTool approval gating", () => {
  // A gate check needs no DB: build a lightweight context and read the tool's
  // needsApproval directly. buildCtx's chat-session row is irrelevant here, and
  // the execute-path suite above tears down the shared home dir in afterAll.
  const gateFor = (
    permissionMode: DelegateToolContext["permissionMode"]
  ): NeedsApprovalFn => {
    const ctx: DelegateToolContext = {
      chatSessionId: "session",
      parentModelId: null,
      parentProfile: fakeParentProfile(),
      parentRunId: "run",
      permissionMode,
      projectPath: "/tmp"
    }

    return (
      buildWorkflowTool(ctx) as unknown as { needsApproval: NeedsApprovalFn }
    ).needsApproval
  }

  it("gates script execution outside bypass mode", async () => {
    const needsApproval = gateFor("default")

    expect(typeof needsApproval).toBe("function")
    expect(await needsApproval({}, {})).toBe(true)
  })

  it("auto-runs the script without approval in bypass mode", async () => {
    expect(await gateFor("bypass")({}, {})).toBe(false)
  })
})
