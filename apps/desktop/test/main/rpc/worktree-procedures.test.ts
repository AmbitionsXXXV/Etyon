import { createRouterClient } from "@orpc/server"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { createMessagePortRpcContext } from "@/main/rpc/context"
import {
  bestOfNRouter,
  hooksRouter,
  worktreesRouter
} from "@/main/rpc/worktree-procedures"
import { runWithChatSessionExecution } from "@/main/server/routes/chat-session-execution"

const mocks = vi.hoisted(() => ({
  bestApply: vi.fn(),
  bestCancel: vi.fn(),
  bestDiscard: vi.fn<(id: string, sessionId: string) => Promise<void>>(),
  bestList: vi.fn(),
  bestPreview: vi.fn(),
  getSession: vi.fn(),
  hookConfigs: vi.fn(),
  treeApply: vi.fn(),
  treeList: vi.fn(),
  treePreview: vi.fn(),
  treePrune: vi.fn<(input: unknown) => Promise<void>>()
}))
vi.mock("electron", () => ({
  app: { getPath: () => "/private/tmp/etyon-rpc-worktree-home" }
}))
vi.mock("@/main/db", () => ({ getDb: () => ({}) }))
vi.mock("@/main/logger", () => ({ logger: {} }))
vi.mock("@/main/chat-sessions", () => ({
  getChatSessionById: mocks.getSession
}))
vi.mock("@/main/agents/hooks/config", () => ({
  listHookConfigs: mocks.hookConfigs
}))
vi.mock("@/main/agents/worktree-runtime", () => ({
  createRuntimeBestOfNService: () => ({
    apply: mocks.bestApply,
    cancel: mocks.bestCancel,
    discard: mocks.bestDiscard,
    list: mocks.bestList,
    preview: mocks.bestPreview
  }),
  getRuntimeWorktreeManager: () => ({
    apply: mocks.treeApply,
    list: mocks.treeList,
    preview: mocks.treePreview,
    prune: mocks.treePrune
  })
}))

const sessionId = "worktree-rpc-session"
const treeId = "12345678-1234-4123-8123-123456789010"
const runId = "12345678-1234-4123-8123-123456789020"
const candidateId = "12345678-1234-4123-8123-123456789030"
const bestRun = {
  candidates: [
    {
      id: candidateId,
      modelId: "model",
      state: "ready" as const,
      summary: "candidate",
      worktreeId: treeId
    }
  ],
  createdAt: "2026-10-03T00:00:00Z",
  id: runId,
  prompt: "task",
  review: null,
  runId: "parent",
  sessionId,
  state: "ready" as const
}
const client = () =>
  createRouterClient(
    { bestOfN: bestOfNRouter, hooks: hooksRouter, worktrees: worktreesRouter },
    { context: createMessagePortRpcContext() }
  )
const treeInput = () => ({
  expectedFingerprint: "fingerprint",
  id: treeId,
  sessionId
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSession.mockImplementation((_db, id) =>
    Promise.resolve(id === sessionId ? { id, projectPath: "/project" } : null)
  )
  mocks.bestList.mockResolvedValue([])
  mocks.treeList.mockResolvedValue([])
  mocks.hookConfigs.mockResolvedValue([])
  mocks.treeApply.mockResolvedValue({
    appliedPaths: ["main.txt"],
    conflicts: [],
    ok: true
  })
  mocks.treePrune.mockResolvedValue()
  mocks.bestApply.mockResolvedValue({
    appliedPaths: ["main.txt"],
    conflicts: [],
    ok: true
  })
  mocks.bestDiscard.mockResolvedValue()
  mocks.bestCancel.mockResolvedValue({ ...bestRun, state: "cancelled" })
})

describe("worktree RPC boundaries", () => {
  it("rejects missing sessions before reading or modifying any worktree or comparison", async () => {
    const rpc = client()
    await expect(
      rpc.worktrees.list({ sessionId: "missing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      rpc.worktrees.apply({ ...treeInput(), sessionId: "missing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      rpc.bestOfN.cancel({ id: runId, sessionId: "missing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      rpc.hooks.list({ sessionId: "missing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(mocks.treeList).not.toHaveBeenCalled()
    expect(mocks.treeApply).not.toHaveBeenCalled()
    expect(mocks.bestCancel).not.toHaveBeenCalled()
    expect(mocks.hookConfigs).not.toHaveBeenCalled()
  })

  it("refuses workspace mutations during an active chat but keeps cancellation available", async () => {
    const pending = Promise.withResolvers<Response>()
    const active = runWithChatSessionExecution(sessionId, () => pending.promise)
    const rpc = client()
    try {
      await expect(rpc.worktrees.apply(treeInput())).rejects.toMatchObject({
        code: "CONFLICT"
      })
      await expect(
        rpc.worktrees.prune({ discardChanges: true, id: treeId, sessionId })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      await expect(
        rpc.bestOfN.apply({ ...treeInput(), candidateId, id: runId })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      await expect(
        rpc.bestOfN.discard({ id: runId, sessionId })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      const cancelled = await rpc.bestOfN.cancel({ id: runId, sessionId })
      expect(cancelled.state).toBe("cancelled")
      expect(mocks.treeApply).not.toHaveBeenCalled()
      expect(mocks.treePrune).not.toHaveBeenCalled()
      expect(mocks.bestApply).not.toHaveBeenCalled()
      expect(mocks.bestDiscard).not.toHaveBeenCalled()
      expect(mocks.bestCancel).toHaveBeenCalledWith(runId, sessionId)
    } finally {
      pending.resolve(new Response(null, { status: 204 }))
      await active
    }
  })

  it("prevents generic apply and prune from bypassing a Best-of-N selection", async () => {
    mocks.bestList.mockResolvedValue([bestRun])
    const rpc = client()
    await expect(rpc.worktrees.apply(treeInput())).rejects.toMatchObject({
      code: "CONFLICT"
    })
    await expect(
      rpc.worktrees.prune({ discardChanges: true, id: treeId, sessionId })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(mocks.treeApply).not.toHaveBeenCalled()
    expect(mocks.treePrune).not.toHaveBeenCalled()
    const selected = await rpc.bestOfN.apply({
      ...treeInput(),
      candidateId,
      id: runId
    })
    expect(selected.ok).toBe(true)
    expect(mocks.bestApply).toHaveBeenCalledWith({
      candidateId,
      expectedFingerprint: "fingerprint",
      id: runId,
      sessionId
    })
  })

  it("holds the session lease across asynchronous candidate ownership checks and application", async () => {
    const ownership = Promise.withResolvers<(typeof bestRun)[]>()
    const checking = Promise.withResolvers<boolean>()
    mocks.bestList.mockImplementation(() => {
      checking.resolve(true)
      return ownership.promise
    })
    const task = client().worktrees.apply(treeInput())
    await checking.promise
    const startChat = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    )
    try {
      expect(await runWithChatSessionExecution(sessionId, startChat)).toBeNull()
      expect(startChat).not.toHaveBeenCalled()
    } finally {
      ownership.resolve([])
      await task
    }
    expect(mocks.treeApply).toHaveBeenCalledOnce()
    expect(
      await runWithChatSessionExecution(sessionId, startChat)
    ).not.toBeNull()
  })

  it("releases a mutation lease after backend failure and forwards session ownership to reads", async () => {
    mocks.treeApply.mockRejectedValue(new Error("apply failed"))
    await expect(client().worktrees.apply(treeInput())).rejects.toThrow()
    expect(
      await runWithChatSessionExecution(sessionId, () =>
        Promise.resolve(new Response(null, { status: 204 }))
      )
    ).not.toBeNull()
    await client().worktrees.list({ sessionId })
    await client().bestOfN.list({ sessionId })
    expect(mocks.treeList).toHaveBeenCalledWith(sessionId)
    expect(mocks.bestList).toHaveBeenCalledWith(sessionId)
  })
})
