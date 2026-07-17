# Plan: Plan-Mode Interactions

> Source: design session 2026-07-15 · branch `feat/agent-event-sourcing` Scope: four interaction features around plan mode — (A) agent-asks-user questions, (B) plan proposal with Implement / Not now, (C) plan execution indicator above the composer, (D) a timed hint suggesting plan mode — plus the one companion hardening they depend on.

## Current State (evidence)

- **Modes exist.** `ChatAgentMode = "chat" | "agent" | "plan"` (`src/shared/chat/agent-mode.ts:1`), cycled by the composer pill (plan = warning tint, `prompt-input.tsx:598`). A typed `/plan` forces plan mode for one turn (`main/server/routes/chat.ts:71`).
- **Plan mode is prompt-only.** `CHAT_PLAN_MODE_SYSTEM_PROMPT` asks the model to stay read-only and to "tell the user to switch to Agent mode" (`agent-mode.ts:53`). `buildAgentToolset` never sees the agent mode (`minimal/agent-toolset.ts:88`), so `edit`/`write`/`bash` are still offered in plan mode — discouraged, not blocked.
- **No agent→user question mechanism exists.** Nothing like `ask_user` is registered; the only human-in-the-loop surfaces are tool approvals.
- **Two approval paths already work end-to-end**, and are the mechanism to reuse:
  - Parent tools: AI SDK `needsApproval` → `tool-approval-request` part → loop exits `suspended` (`agent-loop.ts:144`) → renderer `addToolApprovalResponse({ approved, id, options: buildChatRequestOptions(...) })` (`lib/chat/tool-ui.ts:60`) → `sendAutomaticallyWhen: shouldSendChatAutomatically` (`lib/chat/auto-send.ts`) resumes through persisted message history. Each resume is a **new** `agent_runs` row; the suspended row stays historical.
  - Child (delegated) tools: in-process `approval-broker.ts` + `data-subagent-approval` parts + oRPC `respondToApproval`.
- **Plan already has a mental slot in prompts.** Base instructions say "when you leave plan mode after the user approves a plan, turn the plan into todos first" (`agent-toolset.ts:54`) — but nothing implements approval.
- **Composer is HeroUI Pro `PromptInput`.** `PromptInput.Queue` renders in a band above `PromptInput.Shell` (`prompt-input.tsx:2043`) — the natural home for a plan indicator row. `buildChatRequestOptions(mentions, mode = agentMode)` already accepts a mode override (`chat.$sessionId.tsx:1684`).
- **HeroUI has no ready-made "plan indicator" or timed-alert component** (verified against Pro + OSS docs): the only documented above-shell slot is `Queue`; OSS `Alert` has status variants and an action-button pattern but no auto-dismiss; `PromptSuggestion` is for starter prompts, not indicator rows. Conclusion: compose from OSS primitives in the Queue band.

## Design Decisions

- **D1 — One "suspend-for-input" mechanism powers both new tools.** `ask_user` (A) and `propose_plan` (B) are AI SDK tools **without `execute`** (human-input tools). The loop suspends when a step ends with an unanswered execute-less tool call; the renderer answers with `addToolResult(...)` and auto-send resumes — the exact shape of the existing approval path. No broker, no new transport, durable via persisted message parts + the generic `agent_tool_calls` seam (run inspector replay is free).
- **D2 — The plan becomes a first-class session artifact.** `propose_plan` calls persist into a new single-row-per-session table `chat_session_plans`. "Not now → later just type _implement it_" is solved by **prompt injection** (the saved plan + guidance rides the system prompt while status is `proposed`/`implementing`), not by intent-detection heuristics in app code.
- **D3 — Companion hardening: plan mode drops write tools for real.** Pass the agent mode into `buildAgentToolset`; in plan mode omit `edit`/`write`/`bash`/`artifact`/`imagen` (and force delegation read-only), add `ask_user` + `propose_plan`. Plan mode becomes honest instead of prompt-discouraged. A and B assume this.
- **D4 — The plan-mode hint is a pure renderer heuristic.** No model round-trip, no telemetry: a debounced pure function over the composer draft. Testable in node (`renderer/lib/chat/*` convention: no rpc import).
- **D5 — UI composes existing primitives.** Question card and plan card render in the assistant timeline like approval cards (compact-disclosure idiom); indicator and hint live in the composer's above-shell band. No new dependency.

---

## Feature A — `ask_user` tool (structured questions in plan mode)

**Answer to the open question first: not integrated today — this feature adds it.**

### Tool definition (`minimal/ask-user-tool.ts`)

```ts
inputSchema = {
  question: string (1–300 chars),
  options: Array<{ label: string (1–60), description?: string (≤140) }> (2–5),
  multiSelect?: boolean (default false)
}
// no execute — answering happens in the renderer
outputSchema = {
  selected: string[],        // chosen option labels ([] when custom-only)
  custom: string | null      // free-form input, always offered in the UI
}
```

- Registered **in plan mode only** for v1 (matches the ask; enabling it in agent mode later is one line once the toolset knows the mode, D3).
- Tool description tells the model: ask only when the answer materially forks the plan; 2–5 mutually exclusive options; never re-ask what the user already said; the UI always offers a free-form input besides your options.
- Plan-mode system prompt (rewritten in B) instructs: clarify with `ask_user` **before** finalizing a plan when requirements are ambiguous.

### Loop mechanism (`agent-loop.ts`)

`evaluateStep` gains one branch: if the step content contains a `tool-call` for an execute-less tool (compute `inputRequiredToolNames` from the ToolSet: `execute === undefined`) — exit `suspended`, same as `tool-approval-request` today. Without this the next iteration would send a dangling `tool_use` without `tool_result` and the provider rejects the history.

### Resume (renderer)

- Answer submission: `addToolResult({ tool: "ask_user", toolCallId, output, options: buildChatRequestOptions(latestUserMentions) })`. _(Implementation note: verify the installed `ai@6.0.221` `addToolResult` accepts `options` like `addToolApprovalResponse` does; if not, thread the body through the transport's `prepareSendMessagesRequest` from a ref.)_
- `shouldSendChatAutomatically` (`auto-send.ts`) is extended: also fire when the last assistant message's **trailing part** is an execute-less tool part in state `output-available` and no part is `approval-requested`. **Trailing-part check is load-bearing**: after resume the answered part stays `output-available` forever, but the model appends parts after it, so the predicate goes false — this is what prevents an auto-send loop. (The approval path avoids this differently: `approval-responded` is a transient state.) Keep it a pure function; node-test both the fire and the no-refire case.

### UI (timeline card, `components/chat/` + `lib/chat/` sibling)

- Pending (`input-available`, last message, no output): question text + option list (single-select: one-tap answers; multiSelect: toggle buttons + confirm) + always a free-input row ("自定义…" TextField + send). Options are HeroUI `Button variant="outline" size="sm"` full-width rows with label + muted description.
- Answered: collapses to one compact line `Q: <question> · <answer>` in the tool-trace disclosure style; run inspector shows the full call via the existing generic seam.
- Reload-safe: pending question re-renders from persisted parts (state `input-available` + run `suspended`), same as pending approvals today.

---

## Feature B — `propose_plan` tool + Implement / Not now

### Tool definition (`minimal/propose-plan-tool.ts`)

```ts
inputSchema = {
  title: string (1–80),          // short handle, shown in the indicator
  plan: string (markdown)        // the full plan: steps, files, risks
}
// no execute
outputSchema = { decision: "implement" | "not_now" }
```

Registered in plan mode only. Plan-mode system prompt is rewritten to end with: _investigate → (ask_user if ambiguous) → call `propose_plan` with the complete plan; do not call it before the plan is complete; after an `implement` decision, todo_write the steps and begin executing; after `not_now`, acknowledge in one short sentence and stop._ Delete the old "tell the user to switch to Agent mode" line.

### Decision flow

- Card renders the plan markdown (existing markdown renderer, `ScrollShadow` + max-height, default expanded) with two actions:
  - **Implement now** → `setAgentMode("agent")` + `addToolResult({ decision: "implement", options: buildChatRequestOptions(latestUserMentions, "agent") })`. The explicit `"agent"` override matters — the useCallback closure still holds `"plan"` at click time. Resume continues the same thread in agent mode; the model todo-writes the plan and starts (permission gates unchanged — edits still ask under `default` mode).
  - **Not now** → `addToolResult({ decision: "not_now", options: buildChatRequestOptions(latestUserMentions) })`. Model acknowledges in one line; composer stays in plan mode. (Rejected alternative: suppress the resume round-trip to save a call — it special-cases auto-send and leaves the model unaware of the decision in-run; one cheap resume keeps run lifecycle uniform.)
- Answered card collapses to `计划已保存 · <title> · <decision>`.

### Persistence — `chat_session_plans` (schema.ts + drizzle migration)

```
sessionId   text PK, FK → chat_sessions.id (cascade)
title       text notnull
planMarkdown text notnull
status      enum: proposed | implementing | done | dismissed
sourceRunId text null · sourceToolCallId text null
createdAt / updatedAt / decidedAt text
```

- Single row per session; a newer `propose_plan` upserts over it (status resets to the new decision). Written in main at the same seam that already walks final parts (`recordAgentRunOutcome` / `onFinishPersist` in `routes/chat.ts:227`): call with input → upsert `proposed`; output present → `implementing` or stay `proposed` (not_now). The table is a rebuildable read-model of tool calls — event-sourcing stance unchanged.
- oRPC additions on the agents router: `getSessionPlan(sessionId)`, `setSessionPlanStatus(sessionId, status: done | dismissed)`. Renderer reads via TanStack Query, invalidates on turn finish and on mutation.

### "Not now → later just type _implement it_"

While a plan row exists, `chat.ts` injects one system block (alongside `planSystemPrompt`, `chat.ts:180`), clamped to ~16 KB:

- `proposed` + **agent** mode: _"A saved plan for this session has not been started (title). <plan markdown> If the user asks to implement/execute it ('implement it', '按计划执行', …), treat it as the spec: todo_write its steps first, then execute. If the user asks something unrelated, ignore it."_ → a plain later "implement it" works with zero intent-detection code.
- `proposed` + **plan** mode: _"…you are read-only here: refine the plan or tell the user to press Implement / switch to Agent mode."_
- `implementing` + agent mode: _"You are executing the saved plan (title). Keep todos in sync; state completion clearly when every step is done."_
- `done`/`dismissed`: no injection.

---

## Feature C — Plan indicator above the composer

- **Visibility**: plan row status = `implementing` (survives turns and restarts; independent of any live run).
- **Placement**: inside `HeroPromptInput`, sibling **before** `HeroPromptInput.Shell` — the Queue band (`prompt-input.tsx:2042`); indicator row sits above the queue when both show. In-flow (persistent state; layout shift is expected here, unlike the transient hint).
- **Anatomy** (`ComposerPlanIndicator`, OSS primitives — no Pro component exists for this, see Current State): one compact row, warning-tinted to match the plan pill — plan icon + `按计划实施中 · {title}` + live `{done}/{total}` from the existing todo store while a run streams (title-only between turns) + trailing actions: **查看** (Popover with the plan markdown in `ScrollShadow`) and an overflow menu → **标记完成** (`done`) / **放弃计划** (`dismissed`), both via `setSessionPlanStatus`.
- v1 keeps done/dismiss manual; auto-detecting completion from model text is unreliable. (Optional later: persist final todo counts into the plan row at run finish.)

## Feature D — Timed plan-mode hint (3–5 s alert with countdown)

- **Trigger**: pure function `shouldSuggestPlanMode(draft: string): boolean` in `renderer/lib/chat/plan-hint.ts`, evaluated ~600 ms after typing pauses, only when composer mode is `chat`/`agent` (never `plan`, never image mode, never while a request is pending). Heuristic v1: draft ≥ 60 chars AND (zh/en plan-intent keyword hit — 设计/方案/架构/重构/规划/迁移/新功能/redesign/refactor/architect/plan/migrate/implement a/build a — OR multi-requirement shape: numbered list / 3+ sentences). Node-tested with zh + en fixtures. (A model-side "this looks plan-worthy" data-part signal can layer on later; the seam is the same hint component.)
- **Frequency guard**: at most once per draft lifecycle (reset on send/clear); stop for the session after two dismissals.
- **UI**: floating (absolutely positioned above the composer, no layout shift, motion enter/exit like the permission pulse) — OSS `Alert status="warning"` (plan's hue), one line: `这个任务适合先规划` + Button **切换到 Plan**（`setAgentMode("plan")`, keep draft, refocus editor）+ `CloseButton`. Countdown: 4 s auto-dismiss with a 1.5 px bottom progress strip animating width 100→0 (CSS animation; `animation-play-state: paused` on hover/focus-within; skip the shrink under `prefers-reduced-motion` and just time out). Escape dismisses.
- HeroUI note: OSS `Alert` has no timeout prop — the countdown wrapper is ours by design.

---

## i18n

New keys in all three locales (`packages/i18n/src/locales/*/translation.json`), under the existing `chat.composer.*` / new `chat.plan.*` namespaces: question card (custom-input placeholder, submit, answered-line), plan card (implement, notNow, saved-line), indicator (executing, view, markDone, dismiss), hint (title, switchAction).

## Phases (each gate: `vp test` + tsc + lint clean; verify in the running app per repo /verify flow)

1. **Suspend-for-input mechanism + `ask_user`** — evaluateStep branch (+ node tests: suspend on unanswered execute-less call, no false suspend when result present), auto-send trailing-part predicate (+ fire/no-refire tests), toolset gains `agentMode` (D3 hardening + plan-only registration), question card UI, i18n. _Verify: in plan mode the model asks, options render, answer resumes the run, reload mid-question restores the card, run inspector replays the call._
2. **`propose_plan` + decisions + persistence** — tool + prompt rewrite, decision card, `chat_session_plans` migration + upsert seam, oRPC pair, prompt injection in `chat.ts`. _Verify: plan → Implement flips to agent and executes with todos; Not now → later typing "implement it" in agent mode follows the saved plan; new plan supersedes old._
3. **Plan indicator** — `ComposerPlanIndicator` in the Queue band, live todo counts, done/dismiss mutations. _Verify: indicator survives restart while implementing; view/done/dismiss behave._
4. **Timed hint** — heuristic + fixtures, floating alert with countdown/pause/reduced-motion, frequency guard. _Verify: long zh/en drafts trigger once; hover pauses; switch preserves draft._

Phase 4 is independent and can ship any time; 1 → 2 → 3 are ordered by dependency.

## Open Questions

1. `ask_user` in agent mode too (not just plan)? One-line change once D3 lands — default off in v1.
2. Multiple concurrent plans per session (history instead of single-row upsert)? v1 says the newest plan is _the_ plan; revisit if sessions grow long-lived.
3. Hint heuristic thresholds (60 chars, keyword list) — expect one tuning pass after dogfooding.
