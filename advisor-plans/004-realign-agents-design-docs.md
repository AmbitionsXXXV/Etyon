# Plan 004: Realign `doc/agents.md` (and flag `agents-audit.md`) with the shipped minimalist runtime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> This is a **documentation-only** plan. Do not modify any source code, schema,
> or test. Write in the same language as the existing doc (`doc/agents.md` is in
> Chinese; match it). Per `AGENTS.md`, runtime/tool-surface docs live in `doc/`.
>
> **Drift check (run first)**: `git diff --stat b88add7..HEAD -- doc/agents.md agents-audit.md`
> If either file changed since this plan was written, re-locate the claims by
> their quoted text (line numbers below are as of commit `b88add7`).

## Status

- **Priority**: P2
- **Effort**: M (`doc/agents.md` is ~1,687 lines; you annotate/correct, not rewrite)
- **Risk**: LOW (docs only)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `b88add7`, 2026-06-14

## Why this matters

A deliberate pivot replaced a large multi-module agent runtime with a
minimalist **file-only** agent. `doc/agents.md` still describes the old, larger
design and marks much of it as `已落地` (landed) — including a self-managed
agent loop, a `permission-engine`, shell/command approval, a run-graph kernel,
an `ExecutionEnv`, and a Workbench page. None of that exists in the current
tree. `agents-audit.md` (dated 2026-06-01) audits that pre-pivot design and
cites files that were deleted. A contributor or coding agent reading these docs
builds a wrong mental model and may try to "restore" removed patterns. The one
accurate document is `plans/agents-runtime.md`. This plan makes `doc/agents.md`
tell the truth and clearly flags `agents-audit.md` as historical.

## Current state — what is actually true (use these facts)

The shipped runtime (verify against the live tree if unsure):

- **Tools are file-only**: `read`, `ls`, `grep`, `find`, `edit`, `write`
  (`apps/desktop/src/main/agents/minimal/file-tools.ts`). There is **no raw
  shell/command tool**, no `vp`/`rtk` command execution, no Git-inspection tool.
  (`plans/agents-runtime.md:14,27` records this as a deliberate boundary.)
- **The main run uses Mastra**, not a self-managed loop: the chat route streams
  through `handleChatStream` over a single Mastra `Agent`
  (`apps/desktop/src/main/server/routes/build-chat-stream-response.ts:478`,
  `apps/desktop/src/main/agents/minimal/file-agent.ts`).
- **No standalone permission engine**: write-capable tools (`edit`, `write`) are
  gated by AI-SDK/Mastra `requireApproval`. There is no `permission-engine`
  module.
- **Event store** (`apps/desktop/src/main/agents/agent-event-store.ts`,
  `apps/desktop/src/main/db/schema.ts`): append-only `agent_runs`,
  `agent_events`, `agent_tool_calls`, `agent_approvals`. (`agent_artifacts` is
  declared in the schema but currently has **no writer** — note it as reserved/
  unused, not as a live source of truth.)
- **Profiles** (`apps/desktop/src/shared/agents/built-in/`): `general-purpose`,
  `explore`, `coder`, `plan`, `review`, `harness-operator`, resolved per request.
- **Delegation** (`apps/desktop/src/main/agents/minimal/delegation.ts`):
  agent-as-tool; a read-only child runs a headless AI SDK `generateText`; nesting
  depth capped at 1 by construction; concurrency-limited; child never sees the
  parent transcript.
- **Run inspection**: `apps/desktop/src/main/agents/agent-run-inspection.ts` +
  `agents.inspectRun` / `listRuns` / `listPendingApprovals` RPC, surfaced by a
  per-message `AgentRunInspector` dialog. There is **no** separate
  `/agents/$sessionId` page, **no** run-graph/kernel, **no** `ExecutionEnv` or
  `agent-runtime` facade, **no** stream-hook chain.

**Files that the docs reference but which do NOT exist** (deleted in the pivot —
confirmed: a whole-repo search finds no import of any of them, only one
incidental string literal in a test fixture): `permission-engine.ts`,
`tool-registry.ts`, `tool-manifest.ts`, `tool-policy.ts`, `agent-loop.ts`,
`agent-loop-ai-sdk.ts`, `agent-runtime.ts`, `agent-kernel.ts`, `agent-state.ts`,
`agent-errors.ts`, `agent-stream-hooks.ts`, `agent-session-tree.ts`,
`agent-turn-state.ts`, `agent-extensions.ts`, `agent-plan-progress.ts`,
`execution-env.ts`, `agent-workspace.ts`, `agent-chat-projection.ts`.

### Specific false `已落地` claims in `doc/agents.md` (locations as of `b88add7`)

- `:31` — "主 run 走 Etyon self-managed loop". **Reality**: Mastra `handleChatStream`.
- `:42` — "Chat 内 Agent Workbench panel 与独立 `/agents/$sessionId` 页面已能查看
  run graph、timeline、tool calls、artifacts、approval、diff 和 retry". **Reality**:
  only a per-message `AgentRunInspector` dialog; no run graph, no Workbench page.
- `:43` — "Graph template、stage start、node execute、advance、retry、skip、
  until-idle … 已接入". **Reality**: no run graph exists.
- `:58` — P2 "已落地 `permission-engine`、write / patch / shell approval、bounded
  `vp` check 与只读 Git inspection". **Reality**: file-only; none of these exist.
- `:59` — P3 "已落地 `agent-runtime`、`Agent` facade、`ExecutionEnv`". **Reality**:
  a Mastra `Agent` exists; the `agent-runtime` / `ExecutionEnv` facades do not.
- `:60` — P4 "已落地 `agentExplore` / `agentPlan` / `agentReview` / `agentCoder`、
  run graph template、Workbench inspection". **Reality**: profiles are
  `general-purpose`/`explore`/`coder`/`plan`/`review`/`harness-operator`; no run graph.

## Commands you will need

| Purpose                | Command (from repo root)                    | Expected              |
| ---------------------- | ------------------------------------------- | --------------------- |
| Lint/format (markdown) | `vp check`                                  | exit 0                |
| Locate a claim         | `grep -n "self-managed loop" doc/agents.md` | shows the line to fix |

## Scope

**In scope**:

- `doc/agents.md` — add a top banner, correct the `落地状态 Checklist` and
  `P0–P5 状态快照` to the file-only reality, and mark the deep architecture
  sections that describe the removed runtime as historical/superseded.
- `agents-audit.md` — add a top banner marking it a stale audit of the pre-pivot
  design (do NOT delete it; it has historical value).

**Out of scope** (do NOT touch):

- Any source/schema/test file. This plan changes documentation only.
- `plans/agents-runtime.md` — it is already accurate; leave it as the source of
  truth (you may link to it).
- A full rewrite of `doc/agents.md`'s 1,687 lines — do NOT rewrite the prose;
  add banners, fix the status tables, and section-mark the superseded design.

## Git workflow

- Branch: `advisor/004-realign-agent-docs`.
- Conventional commit, lowercase subject, e.g.
  `docs: realign agents doc with the shipped file-only runtime`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a dated reality banner to the top of `doc/agents.md`

Immediately under the title (`# Agents 能力设计`), insert a blockquote banner (in
Chinese, matching the doc) that states, in substance:

- 本文记录的是早期较大规模的 Agents 设计；其中相当一部分**未按原样落地**。
- 当前实际运行的是**最小化、仅文件**的 agent（工具仅 `read`/`ls`/`grep`/`find`/`edit`/`write`，无 shell）。
- **权威的当前落地状态以 `plans/agents-runtime.md` 为准。**
- 下文中描述 `permission-engine`、self-managed loop、run graph / kernel、
  `ExecutionEnv`、独立 `/agents` Workbench 页面等内容属于**历史设计（未落地）**，仅作背景保留。
- 末尾标注 `最后对齐：2026-06-14`。

**Verify**: `grep -n "plans/agents-runtime.md" doc/agents.md` returns the banner
line; `grep -n "最后对齐：2026-06-14" doc/agents.md` returns the banner line.

### Step 2: Correct the `落地状态 Checklist` and `P0–P5 状态快照`

Using the "what is actually true" facts above, fix the status section
(`落地状态 Checklist`, lines ~26–50, and `P0–P5 状态快照`, lines ~52–60+):

- Change the `:31` "self-managed loop" item to describe the Mastra
  `handleChatStream` single-Agent path.
- Change the `:42`/`:43` Workbench/run-graph items to: a per-message
  `AgentRunInspector` dialog exists; run graph / kernel / Workbench page do not.
- Fix the P0–P5 table rows:
  - P2: replace "`permission-engine`、…shell approval、`vp` check、Git inspection"
    with: write tools (`edit`/`write`) gated by Mastra/AI-SDK `requireApproval`;
    **file-only, no shell/command/`vp`/Git tool**.
  - P3: replace "`agent-runtime`、`ExecutionEnv`" with: append-only event store
    (`agent_runs`/`agent_events`/`agent_tool_calls`/`agent_approvals`) +
    approval suspend/resume; no `agent-runtime`/`ExecutionEnv` facade.
  - P4: replace "`agentExplore/...`、run graph template、Workbench" with the real
    profile roster and the agent-as-tool delegation model; no run graph.

Keep edits surgical — adjust the claims, don't restructure the tables.

**Verify**: `grep -n "self-managed loop" doc/agents.md` no longer shows an
_unqualified_ landed claim (it is corrected or explicitly marked historical);
`grep -nE "permission-engine|run graph|ExecutionEnv|Workbench" doc/agents.md`
shows every remaining mention sits under a historical/superseded marker (see
Step 3), not under a `已落地`/landed status.

### Step 3: Mark the deep architecture sections as historical (superseded)

The long architecture sections that describe the removed runtime
(`permission-engine`, the loop/kernel/run-graph, `ExecutionEnv`, stream-hook
chain, session tree, etc. — roughly the "架构分层" / "激进架构进步方向" blocks)
should each carry a clear superseded marker at their heading, e.g. append
`（历史设计 / 未落地，2026-06 已被最小化 runtime 取代）` to the section headings,
or add a one-line blockquote at the top of each such section. Do not delete the
content; just prevent it from being read as current.

**Verify**: `grep -nc "历史设计" doc/agents.md` returns ≥ 1 (the superseded
markers exist).

### Step 4: Flag `agents-audit.md` as a stale pre-pivot audit

Add a blockquote banner at the very top of `agents-audit.md` (Chinese, matching
the file) stating, in substance:

- 本审计针对**改造前**（pivot 前）的较大 Agents runtime，日期 2026-06-01。
- 其中引用的 `permission-engine.ts`、`tool-registry.ts`、`agent-loop.ts`、
  `agent-runtime.ts`、`agent-kernel.ts` 等文件**当前已不存在**（已在最小化改造中删除）。
- 当前实现与状态以 `plans/agents-runtime.md` 与 `doc/agents.md`（顶部 banner）为准；
  本文仅作历史记录。

Do not delete or rewrite the audit body.

**Verify**: `grep -n "已不存在" agents-audit.md` returns the banner line.

### Step 5: Lint

**Verify**: `vp check` → exit 0 (markdown formatting passes).

## Test plan

Documentation only — no automated tests. Verification is the grep checks above
plus a human read-through confirming the banners and corrected status tables are
coherent and in the doc's existing language/voice.

## Done criteria

ALL must hold (from repo root):

- [ ] `doc/agents.md` has a top banner pointing to `plans/agents-runtime.md` and dated `2026-06-14` (`grep -n "plans/agents-runtime.md" doc/agents.md` and `grep -n "最后对齐：2026-06-14" doc/agents.md` both match)
- [ ] The `P0–P5 状态快照` no longer claims `permission-engine` / shell / `vp` check / `ExecutionEnv` / run graph as landed (the corrected rows reflect file-only + Mastra + event store)
- [ ] `grep -nc "历史设计" doc/agents.md` ≥ 1 (superseded sections marked)
- [ ] `agents-audit.md` has a stale-audit banner (`grep -n "已不存在" agents-audit.md` matches)
- [ ] `vp check` exits 0
- [ ] Only `doc/agents.md` and `agents-audit.md` are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "what is actually true" facts contradict what you find when you spot-check
  the live source (e.g. a `permission-engine.ts` actually exists now) — the tree
  may have changed since this plan was written; report the discrepancy.
- `doc/agents.md`'s structure differs so much from the cited line ranges that you
  cannot confidently locate the status tables by their quoted text.

## Maintenance notes

- Keep `plans/agents-runtime.md` as the single source of truth for landed
  status; `doc/agents.md` should describe the design and clearly separate
  shipped vs. historical.
- For a reviewer: confirm no source file was touched, and that the historical
  sections are _marked_ rather than deleted (the design rationale is worth
  keeping for context).
- Follow-up deferred: the `agent_artifacts` table is declared but unused; either
  wire it up (see the audit's direction note on capturing delegated edits) or
  remove it in a separate, code-scoped change — out of scope for this docs plan.
