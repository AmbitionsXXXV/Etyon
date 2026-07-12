# Plan 007: Route the remaining agent-run/persistence transactions through the DB write lock

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `advisor-plans/README.md` — your reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 3c94d02..HEAD -- apps/desktop/src/main/agents/minimal/delegation.ts apps/desktop/src/main/server/routes/chat.ts apps/desktop/src/main/chat-messages.ts apps/desktop/src/main/db/write-lock.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.
>
> **Worktree base check (run second)**: `git merge-base HEAD 3c94d02` must print `3c94d02e6c87dc8f22cfd604608d193bc99ce145`. A previous executor run was silently based on `main` — if the check fails, STOP and report.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (the queue is already the serialization path for every other event-store write; adds millisecond latency)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3c94d02`, 2026-07-12

## Why this matters

The app has exactly one libsql connection. Two `db.transaction(...)` calls that interleave on the event loop race for SQLite's write lock and one throws `SQLITE_BUSY` — a busy timeout does not cover a transaction that never gets to `BEGIN`. `runExclusiveDbWrite` (the write-lock queue) exists precisely for this, and the workflow tool wraps `startAgentRun` in it with a comment naming the exact hazard. But four sibling transaction sites were left bare: the `delegate` tool's `startAgentRun`, the chat route's `startAgentRun` and `recordAgentRunOutcome`, and `replaceChatMessages`. With `maxConcurrentSubagents` defaulting to 2, a parent model that emits two `delegate` calls in one step runs two bare transactions concurrently (the AI SDK executes sibling tool calls in parallel) — the loser throws "Delegation failed" and its child run row is orphaned at status `running` until the next app restart. The chat-lifecycle sites carry the same exposure across concurrent windows, where a loss drops that turn's durable run log or its persisted chat messages.

## Current state

### The write lock — `apps/desktop/src/main/db/write-lock.ts` (whole file)

```ts
let writeQueueTail: Promise<unknown> = Promise.resolve()

const awaitSettled = async (queue: Promise<unknown>): Promise<void> => {
  try {
    await queue
  } catch (error) {
    void error
  }
}

export const runExclusiveDbWrite = async <TValue>(
  task: () => Promise<TValue>
): Promise<TValue> => {
  const previousTail = writeQueueTail
  const currentTail = Promise.withResolvers<null>()
  writeQueueTail = currentTail.promise
  await awaitSettled(previousTail)

  try {
    return await task()
  } finally {
    currentTail.resolve(null)
  }
}
```

**CRITICAL — the queue is NOT re-entrant.** A task that itself calls `runExclusiveDbWrite` sets itself as its own predecessor's successor and waits on a tail that cannot resolve until it finishes: **deadlock**. Therefore: wrap only at the sites named below, and NEVER wrap inside `startAgentRun`/`recordAgentRunOutcome` themselves (the workflow tool already wraps its own call at the call site — wrapping the function bodies would nest).

### The exemplar (already correct) — `workflow-tool.ts:126-128`

```ts
        const childRunId = await runExclusiveDbWrite(() =>
          startAgentRun({
```

(Also correct: `delegation.ts:376` and `:408` wrap the child-approval writers.)

### Bare site 1 — `apps/desktop/src/main/agents/minimal/delegation.ts:842-849`

```ts
      try {
        childRunId = await startAgentRun({
          chatSessionId,
          db,
          modelId,
          parentRunId,
          profileId: childProfile.id
        })
```

`runExclusiveDbWrite` is already imported in this file (line 42).

### Bare sites 2+3 — `apps/desktop/src/main/server/routes/chat.ts:196` and `:232`

```ts
agentRunId = await startAgentRun({
  chatSessionId: sessionId,
  db,
  modelId: effectiveModelId,
  profileId: activeProfile.id
})
```

```ts
await recordAgentRunOutcome({
  assistantStartIndex,
  db,
  messages: nextMessages,
  outcome: agentOutcome,
  runId: agentRunId
})
```

This file does NOT yet import `runExclusiveDbWrite`.

### Bare site 4 — `apps/desktop/src/main/chat-messages.ts:179` (`replaceChatMessages` body)

```ts
  await db.transaction(async (tx) => {
    await tx.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))
    ...
    await tx
      .update(chatSessions)
      .set({ title: nextTitle, updatedAt: now })
      .where(eq(chatSessions.id, sessionId))
  })
```

Its only callers are `chat.ts:136` and `chat.ts:249` — neither is inside a `runExclusiveDbWrite`, so wrapping **inside** `replaceChatMessages` (around just the `db.transaction`) is safe and covers both callers at once.

### Conventions

oxlint-enforced: arrow-function consts, sorted object keys, `@/main/...` import aliases. Tests import from `"vite-plus/test"`; main-process tests live in `apps/desktop/test/main/**` and mock Electron via `vi.mock`. Conventional commits, lowercase subject.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install deps (fresh worktree) | `vp install` | exit 0 |
| Lint + format | `vp check` | exit 0 |
| Typecheck | `vp run typecheck` | exit 0 (never bare `tsc` — a stale global 5.3.3 reports phantom errors) |
| Targeted tests | `cd apps/desktop && vp test run write-lock agent-event-store delegation chat-messages` | all pass |
| Full main tests | `cd apps/desktop && vp test run test/main` | all pass |

## Scope

**In scope** (the only files you may modify):

- `apps/desktop/src/main/agents/minimal/delegation.ts` (one call site)
- `apps/desktop/src/main/server/routes/chat.ts` (two call sites + one import)
- `apps/desktop/src/main/chat-messages.ts` (one transaction + one import)
- `apps/desktop/test/main/db/write-lock.test.ts` (create)
- `apps/desktop/test/main/agents/agent-event-store.test.ts` (add one test)

**Out of scope** (do NOT touch):

- `apps/desktop/src/main/db/write-lock.ts` itself — no behavior change, no re-entrancy "fix"; the non-reentrant design is intentional and documented.
- `agent-event-store.ts` function bodies (`startAgentRun`, `recordAgentRunOutcome`) — wrapping inside them would deadlock the already- wrapped workflow call site.
- `workflow-tool.ts`, `child-approval.ts` — already correct.
- Any other `db.transaction` site not listed above (e.g. memory.ts's `deleteMemoryEntry` is already wrapped).

## Git workflow

- Branch: `advisor/007-serialize-run-transactions` cut from `3c94d02`.
- Conventional commits, lowercase subject, e.g. `fix: serialize agent-run and chat persistence transactions through the write lock`.
- Do NOT push.

## Steps

### Step 1: Wrap the delegate tool's `startAgentRun`

In `delegation.ts` (~line 843), change:

```ts
        childRunId = await startAgentRun({
          ...
        })
```

to:

```ts
        childRunId = await runExclusiveDbWrite(() =>
          startAgentRun({
            ...
          })
        )
```

(arguments unchanged; import already present).

**Verify**: `vp check apps/desktop/src/main/agents/minimal/delegation.ts` → pass.

### Step 2: Wrap the chat route's two lifecycle writes

In `chat.ts`: add `import { runExclusiveDbWrite } from "@/main/db/write-lock"` (alphabetical import position), then wrap the `startAgentRun` call (~line 196) and the `recordAgentRunOutcome` call (~line 232) in `runExclusiveDbWrite(() => ...)` exactly as in step 1. Keep the surrounding `try/catch` blocks where they are — the wrapper goes inside the `try`.

**Verify**: `vp check apps/desktop/src/main/server/routes/chat.ts` → pass, and `grep -c "runExclusiveDbWrite" apps/desktop/src/main/server/routes/chat.ts` → `3` (1 import + 2 call sites).

### Step 3: Wrap the transaction inside `replaceChatMessages`

In `chat-messages.ts`: add the same import, then wrap ONLY the `await db.transaction(async (tx) => { ... })` statement:

```ts
  await runExclusiveDbWrite(() =>
    db.transaction(async (tx) => {
      ...
    })
  )
```

The pre-transaction work (`compactChatMessages`, `normalizeMessageIds`, title derivation) stays OUTSIDE the wrapper — only the transaction needs serializing, and keeping model-independent work outside minimizes queue hold time.

**Verify**: `vp check apps/desktop/src/main/chat-messages.ts` → pass.

### Step 4: Prove no nesting was introduced

Run: `grep -rn "await startAgentRun\|await recordAgentRunOutcome\|replaceChatMessages(" apps/desktop/src/main --include="*.ts"`

For every hit, open the surrounding ~10 lines and confirm the call is not lexically inside another `runExclusiveDbWrite(() => ...)` callback. Expected result: the only wrapped `startAgentRun` call sites are `workflow-tool.ts` (pre-existing), `delegation.ts` (step 1), `chat.ts` (step 2); `replaceChatMessages` callers (`chat.ts:136`, `chat.ts:249`) are NOT inside a wrapper. Record the hit list in your report.

**Verify**: the grep output matches the expectation above.

### Step 5: Unit-test the write lock's serialization

Create `apps/desktop/test/main/db/write-lock.test.ts` (model after the flat style of `apps/desktop/test/main/db/index.test.ts`):

- Test 1 "serializes overlapping tasks": start task A that awaits a manually resolved promise before finishing, start task B immediately after; push entries into a shared `order: string[]` at task start/end; resolve A; await both; assert order is `["a:start", "a:end", "b:start", "b:end"]`.
- Test 2 "releases the queue after a rejected task": task A rejects; task B after it still runs and resolves. Assert B's result and that A's rejection propagates to A's caller.

Do NOT write a nesting test — nesting deadlocks by design and would hang the suite.

**Verify**: `cd apps/desktop && vp test run write-lock` → 2 tests pass.

### Step 6: Concurrency regression test for `startAgentRun`

In `apps/desktop/test/main/agents/agent-event-store.test.ts`, using the file's existing in-memory/temp DB harness, add one test: fire two `runExclusiveDbWrite(() => startAgentRun({...}))` calls with `Promise.all` (distinct sessions or same session — match whatever the harness sets up), and assert both resolve to distinct run ids and both rows exist with status `running`. This is the exact double-delegate shape that used to race.

**Verify**: `cd apps/desktop && vp test run agent-event-store` → all pass including the new test.

## Test plan

Covered by steps 5–6. Patterns: `test/main/db/index.test.ts` (db test setup), existing `agent-event-store.test.ts` harness (its own file shows how a test DB is created).

## Done criteria

ALL must hold (repo root):

- [ ] `grep -c "runExclusiveDbWrite" apps/desktop/src/main/agents/minimal/delegation.ts` ≥ 4 (import + 2 approval writers + step 1)
- [ ] `grep -c "runExclusiveDbWrite" apps/desktop/src/main/server/routes/chat.ts` = 3
- [ ] `grep -c "runExclusiveDbWrite" apps/desktop/src/main/chat-messages.ts` = 2 (import + wrap)
- [ ] Step 4's no-nesting audit recorded in the report
- [ ] `cd apps/desktop && vp test run test/main` → all pass (incl. new write-lock + event-store tests)
- [ ] `vp check` → exit 0; `vp run typecheck` → exit 0
- [ ] `git status --short` shows only in-scope files

## STOP conditions

Stop and report back if:

- The worktree base check or drift check fails.
- Any test (new or existing) hangs > 60s — that is the deadlock signature of accidental nesting; report which step introduced it, do not add timeouts to paper over it.
- Step 4 finds a caller of `replaceChatMessages` / `startAgentRun` / `recordAgentRunOutcome` already inside a `runExclusiveDbWrite` other than the three named exemplar sites.
- `chat.ts` line numbers are off by more than ~15 lines from the excerpts (structure drifted).

## Maintenance notes

- Any NEW `db.transaction` call site in main-process code must be wrapped at its call site in `runExclusiveDbWrite` — never inside a function that a wrapped caller might invoke. Reviewers should grep for bare `db.transaction` in future PRs.
- If libsql ever moves to a per-request connection pool, the write lock can be retired wholesale — delete `write-lock.ts` and unwrap all sites in one PR.
- Deliberately NOT unified: `recordAgentRunStep` (single insert, no transaction) stays bare.
