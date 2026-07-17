import fs from "node:fs"

import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  deriveSessionPlanUpsert,
  getSessionPlan,
  setSessionPlanStatus,
  upsertSessionPlanFromMessages
} from "@/main/agents/session-plans"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-session-plans-test-${Date.now()}-${Math.random()
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
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() }
}))

const DEFAULT_PLAN_INPUT = { plan: "1. do a\n2. do b", title: "Refactor auth" }

const toMessages = (messages: unknown[]): UIMessage[] =>
  messages as unknown as UIMessage[]

const proposePlanPart = ({
  input = DEFAULT_PLAN_INPUT,
  output,
  toolCallId
}: {
  input?: unknown
  output?: unknown
  toolCallId: string
}): unknown =>
  output === undefined
    ? { input, state: "input-available", toolCallId, type: "tool-propose_plan" }
    : {
        input,
        output,
        state: "output-available",
        toolCallId,
        type: "tool-propose_plan"
      }

const assistantWith = (parts: unknown[]): unknown => ({
  id: `assistant-${Math.random().toString(36).slice(2)}`,
  parts,
  role: "assistant"
})

const messagesWith = (parts: unknown[]): UIMessage[] =>
  toMessages([
    { id: "u1", parts: [{ text: "plan it", type: "text" }], role: "user" },
    assistantWith(parts)
  ])

describe("deriveSessionPlanUpsert", () => {
  it("returns null without a propose_plan part", () => {
    const messages = messagesWith([{ text: "just thinking", type: "text" }])

    expect(
      deriveSessionPlanUpsert({ existing: null, messages, runId: "run-1" })
    ).toBeNull()
  })

  it("proposes an unanswered call (input only, not decided)", () => {
    const messages = messagesWith([proposePlanPart({ toolCallId: "call-1" })])

    expect(
      deriveSessionPlanUpsert({ existing: null, messages, runId: "run-1" })
    ).toEqual({
      decided: false,
      planMarkdown: "1. do a\n2. do b",
      sourceRunId: "run-1",
      sourceToolCallId: "call-1",
      status: "proposed",
      title: "Refactor auth"
    })
  })

  it("moves to implementing on an implement decision", () => {
    const messages = messagesWith([
      proposePlanPart({
        output: { decision: "implement" },
        toolCallId: "call-1"
      })
    ])

    expect(
      deriveSessionPlanUpsert({ existing: null, messages, runId: "run-2" })
    ).toMatchObject({ decided: true, status: "implementing" })
  })

  it("stays proposed on a not_now decision (but decided)", () => {
    const messages = messagesWith([
      proposePlanPart({ output: { decision: "not_now" }, toolCallId: "call-1" })
    ])

    expect(
      deriveSessionPlanUpsert({ existing: null, messages, runId: "run-2" })
    ).toMatchObject({ decided: true, status: "proposed" })
  })

  it("never resurrects a done plan re-persisted under the same tool call", () => {
    const messages = messagesWith([
      proposePlanPart({
        output: { decision: "implement" },
        toolCallId: "call-1"
      })
    ])

    expect(
      deriveSessionPlanUpsert({
        existing: { sourceToolCallId: "call-1", status: "done" },
        messages,
        runId: "run-3"
      })
    ).toBeNull()
  })

  it("never resurrects a dismissed plan re-persisted under the same tool call", () => {
    const messages = messagesWith([
      proposePlanPart({
        output: { decision: "implement" },
        toolCallId: "call-1"
      })
    ])

    expect(
      deriveSessionPlanUpsert({
        existing: { sourceToolCallId: "call-1", status: "dismissed" },
        messages,
        runId: "run-3"
      })
    ).toBeNull()
  })

  it("allows the proposed -> implementing transition on the same tool call", () => {
    const messages = messagesWith([
      proposePlanPart({
        output: { decision: "implement" },
        toolCallId: "call-1"
      })
    ])

    expect(
      deriveSessionPlanUpsert({
        existing: { sourceToolCallId: "call-1", status: "proposed" },
        messages,
        runId: "run-3"
      })
    ).toMatchObject({ status: "implementing" })
  })

  it("no-ops when nothing changes on the same tool call", () => {
    const messages = messagesWith([
      proposePlanPart({
        output: { decision: "implement" },
        toolCallId: "call-1"
      })
    ])

    expect(
      deriveSessionPlanUpsert({
        existing: { sourceToolCallId: "call-1", status: "implementing" },
        messages,
        runId: "run-3"
      })
    ).toBeNull()
  })

  it("supersedes fully when a different tool call proposes a new plan", () => {
    const messages = messagesWith([
      proposePlanPart({
        input: { plan: "new steps", title: "New plan" },
        toolCallId: "call-2"
      })
    ])

    expect(
      deriveSessionPlanUpsert({
        existing: { sourceToolCallId: "call-1", status: "dismissed" },
        messages,
        runId: "run-4"
      })
    ).toMatchObject({
      sourceToolCallId: "call-2",
      status: "proposed",
      title: "New plan"
    })
  })

  it("uses the last propose_plan part when several exist", () => {
    const messages = toMessages([
      { id: "u1", parts: [{ text: "plan", type: "text" }], role: "user" },
      assistantWith([
        proposePlanPart({
          input: { plan: "old", title: "Old" },
          toolCallId: "call-1"
        })
      ]),
      { id: "u2", parts: [{ text: "again", type: "text" }], role: "user" },
      assistantWith([
        proposePlanPart({
          input: { plan: "fresh", title: "Fresh" },
          toolCallId: "call-2"
        })
      ])
    ])

    expect(
      deriveSessionPlanUpsert({ existing: null, messages, runId: "run-5" })
    ).toMatchObject({ sourceToolCallId: "call-2", title: "Fresh" })
  })
})

describe("session plan persistence", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("upserts, transitions, guards, and supersedes a session plan", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })

    expect(await getSessionPlan(db, session.id)).toBeNull()

    const proposed = await upsertSessionPlanFromMessages({
      db,
      messages: messagesWith([proposePlanPart({ toolCallId: "call-1" })]),
      runId: "run-1",
      sessionId: session.id
    })

    expect(proposed).toMatchObject({
      decidedAt: null,
      sessionId: session.id,
      sourceRunId: "run-1",
      sourceToolCallId: "call-1",
      status: "proposed"
    })

    const implementing = await upsertSessionPlanFromMessages({
      db,
      messages: messagesWith([
        proposePlanPart({
          output: { decision: "implement" },
          toolCallId: "call-1"
        })
      ]),
      runId: "run-2",
      sessionId: session.id
    })

    expect(implementing?.status).toBe("implementing")
    expect(implementing?.decidedAt).not.toBeNull()

    const done = await setSessionPlanStatus({
      db,
      sessionId: session.id,
      status: "done"
    })

    expect(done?.status).toBe("done")

    // Re-persisting the same finished call must not revive it.
    const afterFinish = await upsertSessionPlanFromMessages({
      db,
      messages: messagesWith([
        proposePlanPart({
          output: { decision: "implement" },
          toolCallId: "call-1"
        })
      ]),
      runId: "run-3",
      sessionId: session.id
    })

    expect(afterFinish?.status).toBe("done")

    // A brand-new propose_plan call supersedes the finished plan.
    const superseded = await upsertSessionPlanFromMessages({
      db,
      messages: messagesWith([
        proposePlanPart({
          input: { plan: "brand new", title: "Fresh plan" },
          toolCallId: "call-2"
        })
      ]),
      runId: "run-4",
      sessionId: session.id
    })

    expect(superseded).toMatchObject({
      decidedAt: null,
      sourceToolCallId: "call-2",
      status: "proposed",
      title: "Fresh plan"
    })
  })

  it("returns null from setSessionPlanStatus when no plan exists", async () => {
    await ensureDatabaseReady()

    const db = getDb()
    const session = await createChatSession({ db })

    expect(
      await setSessionPlanStatus({
        db,
        sessionId: session.id,
        status: "dismissed"
      })
    ).toBeNull()
  })
})
