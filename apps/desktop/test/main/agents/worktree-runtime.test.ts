import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { AgentSettingsSchema } from "@etyon/rpc"
import { BestOfNRunSchema } from "@etyon/rpc/schemas/worktrees"
import type { UIMessage, UIMessageStreamWriter } from "ai"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vite-plus/test"

import { readToolResultPage } from "@/main/agents/tool-result-store"
import {
  buildRuntimeBestOfNTool,
  cancelRuntimeWorktrees,
  createRuntimeBestOfNService,
  getRuntimeWorktreeManager
} from "@/main/agents/worktree-runtime"
import type { RuntimeBestOfNContext } from "@/main/agents/worktree-runtime"
import { getAppConfigDir } from "@/main/app-paths"
import { resolveActiveProfile } from "@/shared/agents/profiles"

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  getSettings: vi.fn(),
  home: `/private/tmp/etyon-worktree-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  insert: vi.fn<(input: unknown) => Promise<void>>(),
  recordOutcome:
    vi.fn<
      (input: {
        errorMessage?: string
        runId: string
        status: string
        toolCalls: unknown[]
      }) => Promise<void>
    >(),
  releaseSlot: vi.fn(),
  runDelegate: vi.fn(),
  startRun: vi.fn(),
  trySlot: vi.fn()
}))
vi.mock("electron", () => ({
  app: { getPath: () => mocks.home },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: mocks.broadcast } }]
  }
}))
vi.mock("@/main/settings", () => ({ getSettings: mocks.getSettings }))
vi.mock("@/main/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/main/db", () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.insert }),
    select: () => ({
      from: () => ({ where: () => Promise.resolve([{ sequence: 0 }]) })
    })
  })
}))
vi.mock("@/main/db/write-lock", () => ({
  runExclusiveDbWrite: async (work: () => Promise<unknown>) => await work()
}))
vi.mock("@/main/agents/agent-event-store", () => ({
  recordDelegatedRunOutcome: mocks.recordOutcome,
  startAgentRun: mocks.startRun
}))
vi.mock("@/main/agents/minimal/delegation", () => ({
  releaseChildSlot: mocks.releaseSlot,
  runDelegatedAgent: mocks.runDelegate,
  tryAcquireChildSlot: mocks.trySlot
}))

const project = path.join(mocks.home, "project")
const writer = { write: vi.fn() } as unknown as UIMessageStreamWriter<UIMessage>
const settings = () =>
  AgentSettingsSchema.parse({
    allowSubagentDelegation: true,
    enabled: true,
    maxConcurrentSubagents: 4
  })
const context = (): RuntimeBestOfNContext => ({
  modelId: "openai/reviewer",
  parentProfile: resolveActiveProfile(settings(), "coder"),
  parentRunId: "parent",
  permissionMode: "bypass",
  projectPath: project,
  sessionId: "session",
  writer
})
const request = () => ({
  models: [{ modelId: "openai/model-one" }, { modelId: "anthropic/model-two" }],
  projectPath: project,
  prompt: "Implement the requested feature.",
  runId: "parent",
  sessionId: "session"
})

beforeAll(async () => {
  await mkdir(project, { recursive: true })
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project, stdio: "ignore" })
  git("init")
  git("config", "user.name", "Runtime Test")
  git("config", "user.email", "runtime@example.com")
  git("config", "commit.gpgsign", "false")
  git("config", "core.hooksPath", "/dev/null")
  await writeFile(path.join(project, "main.txt"), "base\n")
  git("add", ".")
  git("commit", "-m", "base")
}, 60_000)
afterAll(async () => {
  await rm(mocks.home, { force: true, recursive: true })
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSettings.mockReturnValue({ agents: settings() })
  mocks.trySlot.mockReturnValue(true)
  mocks.startRun.mockImplementation(() =>
    Promise.resolve(`child-${mocks.startRun.mock.calls.length}`)
  )
  mocks.recordOutcome.mockResolvedValue()
  mocks.insert.mockResolvedValue()
})

describe("real Best-of-N runtime binding", { timeout: 120_000 }, () => {
  it("binds selected models, approved writable children, isolated claim scopes and a read-only reviewer", async () => {
    mocks.runDelegate.mockImplementation(async (options) => {
      if (options.childProfile.readonly) {
        return {
          filesRead: [],
          structured: {
            recommendation: "Inspect both implementations.",
            recommendedCandidateId: null
          },
          text: "review",
          toolCalls: []
        }
      }
      await writeFile(
        path.join(options.projectPath, "main.txt"),
        `${options.modelId}\n`
      )
      return {
        filesRead: ["main.txt"],
        text: `Implemented ${options.modelId}`,
        toolCalls: []
      }
    })
    const service = createRuntimeBestOfNService(context())
    const definition = buildRuntimeBestOfNTool(context())
    if (!definition.execute) {
      throw new Error("Expected Best-of-N to be executable.")
    }
    const toolResult = await definition.execute(
      { models: request().models, prompt: request().prompt },
      { context: {}, messages: [], toolCallId: "best-of-n-call" }
    )
    const run = BestOfNRunSchema.parse(toolResult)
    expect(run.candidates.map(({ error }) => error)).toEqual([
      undefined,
      undefined
    ])
    expect(run.state).toBe("ready")
    expect(getRuntimeWorktreeManager().storageRoot).toBe(
      path.join(getAppConfigDir(mocks.home), "worktrees")
    )
    const candidateCalls = mocks.runDelegate.mock.calls
      .map(([options]) => options)
      .filter((options) => !options.childProfile.readonly)
    expect(candidateCalls.map((options) => options.modelId)).toEqual(
      expect.arrayContaining(["openai/model-one", "anthropic/model-two"])
    )
    for (const options of candidateCalls) {
      expect(options.projectPath).not.toBe(project)
      expect(options.hooksConfigProjectPath).toBe(project)
      expect(options.parentRunId).toBe("parent")
      expect(options.parentToolCallId).toBe("best-of-n-call")
      expect(options.writeClaimRunId).toBe(options.childRunId)
      expect(options.permissionMode).toBe("bypass")
      expect(options.childProfile.preferredModel).toBe("")
      expect(options.writer).toBe(writer)
      expect(options.context).toBeUndefined()
    }
    const reviewer = mocks.runDelegate.mock.calls
      .map(([options]) => options)
      .find((options) => options.childProfile.readonly)
    expect(reviewer?.permissionMode).toBeUndefined()
    expect(reviewer?.modelId).toBe("openai/reviewer")
    expect(reviewer?.schema).toMatchObject({ type: "object" })
    expect(reviewer?.task).toContain("submit_findings")
    expect(mocks.startRun).toHaveBeenCalledTimes(3)
    expect(
      mocks.startRun.mock.calls.every(
        ([options]) => options.parentToolCallId === "best-of-n-call"
      )
    ).toBe(true)
    expect(
      mocks.recordOutcome.mock.calls.every(
        ([outcome]) => outcome.status === "succeeded"
      )
    ).toBe(true)
    expect(mocks.releaseSlot).toHaveBeenCalledTimes(3)
    expect(mocks.broadcast).toHaveBeenCalledWith(
      "best-of-n:updated",
      expect.objectContaining({ id: run.id, sessionId: "session" })
    )
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "base\n"
    )
    await service.discard(run.id, "session")
  })

  it("rejects disallowed writable profiles and rejects model execution without a chat context", async () => {
    const service = createRuntimeBestOfNService(context())
    const run = await service.start({
      ...request(),
      models: [
        { modelId: "one", profileId: "explore" },
        { modelId: "two", profileId: "unavailable" }
      ]
    })
    expect(run.state).toBe("failed")
    expect(mocks.runDelegate).not.toHaveBeenCalled()
    await expect(
      createRuntimeBestOfNService().start(request())
    ).rejects.toThrow("active Agent")
    await expect(
      service.start({ ...request(), sessionId: "another-session" })
    ).rejects.toThrow("does not match")
  })

  it("records failed children and leaves successful candidates available when review is unavailable", async () => {
    const runtime = context()
    runtime.parentProfile = {
      ...runtime.parentProfile,
      allowedDelegateProfileIds: ["coder"]
    }
    mocks.runDelegate.mockImplementation(async (options) => {
      if (options.modelId === "anthropic/model-two") {
        throw new Error("provider unavailable")
      }
      await writeFile(path.join(options.projectPath, "main.txt"), "candidate\n")
      return { filesRead: [], text: "candidate", toolCalls: [] }
    })
    const service = createRuntimeBestOfNService(runtime)
    const run = await service.start(request())
    expect(run.state).toBe("ready")
    expect(
      run.candidates.some((candidate) =>
        candidate.error?.includes("provider unavailable")
      )
    ).toBe(true)
    expect(run.review?.recommendedCandidateId).toBeNull()
    expect(run.review?.recommendation).toContain("Review unavailable")
    expect(mocks.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "provider unavailable",
        status: "failed"
      })
    )
    expect(mocks.releaseSlot).toHaveBeenCalledTimes(2)
    await service.discard(run.id, "session")
  })

  it("cancels live model calls on shutdown and settles their persistent child runs", async () => {
    const started = Promise.withResolvers<boolean>()
    mocks.runDelegate.mockImplementation((options) => {
      const pending = Promise.withResolvers<never>()
      const cancel = (): void => {
        pending.reject(new Error("cancelled model call"))
      }
      if (options.abortSignal.aborted) {
        cancel()
      } else {
        options.abortSignal.addEventListener("abort", cancel, { once: true })
      }
      started.resolve(true)
      return pending.promise
    })
    const task = createRuntimeBestOfNService(context()).start(request())
    await started.promise
    await cancelRuntimeWorktrees()
    const cancelled = await task
    expect(cancelled.state).toBe("cancelled")
    expect(mocks.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    )
    expect(mocks.releaseSlot).toHaveBeenCalled()
  })

  it.each([false, true])(
    "uses paged reviewer evidence with an explicit truncated boundary when oversized=%s",
    async (oversized) => {
      let reviewed = false
      mocks.runDelegate.mockImplementation(async (options) => {
        if (!options.childProfile.readonly) {
          const size = oversized ? 600_000 : 50_000
          await writeFile(
            path.join(options.projectPath, "main.txt"),
            `${"x".repeat(size)}\nFINAL_EVIDENCE_${options.modelId}\n`
          )
          return { filesRead: [], text: "Candidate summary.", toolCalls: [] }
        }
        expect(options.task.length).toBeLessThan(12_000)
        const refs = [
          ...String(options.task).matchAll(
            /Stored review evidence: ([a-f\d]{64})/gu
          )
        ].map((match) => match[1])
        expect(refs).toHaveLength(2)
        for (const ref of refs) {
          if (!ref) {
            throw new Error("Expected a reviewer reference.")
          }
          let content = ""
          let offset: number | null = 0
          while (offset !== null) {
            const page = await readToolResultPage({
              limit: 8192,
              offset,
              ref,
              sessionId: "session",
              storageRoot: path.join(
                getAppConfigDir(mocks.home),
                "tool-results"
              )
            })
            content += page.content
            offset = page.nextOffset
          }
          const evidence = JSON.parse(content)
          expect(evidence.truncated).toBe(oversized)
          if (oversized) {
            expect(evidence.fullPatchByteLength).toBeGreaterThan(512 * 1024)
            expect(evidence.patch).not.toContain("FINAL_EVIDENCE_")
            expect(options.task).toContain(
              "unreviewed changes require human inspection"
            )
          } else {
            expect(evidence.patch).toContain("FINAL_EVIDENCE_")
          }
        }
        reviewed = true
        return {
          filesRead: [],
          structured: {
            recommendation: oversized
              ? "Human inspection is required for the unreviewed changes."
              : "Reviewed stored full diffs.",
            recommendedCandidateId: null
          },
          text: "review",
          toolCalls: []
        }
      })
      const service = createRuntimeBestOfNService(context())
      const run = await service.start(request())
      expect(reviewed).toBe(true)
      expect(run.state).toBe("ready")
      await service.discard(run.id, "session")
    }
  )
})
