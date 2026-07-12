# Plan 006: Gate the `workflow` tool behind user approval outside bypass mode

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `advisor-plans/README.md` — your reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 3c94d02..HEAD -- apps/desktop/src/main/agents/minimal/workflow apps/desktop/src/shared/agents/permission-mode.ts apps/desktop/test/main/agents/workflow-tool.test.ts apps/desktop/test/shared/agents/permission-mode.test.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.
>
> **Worktree base check (run second)**: `git rev-parse HEAD` must print `3c94d02e6c87dc8f22cfd604608d193bc99ce145` (or a descendant that passes the drift check). A previous executor run was silently based on `main` instead of the feature branch — if `git merge-base HEAD 3c94d02` does not print `3c94d02...`, STOP and report.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW (additive gate; bypass mode preserves old behavior)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `3c94d02`, 2026-07-12

## Why this matters

The `workflow` tool executes a **model-authored JavaScript script** in a `node:vm` context whose own header comment admits is "NOT a hard security boundary (host constructors remain reachable via `.constructor.constructor`)". Unlike every other side-effecting agent tool in this app — `bash`, `edit`, `write`, `delete` all require user approval — the workflow tool has **no `needsApproval`**, so a prompt-injected or misaligned model can run arbitrary host-realm code with zero user consent. This plan adds the same approval gate `bash` has: in `default` and `acceptEdits` permission modes the user must approve the script before it runs; in `bypass` mode it auto-runs as today. Swapping the vm substrate for a true isolate is a separate follow-up, NOT this plan.

## Current state

Files and their roles:

- `apps/desktop/src/main/agents/minimal/workflow/workflow-tool.ts` — builds the AI-SDK `workflow` tool. The `tool({...})` options object (starting line 76) has `description`, `execute`, `inputSchema` — **no `needsApproval`**.
- `apps/desktop/src/main/agents/minimal/workflow/engine.ts` — runs the script in `node:vm`; header threat-model comment at lines 15–22.
- `apps/desktop/src/shared/agents/permission-mode.ts` — the permission-mode predicates (`needsFileEditApproval`, `needsShellApproval`). The new predicate goes here.
- `apps/desktop/src/main/agents/minimal/bash-tool.ts` — the exemplar of an approval-gated tool (lines 299–314).
- `apps/desktop/src/main/agents/minimal/delegation.ts` — exports `DelegateToolContext` (lines 801–811), the props type `buildWorkflowTool` receives; it **already contains `permissionMode`**.

Excerpt — `workflow-tool.ts:69-79` (the builder destructure today does NOT pull `permissionMode` even though the context type has it):

```ts
export const buildWorkflowTool = ({
  chatSessionId,
  parentModelId,
  parentRunId,
  projectPath,
  writer
}: DelegateToolContext) =>
  tool({
    description: WORKFLOW_TOOL_DESCRIPTION,
    execute: async (inputData, context) => {
```

Excerpt — `delegation.ts:801-811`:

```ts
export interface DelegateToolContext {
  chatSessionId: string
  parentModelId: string | null
  /** Parent's approval mode; a writable child inherits it to gate its tools. */
  permissionMode: AgentPermissionMode
  parentProfile: ResolvedAgentProfile
  parentRunId: string
  projectPath: string
  /** Parent UI stream; when present the child's progress is forwarded live. */
  writer?: UIMessageStreamWriter<UIMessage>
}
```

Excerpt — the exemplar gate, `bash-tool.ts:299-314`:

```ts
needsApproval: (inputData) => {
  const isRemembered = matchesCommandAllowlist({
    allowlist: settings.approvals.commandAllowlist,
    approvalTtlMs: settings.approvals.approvalTtlMs,
    command: inputData.command,
    nowMs: Date.now(),
    projectPath: workspace.projectPath,
    toolName: BASH_TOOL_NAME
  })

  return needsShellApproval({
    command: inputData.command,
    isRemembered,
    mode: permissionMode
  })
}
```

Excerpt — `engine.ts:15-22` (the threat-model note to update in step 3):

```
 * THREAT MODEL: scripts are MODEL-AUTHORED and semi-trusted, not adversarial
 * third-party input. node:vm is NOT a hard security boundary (host constructors
 * remain reachable via `.constructor.constructor`), so this is defense against
 * a buggy/confused script, not a sandbox for hostile code. If workflow scripts
 * ever become untrusted, move to isolated-vm / QuickJS and stop injecting real
 * host constructors. The `runAgent` seam is separately responsible for keeping
 * every spawned agent within its own permission envelope.
```

Repo conventions that apply (oxlint-enforced): arrow-function consts (`const foo = () => ...`), object keys sorted alphabetically, no `Array#sort` (use `toSorted`), kebab-case filenames, imports via `@/main/...` / `@/shared/...` aliases. Tests import from `"vite-plus/test"`. Mode names are exactly `"default" | "acceptEdits" | "bypass"` (`PERMISSION_MODES`, `permission-mode.ts:19`).

The renderer needs **no change**: any tool part in state `approval-requested` already renders the generic approval card with Approve/Deny (`apps/desktop/src/renderer/components/chat/message-tool-trace.tsx`, `StructuredToolTraceCard` renders `ToolApprovalActions` for that state), and `resumability` for approvals is generic in the event store.

## Commands you will need

| Purpose | Command (run from repo root unless noted) | Expected on success |
| --- | --- | --- |
| Install deps (fresh worktree) | `vp install` | exit 0 |
| Lint + format | `vp check` | `pass:` lines, exit 0 |
| Typecheck | `vp run typecheck` | `Tasks: ... successful`, exit 0 |
| Targeted tests | `cd apps/desktop && vp test run workflow-tool permission-mode` | all pass |
| Full agents tests | `cd apps/desktop && vp test run test/main/agents` | all pass |

Never run bare `tsc` — the machine has a stale global TypeScript 5.3.3 that reports ~37 phantom errors. `vp run typecheck` is the canonical gate.

## Scope

**In scope** (the only files you may modify):

- `apps/desktop/src/shared/agents/permission-mode.ts`
- `apps/desktop/src/main/agents/minimal/workflow/workflow-tool.ts`
- `apps/desktop/src/main/agents/minimal/workflow/engine.ts` (header comment only)
- `apps/desktop/test/shared/agents/permission-mode.test.ts`
- `apps/desktop/test/main/agents/workflow-tool.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- The vm execution substrate in `engine.ts` (isolated-vm/QuickJS swap is a deferred follow-up; do not attempt it here).
- `delegation.ts` / the `delegate` tool (its children are approval-gated through their own tool sets).
- Any renderer file (the generic approval card already handles this).
- `agent-toolset.ts` (it already passes `permissionMode` into `buildWorkflowTool`).

## Git workflow

- Branch: `advisor/006-workflow-approval-gate` cut from `3c94d02`.
- Conventional commits, lowercase subject (commitlint enforces), e.g. `feat: gate workflow tool behind approval outside bypass mode`.
- Do NOT push.

## Steps

### Step 1: Add `needsWorkflowApproval` to permission-mode.ts

In `apps/desktop/src/shared/agents/permission-mode.ts`, next to `needsFileEditApproval`, add:

```ts
/**
 * Workflow scripts execute model-authored JS in-process, which is strictly
 * more powerful than a shell command, so only bypass mode may auto-run them.
 * Unlike bash there is no remembered-command allowlist: scripts are one-off.
 */
export const needsWorkflowApproval = (mode: AgentPermissionMode): boolean =>
  mode !== "bypass"
```

**Verify**: `cd apps/desktop && vp check src/shared/agents/permission-mode.ts` → pass, exit 0.

### Step 2: Wire the gate into the workflow tool

In `workflow-tool.ts`:

1. Add `permissionMode` to the destructured params of `buildWorkflowTool` (alphabetical position within the destructure).
2. Import `needsWorkflowApproval` from `@/shared/agents/permission-mode`.
3. Add to the `tool({...})` options (keys stay alphabetically sorted — `needsApproval` sorts between `inputSchema` and any later key; oxlint `sort-keys` will tell you):

```ts
    needsApproval: () => needsWorkflowApproval(permissionMode),
```

**Verify**: `cd apps/desktop && vp check src/main/agents/minimal/workflow/workflow-tool.ts` → pass. Then `grep -n "needsApproval" apps/desktop/src/main/agents/minimal/workflow/workflow-tool.ts` → exactly one match.

### Step 3: Update the engine threat-model comment

In `engine.ts`, inside the existing header comment block (lines 15–22), after the sentence ending "stop injecting real host constructors.", add one sentence:

```
 * Since plan 006, script execution is approval-gated outside bypass mode
 * (needsWorkflowApproval), so a hostile script additionally requires explicit
 * user consent — approval is the boundary; the vm is only accident containment.
```

**Verify**: `vp check apps/desktop/src/main/agents/minimal/workflow/engine.ts` → pass.

### Step 4: Tell the model about the gate in the tool description

In `workflow-tool.ts`, append one sentence to the end of the `WORKFLOW_TOOL_DESCRIPTION` template literal (after "...require/fs/network/process are not exposed."):

```
The script requires user approval before it runs (except in bypass permission mode), like bash.
```

**Verify**: `grep -c "requires user approval" apps/desktop/src/main/agents/minimal/workflow/workflow-tool.ts` → `1`.

### Step 5: Tests

1. `apps/desktop/test/shared/agents/permission-mode.test.ts` — add a `describe("needsWorkflowApproval")` with three cases: `"default"` → `true`, `"acceptEdits"` → `true`, `"bypass"` → `false`. Match the existing test style in that file.
2. `apps/desktop/test/main/agents/workflow-tool.test.ts` — using the file's existing harness for building the tool, add tests that:
   - the built tool object has a `needsApproval` function (`expect(typeof tool.needsApproval).toBe("function")` or equivalent given how the harness accesses it);
   - calling it resolves/returns `true` when the tool was built with `permissionMode: "default"`, and `false` with `permissionMode: "bypass"`. If the harness's context fixture lacks `permissionMode`, add it to the fixture (the type requires it — if the fixture compiled without it before, note that in your report).

**Verify**: `cd apps/desktop && vp test run workflow-tool permission-mode` → all pass, including the new cases.

## Test plan

Covered by Step 5. Structural patterns: the existing cases inside `test/shared/agents/permission-mode.test.ts` (pure predicate table tests) and the existing `workflow-tool.test.ts` harness.

## Done criteria

ALL must hold (run from repo root):

- [ ] `grep -n "needsWorkflowApproval" apps/desktop/src/shared/agents/permission-mode.ts` → 1 definition
- [ ] `grep -n "needsApproval" apps/desktop/src/main/agents/minimal/workflow/workflow-tool.ts` → 1 match
- [ ] `cd apps/desktop && vp test run workflow-tool permission-mode` → all pass
- [ ] `cd apps/desktop && vp test run test/main/agents` → all pass (no regressions)
- [ ] `vp check` → exit 0
- [ ] `vp run typecheck` → exit 0
- [ ] `git status --short` shows only in-scope files modified

## STOP conditions

Stop and report back (do not improvise) if:

- The worktree base check or drift check fails.
- The AI SDK `tool()` type rejects the `needsApproval` option on this tool shape (would indicate an SDK version constraint this plan didn't foresee — bash-tool uses it, so investigate no further than confirming the mismatch).
- `permissionMode` is not actually reachable in `buildWorkflowTool`'s scope after step 2 (type error persists).
- Adding the gate makes any EXISTING workflow test fail in a way that isn't just a fixture missing `permissionMode` — that suggests the execute path behaves differently under approval and needs advisor review.

## Maintenance notes

- Deferred follow-up (explicitly out of scope here): move script execution to `isolated-vm`/QuickJS and stop injecting host constructors, per the engine's own comment. The approval gate makes the residual risk user-mediated, not zero.
- Reviewer should scrutinize: that `needsApproval` is a function returning the predicate result (not invoked eagerly), and that the approval card renders the script in the chat UI (manual check — run any workflow in default mode).
- If a future feature adds "remembered workflows", the allowlist logic belongs in `needsWorkflowApproval`'s caller, mirroring bash's `matchesCommandAllowlist`.
