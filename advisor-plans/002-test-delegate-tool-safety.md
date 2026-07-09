# Plan 002: Add safety tests for the `delegate` tool's execute path

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b88add7..HEAD -- apps/desktop/src/main/agents/minimal/delegation.ts apps/desktop/test/main/agents/delegation.test.ts` If either file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (tests only — no production code changes)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `b88add7`, 2026-06-14

## Why this matters

`delegate` is the agent runtime's newest and most safety-relevant surface: a write-capable parent agent hands a task to a headless read-only child agent. Three properties keep it safe — a per-parent **concurrency limit** (`maxConcurrentSubagents`), **bounded child output** (grep capped at 100 hits, every tool output clamped to 12,000 chars, the summary to 8,000), and a **failure path** that records the child run as failed, releases the concurrency slot, and surfaces the error. The existing `delegation.test.ts` covers only the pure helpers (`resolveDelegateTarget`, the read-only child tool set) and run persistence. The execute path that enforces those three properties has **zero** coverage, so a regression (e.g. the clamp dropped, the slot leaked, the limit bypassed) would ship silently. This plan adds characterization tests that pin the current safe behavior.

## Current state

- `apps/desktop/src/main/agents/minimal/delegation.ts` — the delegation tool. Relevant, currently-untested logic:

  Bounds (lines 30–38):

  ```ts
  const CHILD_MAX_STEPS = 12
  const CHILD_GREP_LIMIT = 100
  const TOOL_OUTPUT_MAX_CHARS = 12_000
  const SUMMARY_MAX_CHARS = 8000

  const clampText = (text: string, max: number): string =>
    text.length <= max
      ? text
      : `${text.slice(0, max)}\n[... truncated at ${max} characters]`
  ```

  The exported, **directly testable** child tool factory (lines 95–178) — each tool clamps output, and `read` records the file into `filesRead`:

  ```ts
  export const buildChildTools = (
    workspace: WorkspaceCore,
    filesRead: Set<string>,
    toolCalls: DelegatedToolCallRecord[]
  ) => ({
    grep: tool({
      /* ... clampText(result.value, TOOL_OUTPUT_MAX_CHARS) ... */
    }),
    ls: tool({
      /* ... */
    }),
    read: tool({
      /* ... filesRead.add(result.value.info.path) ... */
    })
  })
  ```

  Each child tool's `execute(input, { toolCallId })` returns a string and pushes a record onto `toolCalls`. `read` calls `workspace.view(path)` and, on success, adds the resolved path to `filesRead`.

  The concurrency semaphore (lines 43–62) is **module-private**:

  ```ts
  const activeChildCounts = new Map<string, number>()
  const tryAcquireChildSlot = (parentRunId, limit) => {
    /* ... */
  }
  const releaseChildSlot = (parentRunId) => {
    /* ... */
  }
  ```

  It is only observable through `buildDelegateTool(...).execute`, which throws `Concurrent sub-agent limit (N) reached.` when the limit is hit (lines 246–250), and always releases the slot in a `finally` (line 301). On child failure it records the run failed and rethrows `Delegation failed: ...` (lines 284–299).

- `apps/desktop/src/main/agents/minimal/workspace-core.ts` — `getWorkspaceCore(projectPath)` returns a real filesystem-backed workspace; `view`/`searchContent`/`listDir` return a `WorkspaceResult`. Use a real temp-dir workspace for the child-tool tests (no mocking needed).

- `buildDelegateTool` (lines 228–323) returns a **Mastra `createTool`** object; `apps/desktop/src/main/agents/minimal/file-agent.ts:124-133` registers it as `delegate` and Mastra invokes its `.execute(inputData, context)`. The tests drive `.execute(...)` the same way.

- Existing tests and exemplars:
  - `apps/desktop/test/main/agents/delegation.test.ts` — current delegation tests; reuse its electron mock + `vi.hoisted` block.
  - `apps/desktop/test/main/agents/workspace-core.test.ts:1-36` — temp-dir workspace + `afterAll` cleanup pattern (for the child-tool tests).
  - `apps/desktop/test/main/server/app.test.ts:104-257` — the canonical recipe for partial-mocking the `ai` module and mocking `resolveModel` / `getSettings` (for the execute-path tests):
    ```ts
    vi.mock("ai", async (importOriginal) => {
      const actual = await importOriginal<typeof Ai>()
      return { ...actual, streamText: streamTextMock /* etc. */ }
    })
    vi.mock("@/main/server/lib/providers", () => ({
      resolveModel: resolveModelMock
    }))
    vi.mock("@/main/settings", () => ({ getSettings: getSettingsMock }))
    ```

- Conventions: tests import from `vite-plus/test`; `const` arrow functions; sorted object keys; assert on the `WorkspaceResult` discriminated union via `result.ok`. Run tests from `apps/desktop/`.

## Commands you will need

Run from `apps/desktop/`.

| Purpose | Command | Expected |
| --- | --- | --- |
| Run child-tool test | `vp test run test/main/agents/delegation.test.ts` | all pass |
| Run execute test | `vp test run test/main/agents/delegate-tool.test.ts` | all pass |
| Run all agent tests | `vp test run test/main/agents` | all pass |
| Typecheck | `tsc --noEmit` | exit 0 |
| Lint/format | `vp check` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):

- `apps/desktop/test/main/agents/delegation.test.ts` (extend — add the child-tool clamp/isolation tests)
- `apps/desktop/test/main/agents/delegate-tool.test.ts` (create — the execute-path concurrency/failure tests, isolated so its `ai`/`settings` mocks don't affect the pure-helper tests)

**Out of scope** (do NOT modify):

- `apps/desktop/src/main/agents/minimal/delegation.ts` and any other source. This plan adds tests for existing behavior; it must not change behavior. If a test reveals a real bug, STOP and report it rather than "fixing" source here.

## Git workflow

- Branch: `advisor/002-delegate-safety-tests`.
- Conventional commit, lowercase subject, e.g. `test: cover delegate concurrency limit, output clamps, and failure path`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1 (Tier A — no model mocking): child-tool output clamps and read tracking

Extend `apps/desktop/test/main/agents/delegation.test.ts`. Build a real temp-dir workspace (copy the setup from `workspace-core.test.ts:12-36`), including a file whose content exceeds `TOOL_OUTPUT_MAX_CHARS` (write e.g. 20,000 characters). Then call the child tools returned by `buildChildTools` and assert the bounds:

- `read` on the large file returns output containing the marker `[... truncated at 12000 characters]` and length `<= ~12,100` chars, and the read file path is added to the `filesRead` set, and a record is pushed to the `toolCalls` array with `toolName: "read"`.
- `grep` over many matches returns clamped output (assert the truncation marker appears when the raw result would exceed 12,000 chars), and pushes a `grep` record. (If `rg`/ripgrep is unavailable in the test environment the grep tool returns an `error:`-prefixed string — if so, assert the read/ls clamp cases and note grep was skipped; do NOT fail the suite on a missing `rg` binary.)
- `ls` returns a tab-separated listing and pushes an `ls` record.

Each child tool is invoked as `tools.read.execute({ path }, { toolCallId: "tc-x" })`. Use the real workspace from `getWorkspaceCore(tempProjectPath)`.

**Verify**: `vp test run test/main/agents/delegation.test.ts` → all pass (existing 6 + the new cases).

### Step 2 (Tier B — model-mocked): concurrency limit and failure path

Create `apps/desktop/test/main/agents/delegate-tool.test.ts`. This file owns the model/settings mocks (kept separate from Step 1 so they can't perturb the pure-helper tests). Set up, mirroring `app.test.ts:104-257` and `delegation.test.ts:24-48`:

1. `vi.hoisted` block creating: `mockedHomeDir`, `generateTextMock`, `resolveModelMock` (`vi.fn(() => ({}))`), `getSettingsMock`.
2. `vi.mock("electron", ...)` and `vi.mock("@electron-toolkit/utils", ...)` — copy verbatim from `delegation.test.ts:33-48`.
3. Partial-mock `ai`, overriding only `generateText`:
   ```ts
   vi.mock("ai", async (importOriginal) => {
     const actual = await importOriginal<typeof import("ai")>()
     return { ...actual, generateText: generateTextMock }
   })
   ```
4. `vi.mock("@/main/server/lib/providers", () => ({ resolveModel: resolveModelMock }))`.
5. `vi.mock("@/main/settings", () => ({ getSettings: getSettingsMock }))`, where `getSettingsMock` returns an object whose `.agents` is `AgentSettingsSchema.parse({ allowSubagentDelegation: true })` with `maxConcurrentSubagents: 1` (parse, then override the field). Import `AgentSettingsSchema` from `@etyon/rpc` (as `delegation.test.ts:3` does).

**Concurrency-limit test** (`maxConcurrentSubagents: 1`):

- Make `generateTextMock` return a controllable pending promise (a deferred):
  ```ts
  let releaseChild: (value: { text: string }) => void = () => {}
  generateTextMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseChild = resolve
      })
  )
  ```
- Build a parent profile that allows delegating to `explore` (reuse the `fakeParent` helper shape from `delegation.test.ts:52-66`) and a `DelegateToolContext` with a real persisted `parentRunId` (call `ensureDatabaseReady` + `createChatSession` + `startAgentRun`, as `delegation.test.ts:117-134` does).
- Call `const delegate = buildDelegateTool(ctx)`. Invoke `delegate.execute({ profileId: "explore", task: "t" }, {})` once **without awaiting** (it will hang on the deferred, holding the only slot).
- Immediately invoke `delegate.execute({ profileId: "explore", task: "t2" }, {})` and assert it rejects with a message matching `/Concurrent sub-agent limit/u`.
- Then call `releaseChild({ text: "done" })`, await the first call, and assert it resolves with `{ childRunId, filesRead, summary }`.
- Finally assert a **third** sequential `delegate.execute(...)` (after the first resolved and released its slot) is accepted (the deferred for it can resolve immediately) — proving the slot was released.

**Failure-path test**:

- `generateTextMock.mockRejectedValueOnce(new Error("boom"))`.
- Assert `delegate.execute({ profileId: "explore", task: "t" }, {})` rejects with `/Delegation failed: boom/u`.
- Assert the child run row for the returned/started child run id ends with `status: "failed"` in `agent_runs` (query via `getDb()` like `delegation.test.ts:150-158`). Because `childRunId` is internal to `execute`, assert instead that a `failed` child run linked to `parentRunId` exists: `select ... from agentRuns where parentRunId = ctx.parentRunId and status = "failed"`.
- Assert a subsequent `delegate.execute(...)` is **not** blocked (the slot was released by the `finally`) — i.e. with `generateTextMock` resolving normally, the next call succeeds.

**Verify**: `vp test run test/main/agents/delegate-tool.test.ts` → all pass.

### Step 3: Confirm the whole agent suite is green

**Verify**: `vp test run test/main/agents` → all pass; `tsc --noEmit` → exit 0; `vp check` → exit 0.

## Test plan

- Extend `delegation.test.ts` with Tier A (child-tool clamps + `filesRead` + `toolCalls` recording) using a real temp-dir workspace.
- New `delegate-tool.test.ts` with Tier B (concurrency-limit acquire/reject/release, failure-path record-failed + slot-release + rethrow) using the mocked-model recipe from `app.test.ts`.
- Verification: both files pass via `vp test run test/main/agents`.

## Done criteria

Machine-checkable. ALL must hold (from `apps/desktop/`):

- [ ] `vp test run test/main/agents` passes
- [ ] `delegation.test.ts` contains a test asserting the `[... truncated at 12000 characters]` clamp marker
- [ ] `delegate-tool.test.ts` exists and contains tests matching `/Concurrent sub-agent limit/` and `/Delegation failed/`
- [ ] `tsc --noEmit` exits 0 and `vp check` exits 0
- [ ] No source files under `src/` were modified (`git status` shows only the two test files)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `buildDelegateTool(ctx)` does **not** expose a directly callable `.execute(input, context)` (Mastra's tool shape differs from `delegation.ts:237`). Do NOT refactor `delegation.ts` to expose it — report so the plan can be revised (e.g. to export the semaphore helpers for unit testing instead).
- A test you wrote to characterize _current_ behavior fails in a way that indicates a real bug (e.g. the slot is genuinely leaked, or output is not clamped). Report the discrepancy; do not change source to make the test pass.
- `generateText` cannot be partial-mocked via `vi.mock("ai", ...)` without breaking unrelated imports in the file.

## Maintenance notes

- For a reviewer: confirm Step 2's concurrency test actually holds the first slot open (the first `execute` must remain unresolved while the second is rejected) — otherwise it proves nothing.
- If driving `.execute` through Mastra proves brittle across `@mastra/core` upgrades, a more durable alternative is to `export` `tryAcquireChildSlot` / `releaseChildSlot` from `delegation.ts` and unit-test the semaphore directly; that is a source change and would need its own plan.
- When Plan 003 (event-store secret redaction) lands, the delegated child's recorded tool output (`recordDelegatedRunOutcome`) will be redacted too; no change to these tests is expected, but a reviewer should confirm the clamp assertions still hold.
