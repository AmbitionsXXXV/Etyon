import fs from "node:fs"

import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildRunProjection,
  deriveAgentRunRecords,
  expireStaleApprovals,
  getRunAssistantStartIndex,
  recordAgentRunOutcome,
  recordAgentRunStep,
  recoverInterruptedAgentRuns,
  redactSecretsFromJson,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { createChatSession } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import {
  agentApprovals,
  agentArtifacts,
  agentRuns,
  agentToolCalls
} from "@/main/db/schema"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-event-store-test-${Date.now()}-${Math.random()
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

const userMessage = (text: string): unknown => ({
  id: `user-${Math.random().toString(36).slice(2)}`,
  parts: [{ text, type: "text" }],
  role: "user"
})

const assistantMessage = (parts: unknown[]): unknown => ({
  id: `assistant-${Math.random().toString(36).slice(2)}`,
  parts,
  role: "assistant"
})

const toMessages = (messages: unknown[]): UIMessage[] =>
  messages as unknown as UIMessage[]

const profileId = "file-agent"

describe("agent event store", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("derives a succeeded run from a finished tool call", () => {
    const messages = toMessages([
      userMessage("edit the file"),
      assistantMessage([
        { text: "done", type: "text" },
        {
          input: { path: "a.ts" },
          output: { ok: true },
          state: "output-available",
          toolCallId: "tc1",
          type: "tool-edit"
        }
      ])
    ])

    const derived = deriveAgentRunRecords({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      messages
    })

    expect(derived.runStatus).toBe("succeeded")
    expect(derived.toolCalls).toHaveLength(1)
    expect(derived.toolCalls[0]?.state).toBe("finished")
    expect(derived.toolCalls[0]?.toolName).toBe("edit")
    expect(derived.approvedToolCallIds).toEqual(["tc1"])
  })

  it("derives artifacts from finished artifact tool calls only", () => {
    const messages = toMessages([
      userMessage("make a report"),
      assistantMessage([
        {
          input: { path: "artifacts/report.html", title: "Report" },
          output: {
            byteLength: 64,
            kind: "html",
            path: "artifacts/report.html",
            title: "Report"
          },
          state: "output-available",
          toolCallId: "tc-artifact",
          type: "tool-artifact"
        },
        {
          input: { path: "artifacts/pending.html", title: "Pending" },
          state: "input-available",
          toolCallId: "tc-artifact-pending",
          type: "tool-artifact"
        }
      ])
    ])

    const derived = deriveAgentRunRecords({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      messages
    })

    expect(derived.artifacts).toHaveLength(1)
    expect(derived.artifacts[0]).toMatchObject({
      byteLength: 64,
      kind: "html",
      path: "artifacts/report.html",
      toolCallId: "tc-artifact"
    })
    expect(JSON.parse(derived.artifacts[0]?.metadataJson ?? "{}")).toEqual({
      description: null,
      title: "Report"
    })
  })

  it("does not record imagen output as an artifact (images render inline)", () => {
    const messages = toMessages([
      userMessage("draw a shiba"),
      assistantMessage([
        {
          input: { prompt: "a neon shiba", title: "Shiba" },
          output: {
            byteLength: 2048,
            kind: "image",
            path: "generated-images/shiba-1a2b3c4d.png",
            title: "Shiba"
          },
          state: "output-available",
          toolCallId: "tc-imagen",
          type: "tool-imagen"
        }
      ])
    ])

    const derived = deriveAgentRunRecords({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      messages
    })

    expect(derived.artifacts).toHaveLength(0)
  })

  it("persists artifacts and an artifact.published event", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("publish"),
      assistantMessage([
        {
          input: { path: "artifacts/report.html", title: "Report" },
          output: {
            byteLength: 64,
            kind: "html",
            path: "artifacts/report.html",
            title: "Report"
          },
          state: "output-available",
          toolCallId: "tc-artifact-db",
          type: "tool-artifact"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const artifacts = await db
      .select()
      .from(agentArtifacts)
      .where(eq(agentArtifacts.runId, runId))
    const projection = await buildRunProjection({ db, runId })

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.id).toBe(`${runId}:tc-artifact-db`)
    expect(artifacts[0]?.kind).toBe("html")
    expect(artifacts[0]?.path).toBe("artifacts/report.html")
    expect(projection?.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.result",
      "artifact.published",
      "run.succeeded"
    ])
  })

  it("derives a suspended run with a pending approval", () => {
    const messages = toMessages([
      userMessage("write a file"),
      assistantMessage([
        {
          approval: { id: "ap1" },
          input: { path: "b.ts" },
          state: "approval-requested",
          toolCallId: "tc2",
          type: "tool-write"
        }
      ])
    ])

    const derived = deriveAgentRunRecords({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      messages
    })

    expect(derived.runStatus).toBe("suspended")
    expect(derived.pendingApprovals).toEqual([
      { approvalId: "ap1", toolCallId: "tc2" }
    ])
  })

  it("records and projects a run from the event log", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("edit"),
      assistantMessage([
        {
          input: {},
          output: {},
          state: "output-available",
          toolCallId: "tc1",
          type: "tool-edit"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
    const projection = await buildRunProjection({ db, runId })

    expect(run?.status).toBe("succeeded")
    expect(projection?.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.result",
      "run.succeeded"
    ])
  })

  it("persists a pending approval for a suspended run", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-suspend" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-suspend",
          type: "tool-write"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
    const approvals = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.runId, runId))

    expect(run?.status).toBe("suspended")
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.state).toBe("pending")
  })

  it("resolves a prior pending approval when the tool later completes", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })

    const suspendRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const suspendMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "apX" },
          input: {},
          state: "approval-requested",
          toolCallId: "tcX",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(suspendMessages),
      db,
      messages: suspendMessages,
      runId: suspendRunId
    })

    const resumeRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const resumeMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          input: {},
          output: { ok: true },
          state: "output-available",
          toolCallId: "tcX",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(resumeMessages),
      db,
      messages: resumeMessages,
      runId: resumeRunId
    })

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.toolCallId, "tcX"))

    expect(approval?.state).toBe("approved")
    expect(approval?.respondedAt).toBeTruthy()
  })

  it("supersedes a prior suspended run when a later run in the session settles", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const otherSession = await createChatSession({ db })

    const suspendedRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const suspendedMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-superseded" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-superseded",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(suspendedMessages),
      db,
      messages: suspendedMessages,
      runId: suspendedRunId
    })

    // A suspended run in a different session must stay open.
    const otherRunId = await startAgentRun({
      chatSessionId: otherSession.id,
      db,
      modelId: null,
      profileId
    })
    const otherMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-other" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-other",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(otherMessages),
      db,
      messages: otherMessages,
      runId: otherRunId
    })

    const settledRunId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const settledMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          input: {},
          output: { ok: true },
          state: "output-available",
          toolCallId: "tc-settled",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(settledMessages),
      db,
      messages: settledMessages,
      runId: settledRunId
    })

    const [suspendedRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, suspendedRunId))
    const [settledRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, settledRunId))
    const [otherRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, otherRunId))
    const projection = await buildRunProjection({ db, runId: suspendedRunId })

    expect(suspendedRun?.status).toBe("superseded")
    expect(suspendedRun?.finishedAt).toBeTruthy()
    expect(settledRun?.status).toBe("succeeded")
    expect(otherRun?.status).toBe("suspended")
    expect(projection?.events.at(-1)?.type).toBe("run.superseded")
  })

  it("recovers interrupted runs on startup", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })

    const recovered = await recoverInterruptedAgentRuns({ db })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))

    expect(recovered).toBeGreaterThanOrEqual(1)
    expect(run?.status).toBe("failed")
    expect(run?.errorMessage).toBe("Interrupted by app restart")
  })

  it("expires stale pending approvals and fails their suspended runs", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-stale" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-stale",
          type: "tool-write"
        }
      ])
    ])
    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const expired = await expireStaleApprovals({
      db,
      now: new Date(Date.now() + 60_000).toISOString(),
      ttlMs: 0
    })

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.runId, runId))
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))

    expect(expired).toBeGreaterThanOrEqual(1)
    expect(approval?.state).toBe("denied")
    expect(run?.status).toBe("failed")
  })

  it("settles a model-error outcome as a failed run with finish_reason", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("hello"),
      assistantMessage([{ state: "done", text: "partial", type: "text" }])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      outcome: {
        errorMessage: "boom: provider down",
        exitReason: "model-error",
        finishReason: "error",
        nudged: false,
        stepCount: 1
      },
      runId
    })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
    const projection = await buildRunProjection({ db, runId })

    expect(run?.status).toBe("failed")
    expect(run?.finishReason).toBe("error")
    expect(run?.errorMessage).toBe("boom: provider down")
    expect(projection?.events.at(-1)?.type).toBe("run.failed")
  })

  it("records a max-steps outcome as a visible truncation", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })

    await recordAgentRunStep({
      db,
      runId,
      step: { finishReason: "tool-calls", stepIndex: 1, toolCallCount: 1 }
    })

    const messages = toMessages([
      userMessage("loop"),
      assistantMessage([
        {
          input: {},
          output: {},
          state: "output-available",
          toolCallId: "tc-limit",
          type: "tool-ls"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      outcome: {
        errorMessage: null,
        exitReason: "max-steps",
        finishReason: "tool-calls",
        nudged: false,
        stepCount: 1
      },
      runId
    })

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
    const projection = await buildRunProjection({ db, runId })

    expect(run?.status).toBe("succeeded")
    expect(run?.finishReason).toBe("max-steps")
    expect(projection?.events.map((event) => event.type)).toEqual([
      "run.started",
      "step.finished",
      "tool.result",
      "run.truncated",
      "run.succeeded"
    ])
  })

  it("finalizes unsettled tool calls when the run closes", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const messages = toMessages([
      userMessage("imagen"),
      assistantMessage([
        {
          input: { prompt: "a cat" },
          state: "input-available",
          toolCallId: "tc-stuck",
          type: "tool-imagen"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      outcome: {
        errorMessage: null,
        exitReason: "completed",
        finishReason: "stop",
        nudged: false,
        stepCount: 1
      },
      runId
    })

    const [toolCall] = await db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.runId, runId))

    expect(toolCall?.state).toBe("failed")
    expect(toolCall?.finishedAt).not.toBeNull()
  })

  it("advances an approval-requested tool row when the run resumes", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })
    const suspendedMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-resume" },
          input: {},
          state: "approval-requested",
          toolCallId: "tc-resume",
          type: "tool-write"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(suspendedMessages),
      db,
      messages: suspendedMessages,
      runId
    })

    const resumedMessages = toMessages([
      userMessage("write"),
      assistantMessage([
        {
          approval: { id: "ap-resume" },
          input: {},
          output: { bytesWritten: 3 },
          state: "output-available",
          toolCallId: "tc-resume",
          type: "tool-write"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(resumedMessages),
      db,
      messages: resumedMessages,
      outcome: {
        errorMessage: null,
        exitReason: "completed",
        finishReason: "stop",
        nudged: false,
        stepCount: 1
      },
      runId
    })

    const [toolCall] = await db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.runId, runId))
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))

    expect(toolCall?.state).toBe("finished")
    expect(toolCall?.approvalState).toBe("not_required")
    expect(run?.status).toBe("succeeded")
  })

  describe("redactSecretsFromJson", () => {
    it("redacts an OpenAI-style sk- key", () => {
      const json = JSON.stringify({ key: "sk-abcdefghijklmnopqrstuvwx" })
      const result = redactSecretsFromJson(json)
      expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwx")
      expect(result).toContain("[REDACTED]")
    })

    it("keeps the Bearer prefix and redacts only the token", () => {
      const json = JSON.stringify({ header: "Bearer eyABCDEFGHIJKLMN" })
      const result = redactSecretsFromJson(json)
      expect(result).toContain("Bearer [REDACTED]")
      expect(result).not.toContain("eyABCDEFGHIJKLMN")
    })

    it("redacts a JWT", () => {
      const token =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      const json = JSON.stringify({ token })
      const result = redactSecretsFromJson(json)
      expect(result).not.toContain(token)
      expect(result).toContain("[REDACTED]")
    })

    it("keeps the apiKey name and redacts the value in a JSON fragment", () => {
      const json = JSON.stringify({ apiKey: "supersecretvalue123" })
      const result = redactSecretsFromJson(json)
      expect(result).toContain("apiKey")
      expect(result).not.toContain("supersecretvalue123")
      expect(result).toContain("[REDACTED]")
    })

    it("does not alter a benign id/status payload", () => {
      const json = JSON.stringify({ status: "succeeded", toolCallId: "tc-1" })
      const result = redactSecretsFromJson(json)
      expect(result).toBe(json)
    })

    it("returns valid JSON after redacting structured inputs", () => {
      const json = JSON.stringify({
        key: "sk-abcdefghijklmnopqrstuvwx",
        status: "done"
      })
      const result = redactSecretsFromJson(json)
      expect(() => JSON.parse(result)).not.toThrow()
    })
  })

  it("redacts a secret embedded in tool output before persisting to agent_tool_calls", async () => {
    await ensureDatabaseReady()
    const db = getDb()
    const session = await createChatSession({ db })
    const runId = await startAgentRun({
      chatSessionId: session.id,
      db,
      modelId: null,
      profileId
    })

    const secretToken = "sk-testredactionsecret1234567890ab"
    const messages = toMessages([
      userMessage("read config"),
      assistantMessage([
        {
          input: { path: "config.yaml" },
          output: `apiKey: ${secretToken}`,
          state: "output-available",
          toolCallId: "tc-redact",
          type: "tool-read"
        }
      ])
    ])

    await recordAgentRunOutcome({
      assistantStartIndex: getRunAssistantStartIndex(messages),
      db,
      messages,
      runId
    })

    const [toolCallRow] = await db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.runId, runId))

    expect(toolCallRow?.outputJson).not.toContain(secretToken)
    expect(toolCallRow?.outputJson).toContain("[REDACTED]")
  })
})
