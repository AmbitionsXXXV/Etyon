# Plan 008: Fix three composer state leaks in the chat route (permission mode, approval queue, cross-session queue)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `advisor-plans/README.md` — your reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 3c94d02..HEAD -- 'apps/desktop/src/renderer/routes/chat.$sessionId.tsx'` (quote the path — it contains a literal `$`). If the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.
>
> **Worktree base check (run second)**: `git merge-base HEAD 3c94d02` must print `3c94d02e6c87dc8f22cfd604608d193bc99ce145`; otherwise STOP (a previous executor run was silently based on `main`).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (three small, independent state fixes; each mirrors an existing in-file pattern)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3c94d02`, 2026-07-12

## Why this matters

`ChatRuntime` (inside `routes/chat.$sessionId.tsx`) persists across `/chat/:id` navigation whenever the target session's messages are already cached — it is mounted conditionally, with no `key`, so its `useState` values survive session switches. Three pieces of state mishandle that reality:

1. **`permissionMode` is seeded once and never re-synced.** If the settings query resolves after mount, the user's configured default (e.g. `acceptEdits`) is silently ignored; worse, a per-session escalation to `bypass` carries into the next session opened in the same runtime — a safety-relevant leak.
2. **A message typed while a tool approval is pending is sent immediately** instead of queued: `handleSubmit` only queues on `isRequestPending`, but a run suspended on approval reports `status: "ready"`. The new user turn races and abandons the pending approval resume — exactly the invariant the queue drain logic (`isQueueDrainReady`) protects, one branch upstream.
3. **Queued follow-ups leak across sessions**: `queuedMessages` is never reset on session switch, so a queue built in busy session A drains into session B (the drain sends with the _current_ session id). The only reset today is on user Stop.

## Current state

One file is in scope: `apps/desktop/src/renderer/routes/chat.$sessionId.tsx` (~2,913 lines). All excerpts below are from commit `3c94d02`. In shell commands, always quote the filename (literal `$`).

### (A) `permissionMode` seed — line 1374

```ts
const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(
  defaultPermissionMode
)
```

`setPermissionMode` appears at exactly three places today: this `useState`, the Shift+Tab cycle callback (line ~1614), and the pill's `onPermissionModeChange={setPermissionMode}` (line ~2169). There is NO resync effect. The prop source (line ~2827, in the parent component):

```ts
          defaultPermissionMode={
            settingsQuery.data?.agents.defaultPermissionMode ?? "default"
          }
```

### The in-file exemplar to mirror — the `agentMode` resync effect, lines 1437-1439

```ts
useEffect(() => {
  setAgentMode(getChatAgentModeFromAgentsEnabled(agentsEnabled))
}, [agentsEnabled, selectedSession.id])
```

(`selectedSession` is a `ChatSessionSummary` prop already in `ChatRuntime`'s scope; this effect is the repo's established "reset per-session composer state" pattern.)

### (B) `handleSubmit` — lines 1766-1790

```ts
const handleSubmit = useCallback(
  ({
    mentions,
    text
  }: {
    mentions: ChatMention[]
    text: string
  }): Promise<void> => {
    // While a run is in flight, hold the message in the queue instead of
    // sending; it drains automatically once the turn settles.
    if (isRequestPending) {
      setQueuedMessages((currentMessages) => [
        ...currentMessages,
        { id: crypto.randomUUID(), mentions, text }
      ])

      return Promise.resolve()
    }

    sendPromptMessage({ mentions, text })

    return Promise.resolve()
  },
  [isRequestPending, sendPromptMessage]
)
```

The predicate it must also honor is defined ABOVE it, lines 1644-1655:

```ts
const isAwaitingToolApproval = useMemo(
  () => hasPendingToolApproval(latestMessage),
  [latestMessage]
)
// The turn is fully settled only when nothing else is in flight: not pending,
// no error, not awaiting an approval, and the SDK is not about to auto-resend
// a tool result. Queued follow-ups drain on the edge into this state.
const isQueueDrainReady =
  !isRequestPending &&
  !error &&
  !isAwaitingToolApproval &&
  !shouldSendChatAutomatically({ messages })
```

### (C) `queuedMessages` — line 1384; the only reset is user Stop (line ~1889)

```ts
const [queuedMessages, setQueuedMessages] = useState<QueuedPromptMessage[]>([])
```

```ts
const handleStop = useCallback(() => {
  // Stopping halts the turn and discards queued follow-ups so they don't
  // auto-send after the interrupt.
  setQueuedMessages([])
  void stop()
}, [stop])
```

There is no `[selectedSession.id]`-keyed reset for the queue (the artifact state has one, but it lives in the parent component keyed on `sessionId` — inside `ChatRuntime` use `selectedSession.id` like the agentMode exemplar).

### Conventions

oxlint-enforced: arrow-function consts, sorted object keys, exhaustive hook deps (fix deps arrays honestly — do not suppress), no inline `eslint-disable` (repo uses oxlint). Comments only where they state a constraint. Conventional commits, lowercase subject.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install deps (fresh worktree) | `vp install` | exit 0 |
| Lint + format | `vp check` | exit 0 |
| Typecheck | `vp run typecheck` | exit 0 (never bare `tsc` — stale global 5.3.3 reports phantom errors) |
| Renderer tests | `cd apps/desktop && vp test run test/renderer` | all pass |
| Full desktop tests | `cd apps/desktop && vp test run` | all pass |

## Scope

**In scope** (the only file you may modify):

- `apps/desktop/src/renderer/routes/chat.$sessionId.tsx`

**Out of scope** (do NOT touch):

- `components/chat/prompt-input.tsx` (the pill/hotkey UI is correct; only the route's state handling is wrong).
- `lib/chat/prompt-input.ts`, `shared/agents/permission-mode.ts`.
- Extracting components out of the god-file — a separate backlog item; keep this diff minimal.
- Any behavior change to `handleStop`, the drain effect, or `isQueueDrainReady` itself.

## Git workflow

- Branch: `advisor/008-composer-state-hygiene` cut from `3c94d02`.
- One commit, conventional, lowercase subject, e.g. `fix: reset composer permission mode and message queue per session and queue during approvals`.
- Do NOT push.

## Steps

### Step 1: Re-sync `permissionMode` on settings load and session switch

Directly below the `agentMode` resync effect (after line 1439), add:

```ts
// Adopt the configured default when settings resolve after mount, and drop
// any per-session escalation (e.g. bypass) when switching sessions.
useEffect(() => {
  setPermissionMode(defaultPermissionMode)
}, [defaultPermissionMode, selectedSession.id])
```

Note: this also resets an in-flight manual override if the user edits the default in Settings mid-session — acceptable; the settings default is the source of truth on every boundary.

**Verify**: `vp check 'apps/desktop/src/renderer/routes/chat.$sessionId.tsx'` → pass.

### Step 2: Queue messages while a tool approval is pending

In `handleSubmit`, change the guard and its comment:

```ts
      // While a run is in flight — or parked on a pending tool approval, which
      // reports status "ready" — hold the message in the queue instead of
      // sending; it drains automatically once the turn fully settles.
      if (isRequestPending || isAwaitingToolApproval) {
```

and extend the dependency array to `[isAwaitingToolApproval, isRequestPending, sendPromptMessage]`.

**Verify**: `grep -n "isRequestPending || isAwaitingToolApproval" 'apps/desktop/src/renderer/routes/chat.$sessionId.tsx'` → 1 match.

### Step 3: Reset the queue (and message-edit state) on session switch

Extend the effect added in step 1 (same boundary semantics, one effect):

```ts
useEffect(() => {
  setPermissionMode(defaultPermissionMode)
  setQueuedMessages([])
  setEditingMessageId(null)
  setEditingMessageText("")
}, [defaultPermissionMode, selectedSession.id])
```

(If `setEditingMessageId` / `setEditingMessageText` are not the exact setter names at your HEAD, use the setters found beside `handleCancelEditMessage` (~line 1881) — they reset the same two states.)

Caveat this introduces deliberately: a settings-default change mid-session also clears the queue. That coupling is acceptable — both are "composer boundary" resets; do NOT split into two effects unless lint forces it, and if you do, keep dep arrays exhaustive.

**Verify**: `vp check 'apps/desktop/src/renderer/routes/chat.$sessionId.tsx'` → pass.

### Step 4: Full gates

**Verify**: `vp run typecheck` → exit 0; `cd apps/desktop && vp test run` → all pass (suite was 88 files / 583 tests green at `3c94d02`; the count may have grown since).

## Test plan

There is no existing render-test harness for this 2,913-line route component (state lives inline; extraction is a separate backlog item), so this plan ships with **no new unit tests** — done criteria are grep- and suite-based, and the reviewer performs the manual verification below. Do not build a new test harness for this plan.

Manual verification script for the REVIEWER (not the executor): in the dev app, (1) set default permission mode to `acceptEdits` in Settings → open a chat → pill shows Accept edits without touching it; (2) cycle to Bypass in session A → switch to another cached session B → pill shows the settings default, not Bypass; (3) trigger a tool approval, type a message while the approval card is up → it lands in the queue chip, and after Approve/Deny it auto-sends; (4) queue a message in A mid-run, switch to B → nothing auto-sends in B.

## Done criteria

ALL must hold (repo root):

- [ ] `grep -c "setPermissionMode(defaultPermissionMode)" 'apps/desktop/src/renderer/routes/chat.$sessionId.tsx'` → 1
- [ ] `grep -n "isRequestPending || isAwaitingToolApproval" 'apps/desktop/src/renderer/routes/chat.$sessionId.tsx'` → 1 match inside `handleSubmit`
- [ ] The session-switch effect resets `queuedMessages`, `editingMessageId`, `editingMessageText` (visible in the diff)
- [ ] `vp check` → exit 0
- [ ] `vp run typecheck` → exit 0
- [ ] `cd apps/desktop && vp test run` → all pass
- [ ] `git status --short` shows ONLY `apps/desktop/src/renderer/routes/chat.$sessionId.tsx` modified

## STOP conditions

Stop and report back if:

- The worktree base check or drift check fails, or any excerpt above no longer matches the live code at ±15 lines.
- `isAwaitingToolApproval` is declared AFTER `handleSubmit` at your HEAD (would be a use-before-define lint error — report, don't reorder large blocks).
- oxlint's exhaustive-deps rule demands dependencies that would change the effects' firing semantics beyond `[defaultPermissionMode, selectedSession.id]` — report instead of adding refs or suppressions.
- Any existing test fails after your change.

## Maintenance notes

- These three fixes are exactly the kind of state that should move out of the god-file when the planned `ChatRuntime` extraction happens (separate backlog item DEBT-01); whoever extracts must carry the session-boundary effect along.
- Reviewer scrutiny points: the dep arrays (no suppressions), and that the step-3 effect does not also fire on unrelated re-renders (deps are exactly `[defaultPermissionMode, selectedSession.id]`).
- Deferred deliberately: `queuedMessagesRef` (line 1388) is not reset — it mirrors state via an effect and follows automatically; verify in review that no code reads the ref before that mirror effect runs.
