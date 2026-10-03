import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

import { AgentSettingsSchema } from "@etyon/rpc"
import type { BestOfNRun } from "@etyon/rpc/schemas/worktrees"
import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import { createUIMessageStream } from "ai"
import type { UIMessage, UIMessageChunk, UIMessageStreamWriter } from "ai"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/libsql/migrator"
import { drizzle } from "drizzle-orm/libsql/node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { startAgentRun } from "@/main/agents/agent-event-store"
import { InvocationOutcomeUnknownError } from "@/main/agents/invocation-ledger"
import type { AppDatabase } from "@/main/db"
import { agentInvocations, chatSessions, schema } from "@/main/db/schema"
import { executeBestOfNStream } from "@/main/server/routes/build-best-of-n-stream"
import { resolveActiveProfile } from "@/shared/agents/profiles"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  serviceFactory: vi.fn(),
  start: vi.fn()
}))
vi.mock("@/main/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/main/agents/worktree-runtime", () => ({
  createRuntimeBestOfNService: mocks.serviceFactory
}))

let client: Client
let db: AppDatabase
let parentRunId: string
const sessionId = "best-of-n-stream-session"
const scopedToolCallId = `${createHash("sha256").update("/project").digest("hex")}:best-of-n:user-request`
const run: BestOfNRun = {
  candidates: [],
  createdAt: "2026-10-03T00:00:00Z",
  id: "12345678-1234-4123-8123-123456789000",
  prompt: "task",
  review: null,
  runId: "parent",
  sessionId,
  state: "ready"
}
const options = (): Omit<
  Parameters<typeof executeBestOfNStream>[0],
  "writer"
> => ({
  abortSignal: new AbortController().signal,
  modelId: "openai/review-model",
  parentProfile: resolveActiveProfile(
    AgentSettingsSchema.parse({ allowSubagentDelegation: true, enabled: true }),
    "coder"
  ),
  parentRunId,
  permissionMode: "bypass",
  projectPath: "/project",
  request: {
    models: [{ modelId: "openai/one" }, { modelId: "anthropic/two" }],
    prompt: "Implement the feature",
    sessionId
  },
  userMessageId: "user-request"
})
const readStream = async (request = options()) => {
  const chunks: UIMessageChunk[] = []
  let outcome: Awaited<ReturnType<typeof executeBestOfNStream>> | undefined
  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      outcome = await executeBestOfNStream({ ...request, writer })
    }
  })
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
  }
  return { chunks, outcome }
}

beforeEach(async () => {
  vi.resetAllMocks()
  client = createClient({ url: "file::memory:" })
  db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../../drizzle", import.meta.url)
    )
  })
  const now = new Date().toISOString()
  await db.insert(chatSessions).values({
    createdAt: now,
    id: sessionId,
    lastOpenedAt: now,
    projectPath: "/project",
    title: "",
    updatedAt: now
  })
  parentRunId = await startAgentRun({
    chatSessionId: sessionId,
    db,
    modelId: "openai/review-model",
    profileId: "coder"
  })
  mocks.getDb.mockReturnValue(db)
  mocks.start.mockResolvedValue(run)
  mocks.serviceFactory.mockReturnValue({ start: mocks.start })
})
afterEach(() => {
  client.close()
})

describe("explicit Best-of-N UI stream", () => {
  it("connects a real stream writer and stable toolCallId after persisting invocation intent", async () => {
    mocks.start.mockImplementation(async () => {
      const [invocation] = await db.select().from(agentInvocations)
      expect(invocation).toMatchObject({
        runId: parentRunId,
        state: "executing",
        toolCallId: scopedToolCallId,
        toolName: "best_of_n"
      })
      const context = mocks.serviceFactory.mock.calls[0]?.[0]
      context.writer.write({
        data: { childRunId: "child", profileId: "coder", task: "candidate" },
        transient: true,
        type: "data-subagent-start"
      })
      return run
    })
    const result = await readStream()
    expect(result.outcome?.exitReason).toBe("completed")
    expect(mocks.serviceFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "openai/review-model",
        parentRunId,
        parentToolCallId: "best-of-n:user-request",
        permissionMode: "bypass",
        projectPath: "/project",
        sessionId,
        writer: expect.objectContaining({ write: expect.any(Function) })
      })
    )
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: "best-of-n-result:user-request",
          type: "start"
        }),
        expect.objectContaining({
          toolCallId: "best-of-n:user-request",
          toolName: "best_of_n",
          type: "tool-input-available"
        }),
        expect.objectContaining({ type: "data-subagent-start" }),
        expect.objectContaining({
          output: run,
          toolCallId: "best-of-n:user-request",
          type: "tool-output-available"
        })
      ])
    )
    const [invocation] = await db.select().from(agentInvocations)
    expect(invocation?.state).toBe("succeeded")
  })

  it("returns a persisted comparison without rerunning any candidate for a duplicate UI request", async () => {
    const first = await readStream()
    const repeated = await readStream()
    expect(first.outcome?.exitReason).toBe("completed")
    expect(repeated.outcome?.exitReason).toBe("completed")
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(repeated.chunks).toContainEqual(
      expect.objectContaining({
        output: run,
        toolCallId: "best-of-n:user-request",
        type: "tool-output-available"
      })
    )
    expect(await db.select().from(agentInvocations)).toHaveLength(1)
  })

  it("does not execute or emit a tool call when no persisted parent run is available", async () => {
    const write = vi.fn()
    const writer = { write } as unknown as UIMessageStreamWriter<UIMessage>
    await expect(
      executeBestOfNStream({ ...options(), parentRunId: null, writer })
    ).rejects.toThrow("persisted parent run")
    expect(write).not.toHaveBeenCalled()
    expect(mocks.serviceFactory).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
    expect(await db.select().from(agentInvocations)).toHaveLength(0)
  })

  it("does not replay a comparison whose invocation outcome is unknown", async () => {
    await readStream()
    await db
      .update(agentInvocations)
      .set({ outputJson: null, state: "unknown" })
      .where(eq(agentInvocations.toolCallId, scopedToolCallId))
    const writer = {
      write: vi.fn()
    } as unknown as UIMessageStreamWriter<UIMessage>
    await expect(
      executeBestOfNStream({ ...options(), writer })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    expect(mocks.start).toHaveBeenCalledOnce()
  })

  it("settles failed and cancelled comparisons into the parent loop outcome", async () => {
    mocks.start.mockResolvedValueOnce({ ...run, state: "failed" })
    const failed = await readStream({
      ...options(),
      userMessageId: "failed-request"
    })
    expect(failed.outcome).toMatchObject({
      errorMessage: "No candidate completed successfully",
      exitReason: "model-error"
    })
    mocks.start.mockResolvedValueOnce({ ...run, state: "cancelled" })
    const cancelled = await readStream({
      ...options(),
      userMessageId: "cancelled-request"
    })
    expect(cancelled.outcome).toMatchObject({
      errorMessage: null,
      exitReason: "aborted"
    })
  })
})
