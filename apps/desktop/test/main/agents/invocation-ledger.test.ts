import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/libsql/migrator"
import { drizzle } from "drizzle-orm/libsql/node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { HookBlockedError } from "@/main/agents/hooks/runner"
import {
  InvocationOutcomeUnknownError,
  listInvocations,
  recoverInterruptedInvocations,
  runPersistedInvocation
} from "@/main/agents/invocation-ledger"
import type { AppDatabase } from "@/main/db"
import { agentInvocations, chatSessions, schema } from "@/main/db/schema"

vi.mock("@/main/db", () => ({ getDb: vi.fn() }))

let client: Client
let db: AppDatabase
const scope = {
  input: { path: "file.txt" },
  sessionId: "session-1",
  toolCallId: "call-1",
  toolName: "write"
}

const invocationRow = (
  id: string,
  state: "succeeded" | "unknown",
  createdAt: string
): typeof agentInvocations.$inferInsert => ({
  createdAt,
  error: state === "unknown" ? "Outcome was not recorded" : null,
  id,
  inputHash: id,
  outputJson: null,
  runId: null,
  sessionId: scope.sessionId,
  state,
  summaryJson: "{}",
  toolCallId: id,
  toolName: scope.toolName,
  updatedAt: createdAt
})

beforeEach(async () => {
  client = createClient({ url: "file::memory:" })
  db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../../drizzle", import.meta.url)
    )
  })
  const now = new Date().toISOString()
  await db.insert(chatSessions).values({
    archivedAt: null,
    createdAt: now,
    id: scope.sessionId,
    lastOpenedAt: now,
    modelId: null,
    pinnedAt: null,
    projectPath: "/project",
    title: "",
    updatedAt: now
  })
})
afterEach(() => {
  client.close()
})

describe("persistent invocation boundaries", () => {
  it("keeps an old unknown outcome visible after 100 newer completed calls", async () => {
    await db
      .insert(agentInvocations)
      .values([
        invocationRow("old-unknown", "unknown", "2026-01-01T00:00:00.000Z"),
        ...Array.from({ length: 101 }, (_, index) =>
          invocationRow(
            `completed-${index}`,
            "succeeded",
            "2026-01-02T00:00:00.000Z"
          )
        )
      ])

    expect(await listInvocations(db, scope.sessionId)).toEqual([
      expect.objectContaining({ id: "old-unknown", state: "unknown" })
    ])
  })

  it("bounds the unresolved query to the newest 100 unknown calls", async () => {
    await db
      .insert(agentInvocations)
      .values(
        Array.from({ length: 101 }, (_, index) =>
          invocationRow(
            `unknown-${index}`,
            "unknown",
            new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
          )
        )
      )

    const rows = await listInvocations(db, scope.sessionId)
    expect(rows).toHaveLength(100)
    expect(rows[0]?.id).toBe("unknown-100")
    expect(rows.at(-1)?.id).toBe("unknown-1")
  })

  it("returns the durable result without executing a duplicate request", async () => {
    const execute = vi.fn(() =>
      Promise.resolve({ path: "file.txt", saved: true })
    )
    expect(await runPersistedInvocation({ ...scope, db, execute })).toEqual({
      path: "file.txt",
      saved: true
    })
    expect(await runPersistedInvocation({ ...scope, db, execute })).toEqual({
      path: "file.txt",
      saved: true
    })
    expect(execute).toHaveBeenCalledTimes(1)
    const [row] = await db.select().from(agentInvocations)
    expect(row?.state).toBe("succeeded")
  })
  it("does not begin a side effect when the ledger cannot be read", async () => {
    const faulty = new Proxy(db, {
      get: (target, key) =>
        key === "select"
          ? () => {
              throw new Error("Database unavailable")
            }
          : Reflect.get(target, key)
    })
    const execute = vi.fn(() => Promise.resolve("saved"))
    await expect(
      runPersistedInvocation({ ...scope, db: faulty, execute })
    ).rejects.toThrow("Database unavailable")
    expect(execute).not.toHaveBeenCalled()
  })
  it("recovers interrupted calls as unknown and refuses automatic replay", async () => {
    const now = new Date().toISOString()
    await db.insert(agentInvocations).values({
      createdAt: now,
      error: null,
      id: createHash("sha256")
        .update(`${scope.sessionId}\u0000${scope.toolCallId}`)
        .digest("hex"),
      inputHash: createHash("sha256")
        .update(JSON.stringify(scope.input))
        .digest("hex"),
      outputJson: null,
      runId: null,
      sessionId: scope.sessionId,
      state: "executing",
      summaryJson: "{}",
      toolCallId: scope.toolCallId,
      toolName: scope.toolName,
      updatedAt: now
    })
    await recoverInterruptedInvocations(db)
    const execute = vi.fn(() => Promise.resolve("saved"))
    await expect(
      runPersistedInvocation({ ...scope, db, execute })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    expect(execute).not.toHaveBeenCalled()
  })
  it("keeps a barrier when a side effect completes but result persistence fails", async () => {
    const faulty = new Proxy(db, {
      get: (target, key) =>
        key === "update"
          ? () => {
              throw new Error("Disk full")
            }
          : Reflect.get(target, key)
    })
    const execute = vi.fn(() => Promise.resolve("saved"))
    await expect(
      runPersistedInvocation({ ...scope, db: faulty, execute })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    await expect(
      runPersistedInvocation({ ...scope, db, execute })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it("marks failures after entering a side effect as unknown", async () => {
    await expect(
      runPersistedInvocation({
        ...scope,
        db,
        execute: () => Promise.reject(new Error("Connection stopped"))
      })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    const [row] = await db.select().from(agentInvocations)
    expect(row?.state).toBe("unknown")
  })
  it("retains the policy block reason without pretending the target tool executed", async () => {
    await expect(
      runPersistedInvocation({
        ...scope,
        db,
        execute: () =>
          Promise.reject(
            new HookBlockedError("Run the required validation before editing")
          )
      })
    ).rejects.toThrow("required validation")
    const [row] = await db.select().from(agentInvocations)
    expect(row?.state).toBe("failed")
    const execute = vi.fn(() => Promise.resolve("saved"))
    await expect(
      runPersistedInvocation({ ...scope, db, execute })
    ).rejects.toThrow("required validation")
    expect(execute).not.toHaveBeenCalled()
  })
  it("blocks an unresolved operation even when a retry has a new call id", async () => {
    await expect(
      runPersistedInvocation({
        ...scope,
        db,
        execute: () => Promise.reject(new Error("Connection stopped"))
      })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    const retry = vi.fn(() => Promise.resolve("saved"))
    await expect(
      runPersistedInvocation({
        ...scope,
        db,
        execute: retry,
        toolCallId: "new-call-id"
      })
    ).rejects.toBeInstanceOf(InvocationOutcomeUnknownError)
    expect(retry).not.toHaveBeenCalled()
  })
  it("keeps identical model call ids independent in isolated workspaces", async () => {
    const execute = vi.fn(() => Promise.resolve("saved"))
    await runPersistedInvocation({
      ...scope,
      db,
      effectScope: "/candidate-a",
      execute
    })
    await runPersistedInvocation({
      ...scope,
      db,
      effectScope: "/candidate-b",
      execute
    })
    await runPersistedInvocation({
      ...scope,
      db,
      effectScope: "/candidate-a",
      execute
    })
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it("stores redacted output and rejects id reuse with a different input", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789"
    await runPersistedInvocation({
      ...scope,
      db,
      execute: () => Promise.resolve({ token: secret })
    })
    const [row] = await db
      .select()
      .from(agentInvocations)
      .where(eq(agentInvocations.toolCallId, scope.toolCallId))
    expect(row?.outputJson).not.toContain(secret)
    const execute = vi.fn(() => Promise.resolve("saved"))
    await expect(
      runPersistedInvocation({
        ...scope,
        db,
        execute,
        input: { path: "other.txt" }
      })
    ).rejects.toThrow("different input")
    expect(execute).not.toHaveBeenCalled()
  })
})
