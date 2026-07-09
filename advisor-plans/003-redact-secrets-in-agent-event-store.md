# Plan 003: Redact secret-shaped tokens before persisting them to the agent event store

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b88add7..HEAD -- apps/desktop/src/main/agents/agent-event-store.ts` If `agent-event-store.ts` changed since this plan was written, compare the "Current state" excerpt against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Why this matters

The file agent reads project files and the event store persists every tool call's input and output verbatim into the local SQLite DB (`agent_tool_calls.input_json` / `output_json`, plus delegated-child traces). The workspace's secret guard is **name-based only** — it blocks `.env`, `*.pem`, `.ssh/…`, etc. (`workspace-core.ts:88-120`) — so a secret living in a non-secret-_named_ file (e.g. `config.yaml`, `notes.md`, a log) is read normally and its contents are stored unredacted, durably, in the DB. That DB is a long-lived plaintext copy of any credential the agent happened to read.

This is a same-machine, local-trust-boundary issue (so MED, not critical), but storing credentials in cleartext is worth defending against. This plan adds a **best-effort, pattern-based redaction** pass at the single serialization chokepoint, complementing (not replacing) the name-based path filter. It does not retro-redact existing rows.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive transform on persisted strings; patterns are specific enough not to touch the id/status event payloads)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b88add7`, 2026-06-14

## Current state

- `apps/desktop/src/main/agents/agent-event-store.ts` — the event store. **Every** value persisted to the DB (tool inputs/outputs and event payloads) goes through one helper, `serialize` (lines 81–87):

  ```ts
  const serialize = (value: unknown): string => {
    try {
      return JSON.stringify(value ?? null)
    } catch {
      return "null"
    }
  }
  ```

  Call sites that persist tool data through `serialize`:
  - `deriveAgentRunRecords` (lines 219–223): `inputJson: serialize(tool.input)`, `outputJson: ... serialize(tool.output)` — the chat-derived tool calls.
  - `recordDelegatedRunOutcome` (lines 358–359): `inputJson: serialize(toolCall.input)`, `outputJson: serialize(toolCall.output)` — the headless child tool calls.
  - Event payloads (`run.started`, `tool.result`, `approval.requested`, etc.) also use `serialize`, but they only ever carry ids/state/status — the redaction patterns below will not match them.

  Because **all** persisted JSON flows through `serialize`, redacting inside it is the minimal, comprehensive change: tool inputs/outputs get scrubbed, and the id/status payloads are unaffected.

- Conventions: top-level regex literals (oxlint flags regex created in loops); `const` arrow functions; sorted object keys; exported helpers are unit-tested. Exemplar test file: `apps/desktop/test/main/agents/agent-event-store.test.ts` (same electron-mock + temp-DB harness you'll reuse for the integration case).

## Commands you will need

Run from `apps/desktop/`.

| Purpose | Command | Expected |
| --- | --- | --- |
| Typecheck | `tsc --noEmit` | exit 0 |
| Lint/format | `vp check` | exit 0 |
| Run this test | `vp test run test/main/agents/agent-event-store.test.ts` | all pass |
| Run agent tests | `vp test run test/main/agents` | no regressions |

## Scope

**In scope**:

- `apps/desktop/src/main/agents/agent-event-store.ts` (add the redaction helper; apply it inside `serialize`)
- `apps/desktop/test/main/agents/agent-event-store.test.ts` (extend with redaction unit + integration tests)
- `doc/agents.md` — add a short "事件存储的密钥脱敏 (best-effort)" note recording that tool inputs/outputs are redacted best-effort and the DB is not a secrets vault. (Per `AGENTS.md`: document runtime/tool-surface changes in `doc/`.) Keep this to a few lines; the broad doc rewrite is Plan 004's job, not this one.

**Out of scope** (do NOT touch):

- `workspace-core.ts` secret path filter — it is a separate, complementary layer.
- Any retro-migration of existing `agent_tool_calls` rows — explicitly deferred (see maintenance notes).
- The renderer's rendering of tool output.

## Git workflow

- Branch: `advisor/003-event-store-secret-redaction`.
- Conventional commit, lowercase subject, e.g. `feat: redact secret-shaped tokens before persisting agent tool data`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add an exported, top-level redaction helper

In `apps/desktop/src/main/agents/agent-event-store.ts`, add top-level (module scope, near the other helpers) a set of regex constants and an exported `redactSecretsFromJson` function. Operate on the **already-serialized JSON string** and replace only the secret substring, preserving JSON validity (the replacement contains no quotes/backslashes):

```ts
// Best-effort, defense-in-depth redaction of obviously-secret tokens before
// they are persisted. Complements the name-based secret-path filter in
// workspace-core. Patterns are deliberately specific to avoid mangling the
// id/status event payloads that also pass through serialize().
const SECRET_TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/gu, // OpenAI-style keys
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/gu, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, // GitHub tokens
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/gu, // JWTs
  /(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gu, // Authorization: Bearer ...
  /((?:api[_-]?key|secret|password|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/giu // key=value
]

const SECRET_PLACEHOLDER = "[REDACTED]"

/** Replaces obviously-secret tokens in a serialized JSON string. Best-effort:
 * it lowers, not eliminates, the chance of persisting a live credential. */
export const redactSecretsFromJson = (json: string): string => {
  let result = json

  for (const pattern of SECRET_TOKEN_PATTERNS) {
    result = result.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string"
        ? `${prefix}${SECRET_PLACEHOLDER}`
        : SECRET_PLACEHOLDER
    )
  }

  return result
}
```

Then apply it inside `serialize` so every persisted value is scrubbed:

```ts
const serialize = (value: unknown): string => {
  try {
    return redactSecretsFromJson(JSON.stringify(value ?? null))
  } catch {
    return "null"
  }
}
```

Notes:

- The two patterns with a capture group (`Bearer …` and `key=value`) keep the non-secret prefix and replace only the token; the rest replace the whole match.
- Keep regex literals at module top level (oxlint forbids constructing them in hot paths). Keep array/object keys ordered per the repo's lint rules.

**Verify**: `tsc --noEmit` → exit 0; `vp check` → exit 0.

### Step 2: Unit-test the redaction helper

In `apps/desktop/test/main/agents/agent-event-store.test.ts`, import `redactSecretsFromJson` and add a `describe("redactSecretsFromJson")` with cases:

- An OpenAI-style `sk-` key → replaced with `[REDACTED]`, original token absent.
- A `Bearer <token>` string → becomes `Bearer [REDACTED]` (prefix kept).
- A JWT (`eyJ….….…`) → replaced.
- A `"apiKey":"<value>"` JSON fragment → value replaced, key name intact.
- A benign payload like `JSON.stringify({ status: "succeeded", toolCallId: "tc-1" })` → returned **unchanged** (guards against over-redaction of event payloads).
- Output is still valid JSON for the structured cases: `JSON.parse(result)` does not throw.

**Verify**: `vp test run test/main/agents/agent-event-store.test.ts` → all pass.

### Step 3: Integration test — a recorded tool output is redacted on read-back

In the same test file, add an integration case using the existing temp-DB harness (`ensureDatabaseReady`, `getDb`, `createChatSession`, `startAgentRun`, `recordAgentRunOutcome` — see lines 117-175 of `delegation.test.ts` for the shape, and the top-of-file mocks already present in `agent-event-store.test.ts`):

- Start a run, then call `recordAgentRunOutcome` with a `messages` array whose assistant message contains a tool part whose `output` text embeds a secret (e.g. a string containing `sk-` + 24 chars). Use `getRunAssistantStartIndex` to compute `assistantStartIndex`, mirroring the existing `recordAgentRunOutcome` test in this file.
- Read the `agent_tool_calls` row back via `getDb()` and assert `output_json` does **not** contain the raw secret and **does** contain `[REDACTED]`.

If wiring a full `recordAgentRunOutcome` message fixture proves heavy, the unit tests in Step 2 plus a direct `deriveAgentRunRecords` assertion (its `outputJson` field is redacted) are an acceptable substitute — but prefer the read-back integration case.

**Verify**: `vp test run test/main/agents/agent-event-store.test.ts` → all pass.

### Step 4: Document the behavior and confirm no regressions

Add a short note to `doc/agents.md` (a few lines, in the same language/style as the surrounding doc) stating that tool inputs/outputs are best-effort redacted before persistence and the event store must not be treated as a secrets vault.

**Verify**: `vp test run test/main/agents` → all pass; `tsc --noEmit` → exit 0; `vp check` → exit 0.

## Test plan

- Unit: `redactSecretsFromJson` over each pattern + a benign payload + JSON validity, in `agent-event-store.test.ts`.
- Integration: `recordAgentRunOutcome` → read `agent_tool_calls.output_json` → secret absent, `[REDACTED]` present.
- Model after the existing `recordAgentRunOutcome` / `deriveAgentRunRecords` tests already in `agent-event-store.test.ts`.
- Verification: `vp test run test/main/agents` → all pass.

## Done criteria

Machine-checkable. ALL must hold (from `apps/desktop/`):

- [ ] `tsc --noEmit` exits 0; `vp check` exits 0
- [ ] `grep -n "redactSecretsFromJson" src/main/agents/agent-event-store.ts` shows it defined and called inside `serialize`
- [ ] `vp test run test/main/agents/agent-event-store.test.ts` passes; new redaction unit + integration tests exist
- [ ] `vp test run test/main/agents` passes (no regressions — confirms id/status payloads weren't broken by over-redaction)
- [ ] `doc/agents.md` contains the new redaction note
- [ ] Only in-scope files modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `serialize` no longer matches the "Current state" excerpt, or it is no longer the single chokepoint for persisted JSON (some call site stringifies directly).
- Adding redaction inside `serialize` breaks existing `agent-event-store` tests in a way that shows a non-secret payload is being mangled — report which pattern over-matched rather than loosening it blindly.
- The integration harness cannot start a temp DB in the test environment (report the error; the unit tests are still required).

## Maintenance notes

- This is **best-effort** redaction: it lowers the chance of persisting a live credential but is not a guarantee. Keep the path-based filter in `workspace-core.ts` as the primary defense.
- Deferred (own plan if wanted): a one-time migration to redact pre-existing `agent_tool_calls` rows; consider it only if real secrets are known to be in historical data. Today's change scrubs new writes only.
- For a reviewer: scrutinize the `key=value` pattern for false positives across real tool outputs (it is the broadest); if it over-redacts, tighten its key list rather than its value class.
- Any credential that may already have been read by the agent before this lands should be rotated — redaction does not un-leak an already-persisted secret.
