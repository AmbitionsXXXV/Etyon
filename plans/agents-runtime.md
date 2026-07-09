# Plan: Agents Runtime

> Source PRD: `doc/agents.md`

## Status (branch `feat/agent-event-sourcing`)

All seven phases are implemented on the minimalist single-agent runtime:

- **Phase 1–4** (settings, read-only tools, permissioned writes, event store): in place — `chat_messages` projection + append-only `agent_runs`/`agent_events`/`agent_tool_calls`/`agent_approvals`, write tools gated by `requireApproval`.
- **Phase 5 — Profiles**: built-in roster (`general-purpose`, `explore`, `coder`, `plan`, `review`, `harness-operator`) in `shared/agents/profiles.ts`; the chat route resolves `settings.agents.defaultProfileId` and `agents/minimal/agent-toolset.ts` applies the profile's instructions / tool policy / model policy per request. Settings roster UI in `agents-tab.tsx`.
- **Phase 6 — Delegation**: `delegate` tool (`agents/minimal/delegation.ts`), gated by `allowSubagentDelegation`, runs a headless read-only child via AI SDK `generateText` (no write/edit, no nested delegation → depth capped at 1), enforces `maxConcurrentSubagents`, persists the child run under `parentRunId`, returns summary + files read + child run id.
- **Phase 7 — Run inspector**: `agent-run-inspection.ts` + `agents.inspectRun` / `listRuns` / `listPendingApprovals` RPC, surfaced by a per-message `AgentRunInspector` dialog (timeline + tool-output preview/summary). Pending approvals are durable across restart.
- **Phase 8 — Self-owned loop (2026-07-07)**: the Mastra `Agent` + `@mastra/ai-sdk` `handleChatStream` bridge is replaced by a harness-owned loop (`agents/minimal/agent-loop.ts`, modeled on Claude Code's query loop: one model round-trip per iteration, the harness decides continue-or-stop). Typed exits (`completed` / `max-steps` / `model-error` / `suspended` / `aborted`) settle `agent_runs.finish_reason` and a real `failed` status; hitting `maxSteps` appends a visible run-limit notice in chat instead of ending silently; a single-shot nudge counters announce-then-stop preamble endings; per-step `step.finished` events land in the event store. Tools are plain AI SDK `tool()` definitions with native `needsApproval` on `edit`/`write` (approval suspend/resume rides the persisted message history via `collectToolApprovals`).

**Deliberate boundary (unchanged):** no raw shell/command tool — the agent is file-only (read/ls/grep/edit/write), so Phase 3 "command" criteria (timeouts, destructive-command detection, `vp`/`rtk` command rules) are intentionally out of scope. Gates: tsc clean, lint clean, 277/277 tests. Remaining: interactive smoke with a real model key.

## Architectural Decisions

Durable decisions that apply across all phases:

- **Primary route**: keep the existing local `/api/chat` route as the chat entrypoint. Agent work starts as a capability behind normal chat, not as a parallel conversation product.
- **Transport**: keep `AI SDK v6 useChat + DefaultChatTransport + Hono` for the renderer path until the runtime proves it needs a different adapter.
- **Source of truth**: `chat_messages` remains the `UIMessage` projection for restoring the chat viewport. Agent facts move into append-only `agent_runs`, `agent_events`, and `agent_tool_calls` once the event store phase starts.
- **Default behavior**: `settings.agents.enabled` defaults to `false`. When disabled, current chat, memory, skills, mention, provider, and persistence behavior must be unchanged.
- **UI stance**: the chat viewport is still the primary interaction surface. Tool calls, approvals, and sub-agent traces render as restrained chat-adjacent projections, not as a full workbench in the first phases.
- **Settings stance**: settings can borrow Alma's `Chat` and `Agents` information architecture, but only where it maps to implemented runtime behavior. Avoid decorative agent dashboards before the kernel can emit real run state.
- **Compatibility stance**: do not preserve existing settings form styling if it makes inputs unclear or artificially narrow. Replace weak local patterns with shared settings primitives instead of patching every tab separately.
- **Execution boundary**: do not expose unrestricted shell. Local commands go through explicit tool schemas, `vp` / `rtk` project rules, output budgets, and permission checks.
- **Delegation boundary**: multi-agent starts as agent-as-tool with explicit context and budget limits. Child agents do not inherit the full parent transcript or approval-capable tools.
- **Documentation**: runtime, settings, and tool-surface changes should update the relevant docs in the same phase, not after the fact.

## Settings Surface Allocation

Use this split when deciding whether a setting belongs in `Chat` or `Agents`:

| Surface | Belongs Here | Avoid Here |
| --- | --- | --- |
| Chat | Auto compact, default tool selection, default skill selection, tool trace visibility, approval density, chat-run budget defaults that affect every chat request | Full profile editing, delegation graph editing, decorative run dashboards |
| Agents | Enable managed agents, default profile, profile roster, profile instructions, execution mode, delegation permissions, max sub-agents, max steps, model policy per profile | Generic chat rendering options, unrelated markdown/math/sound toggles |
| Providers | Provider credentials, model availability, provider-specific login and model refresh | Agent role descriptions or tool permission policy |
| Skills | Skill discovery and instruction retrieval controls | Treating skills as executable tools before a capability manifest exists |

Alma settings worth borrowing:

- `Control ring`: global enablement and sub-agent delegation toggles.
- `Crew roster`: built-in profiles with name, mode, mission, focus areas, preferred model, and availability.
- `Routing preview`: a compact explanation of what other agents see before delegating.
- `Delegation graph`: explicit handoff links, but only after child runs are persisted.

Alma settings to defer:

- Sound effects, quick replies, markdown toggles, single-dollar math, and infographic guidance unless Etyon already has a concrete renderer/runtime path for them.
- A large first-screen Agents dashboard before event-store-backed run state exists.
- Temperature and max-token controls unless they are actually threaded into model request options and validated across provider behavior.

---

## Phase 1: Settings Foundation And Agent Defaults

**User stories covered**: ordinary chat remains unchanged by default; settings controls are readable; agent capability is discoverable but off by default; future chat-agent settings have a stable schema home.

### What To Build

Create the settings contract and visual foundation before enabling any agent execution. Add agent settings defaults, expose only low-risk toggles, and replace scattered settings form styling with shared primitives for sections, switch rows, text inputs, number fields, select triggers, and compact metric cards. This phase should improve every settings tab that currently suffers from indistinct input backgrounds or fixed narrow widths.

### Acceptance Criteria

- [ ] Parsing empty settings produces a stable `agents` object with disabled defaults.
- [ ] Updating settings with no `agents` field preserves backward-compatible stored settings.
- [ ] `Agents` can appear as a settings tab or clearly grouped section, but toggling it off leaves `/api/chat` on the current non-agent path.
- [ ] `Chat` owns chat-run defaults only: auto compact remains, and new controls are limited to implemented or immediately planned chat execution behavior.
- [ ] Settings inputs, number fields, text areas, and select triggers are visually distinct from cards and page backgrounds in light, dark, and liquid-glass modes.
- [ ] Settings fields no longer rely on arbitrary narrow widths unless the control is intentionally compact, such as a small numeric stepper.
- [ ] The phase includes focused schema and renderer checks, plus a settings screenshot or browser inspection before completion.

---

## Phase 2: Read-Only Tool Loop In Chat

**User stories covered**: a normal chat can use agent capability; read-only project tools are visible and auditable; the chat viewport remains the main interaction surface.

### What To Build

Behind the disabled-by-default agent setting, route chat requests through a read-only single-agent path. The first executable profile should be conservative: search, read, tree, and diff capabilities only. Render tool activity in the chat transcript with small expandable rows, and keep the final assistant response in the existing message flow.

### Acceptance Criteria

- [ ] Agents disabled means existing model, memory, skills, mention context, persistence, and regeneration behavior is unchanged.
- [ ] Agents enabled allows the default profile to call only read-only tools.
- [ ] Tool calls use bounded input and output schemas, including output truncation and preview text.
- [ ] Tool-call parts render in chat without disrupting message actions, mention rendering, the sticky composer, or the project context panel.
- [ ] `chat_messages` can still restore the visible transcript after reload.
- [ ] Tests cover settings-off route behavior, read-only tool availability, tool output budgets, and renderer tool-part states.

---

## Phase 3: Permissioned Writes And Approval Flow

**User stories covered**: the agent can propose changes; risky actions require user approval; refusal is recoverable; terminal and file operations follow project rules.

### What To Build

Add the permission engine and the first write-capable tools. The agent can request patch application and bounded checks, but write operations, raw shell, network, install, and long-running commands must pause for approval or be denied by policy. Approval UI remains inside the chat flow.

### Acceptance Criteria

- [ ] Permission decisions are deterministic and ordered as `deny > ask > allow`.
- [ ] Read-only tools continue to run automatically inside the workspace.
- [ ] File writes go through patch-style operations with a diff preview before execution.
- [ ] Commands honor `vp` / `rtk` project rules, timeout limits, cwd constraints, and output budgets.
- [ ] Denied tools do not execute and return a model-visible tool error that allows the assistant to continue.
- [ ] Approval responses preserve tool-call ids across UI message parts, runtime state, and persisted records.
- [ ] Tests cover allow, ask, deny, approval, denial, timeout, abort, destructive command detection, and cross-workspace path rejection.

---

## Phase 4: Agent Runtime And Event Store

**User stories covered**: agent runs are observable; tool lifecycle is replayable; the chat message is a projection rather than the only record; runtime logic stops living inside the chat route.

### What To Build

Move orchestration behind an agent runtime facade. The chat route becomes an adapter that starts a run and streams a UI projection. Persist run and tool lifecycle events in append-only tables. Add a small trace viewer in the chat experience that can inspect the current run without turning the page into a full workbench.

### Acceptance Criteria

- [ ] A chat request creates an `agent_run` when agents are enabled.
- [ ] Every tool call writes ordered events for requested, started, finished, failed, approved, denied, and aborted states where applicable.
- [ ] Event sequence can reconstruct a run's key steps without reading the chat snapshot.
- [ ] Chat projection still stores recoverable `UIMessage` content.
- [ ] Runtime code owns profile selection, context building, model resolution, active tools, budgets, abort handling, and finish callbacks.
- [ ] Route tests use mocked model/tool streams and prove event order, projection output, abort propagation, and persistence.

---

## Phase 5: Managed Agent Profiles

**User stories covered**: users can choose specialist behavior; profiles have clear routing intent; providers can be tuned for stronger specialists without overloading the chat UI.

### What To Build

Introduce built-in managed profiles and a restrained profile settings UI. Borrow Alma's roster shape, but keep it operational: availability, execution mode, preferred model, mission, focus areas, tool policy, and routing preview. Custom profiles can remain read-only or limited if persistence and validation are not ready.

### Acceptance Criteria

- [ ] Built-in profiles have stable ids, labels, instructions, tool policy, model policy, and budget policy.
- [ ] Profile selection affects the next chat run only through the runtime, not by mutating prompt text inside the renderer.
- [ ] Preferred model may inherit the parent chat model or pick an explicit configured model.
- [ ] Disabled profiles remain visible in settings but cannot be used for routing.
- [ ] Profile UI uses shared settings primitives and remains compact in the settings window.
- [ ] Tests cover profile defaults, model inheritance, disabled profiles, and active tool filtering.

---

## Phase 6: Multi-Agent Delegation

**User stories covered**: a parent agent can delegate independent work; child agents are constrained; parent sees useful summaries without inheriting full child traces.

### What To Build

Add agent-as-tool delegation. A parent run can call a child profile with a task, context policy, tool subset, and budget. Child runs are separately persisted, and the parent receives a summary with evidence and file references. Full child traces remain in the event store and are visible on demand.

### Acceptance Criteria

- [ ] Delegation is disabled by default and controlled by settings.
- [ ] Maximum nesting depth and concurrent child run limits are enforced.
- [ ] Child agents receive a bounded context package, not the full parent transcript.
- [ ] Child agents cannot execute approval-required tools directly.
- [ ] A child needing risky work returns a parent-approval request instead of bypassing policy.
- [ ] Parent-visible output includes summary, evidence, files read, and child run id.
- [ ] Tests prove parent/child context isolation, failure recovery, summary-only parent output, and child trace persistence.

---

## Phase 7: Workbench Views And Advanced Harness

**User stories covered**: advanced users can inspect runs; long-running or interrupted work can resume; token-heavy tool output stays manageable.

### What To Build

Only after the runtime and delegation phases are stable, add richer run inspection: timeline, graph, artifacts, approvals inbox, replay, branch or checkpoint recovery, and tool result summary cache. This can grow toward an Agent Workbench, but it must be driven by real run events rather than static settings copy.

### Acceptance Criteria

- [ ] A run can be reopened from persisted events and display its timeline.
- [ ] Pending approval state survives app restart or stream reconnection.
- [ ] Large tool outputs have preview, full-output reference, and deterministic summary.
- [ ] Run replay can rebuild key model-facing context and tool-result boundaries.
- [ ] Workbench views are optional and do not replace the chat viewport for ordinary use.
- [ ] Tests cover pending approval recovery, output references, replay reconstruction, and UI loading states.

## Cross-Phase Test Strategy

- Keep provider calls mocked by default. Real provider smoke tests should be opt-in.
- Prefer deterministic model fixtures that emit text, tool calls, approval requests, and errors.
- Use temp workspaces for file, diff, symlink, large-output, and secret-like path tests.
- Check the settings UI visually after shared primitive changes because the target issue is perceptual contrast and layout width, not just types.
- Keep route tests narrow enough to be reliable but broad enough to prove the old path still works when agents are disabled.

## Completion Checklist

- [x] `settings.agents.enabled = false` proves no behavioral change to normal chat.
- [x] Settings tabs use consistent readable form controls and responsive width rules.
- [x] Chat can show read-only tool activity inside the existing viewport.
- [x] Write-capable actions pause for approval and obey permissions.
- [x] Agent runs have append-only persisted events.
- [x] Profiles and delegation are configured through settings but executed only in runtime.
- [x] Multi-agent child traces are inspectable without polluting parent model context.
- [x] Docs and tests are updated phase by phase.
