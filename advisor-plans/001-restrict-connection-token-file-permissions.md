# Plan 001: Write the local-connection token file with owner-only permissions (0600)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b88add7..HEAD -- apps/desktop/src/main/local-connection.ts`
> If `local-connection.ts` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b88add7`, 2026-06-14

## Why this matters

The desktop app runs a local HTTP server on `127.0.0.1` and protects **every**
`/rpc/*` and `/api/*` route with a 256-bit bearer token. That token is written
to `~/.config/etyon/connection.json` so the Rust CLI (`etyon-client`) can read
it and call the same server. The file is currently created with default
permissions (typically `0644` — world-readable). On a shared/multi-user
machine, any other local user can read the token and then issue fully
authenticated requests to the running app (start agent runs, read/modify
settings and chats). Writing the file `0600` (owner read/write only) closes
this local information-disclosure path. This is the standard handling for an
on-disk credential.

## Current state

- `apps/desktop/src/main/local-connection.ts` — owns the local server bearer
  token and the connection file the Rust CLI reads. The token is generated with
  `crypto.randomBytes(32)` and gates all server routes.

  Current `writeLocalConnectionFile` (lines 29–49), the function to change:

  ```ts
  export const writeLocalConnectionFile = (url: string): void => {
    const connectionFilePath = buildLocalConnectionFilePath()
    const connectionDir = path.dirname(connectionFilePath)

    fs.mkdirSync(connectionDir, { recursive: true })
    fs.writeFileSync(
      connectionFilePath,
      JSON.stringify(
        {
          pid: process.pid,
          token: getLocalConnectionToken(),
          transport: CONNECTION_TRANSPORT,
          url,
          version: CONNECTION_FILE_VERSION,
          writtenAt: new Date().toISOString()
        },
        null,
        2
      )
    )
  }
  ```

  Note: the file path is `app.getPath("home") + "/.config/etyon/connection.json"`
  (see `buildLocalConnectionFilePath`, lines 14–19). The token is consumed by
  `isAuthorizedLocalRequest` (lines 59–63) and gated in
  `apps/desktop/src/main/server/app.ts:43,72`.

- **Why a plain `mode` option is not enough**: Node's `fs.writeFileSync(path,
data, { mode })` applies `mode` **only when the file is newly created** and it
  is further masked by the process umask. If the file already exists
  (overwritten on a later launch) the old, possibly world-readable mode is kept.
  Therefore you must also `chmodSync` the file after writing to enforce `0600`
  every time.

- **Cross-platform note**: `chmodSync`/`mode` on Windows only meaningfully
  toggles the owner write bit and never throws. The fix is correct on POSIX and
  harmless on Windows. The new test must assert POSIX bits only when
  `process.platform !== "win32"`.

- Repo conventions to match: `const` arrow functions; sorted object keys
  (oxlint `sort-keys`); kebab-case filenames; tests import from
  `vite-plus/test`. Filesystem tests use a temp dir and `afterAll` cleanup — see
  the exemplar `apps/desktop/test/main/agents/workspace-core.test.ts:1-36`.

## Commands you will need

Run all commands from `apps/desktop/` (the test mocks assume the working
directory ends in `/apps/desktop`).

| Purpose        | Command                                          | Expected on success                       |
| -------------- | ------------------------------------------------ | ----------------------------------------- |
| Typecheck      | `tsc --noEmit`                                   | exit 0, no errors                         |
| Lint/format    | `vp check`                                       | exit 0 (use `vp check --fix` to auto-fix) |
| Run this test  | `vp test run test/main/local-connection.test.ts` | all pass                                  |
| Run main tests | `vp test run test/main`                          | all pass, no regressions                  |

(Verified during recon: `vp test run <file>` works and the existing agent
suite passes.)

## Scope

**In scope** (the only files you should modify):

- `apps/desktop/src/main/local-connection.ts`
- `apps/desktop/test/main/local-connection.test.ts` (create)

**Out of scope** (do NOT touch):

- `apps/desktop/src/main/server/app.ts` — the auth check is correct as-is.
- The token generation / rotation logic in `local-connection.ts` (lines 12–27).
- `crates/etyon-client/**` — the Rust reader needs no change; `0600` files are
  readable by the owner that runs both the app and the CLI.

## Git workflow

- Branch: `advisor/001-connection-token-perms` (or the repo's convention).
- Commit message style: conventional commits, lowercase subject (the repo's
  `commitlint` rejects sentence-case). Example: `fix: write connection token file with 0600 permissions`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Enforce `0600` on the file and `0700` on the directory

Edit `writeLocalConnectionFile` in `apps/desktop/src/main/local-connection.ts`
so it (a) creates the directory with mode `0o700`, (b) writes the file with
mode `0o600`, and (c) `chmodSync`-es the file to `0o600` after writing so the
permission is enforced even when overwriting a pre-existing file. Target shape:

```ts
export const writeLocalConnectionFile = (url: string): void => {
  const connectionFilePath = buildLocalConnectionFilePath()
  const connectionDir = path.dirname(connectionFilePath)

  fs.mkdirSync(connectionDir, { mode: 0o700, recursive: true })
  fs.writeFileSync(
    connectionFilePath,
    JSON.stringify(
      {
        pid: process.pid,
        token: getLocalConnectionToken(),
        transport: CONNECTION_TRANSPORT,
        url,
        version: CONNECTION_FILE_VERSION,
        writtenAt: new Date().toISOString()
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  // writeFileSync's mode only applies on create and is umask-masked; enforce
  // owner-only on every write so an overwrite of a pre-existing world-readable
  // file is tightened.
  fs.chmodSync(connectionFilePath, 0o600)
}
```

Keep object keys sorted (they already are). Do not change any other function.

**Verify**: `tsc --noEmit` → exit 0; `vp check` → exit 0.

### Step 2: Add a permissions regression test

Create `apps/desktop/test/main/local-connection.test.ts`. Mock `electron` so
`app.getPath("home")` returns a fresh temp dir (mirror the electron mock in
`apps/desktop/test/main/agents/agent-event-store.test.ts:21-45`), call
`writeLocalConnectionFile`, then stat the file and assert owner-only perms.
Cover both a fresh write and an overwrite of a pre-existing `0644` file.

Structure to produce:

```ts
import fs from "node:fs"
import path from "node:path"

import { afterAll, describe, expect, it, vi } from "vite-plus/test"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-local-connection-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("electron", () => ({
  app: { getPath: () => mockedHomeDir }
}))

const isPosix = process.platform !== "win32"
const connectionFilePath = path.join(
  mockedHomeDir,
  ".config",
  "etyon",
  "connection.json"
)

afterAll(() => {
  fs.rmSync(mockedHomeDir, { force: true, recursive: true })
})

describe("writeLocalConnectionFile", () => {
  it("writes the token file with owner-only permissions", async () => {
    const { writeLocalConnectionFile } = await import("@/main/local-connection")

    writeLocalConnectionFile("http://127.0.0.1:1234")

    expect(fs.existsSync(connectionFilePath)).toBe(true)

    if (isPosix) {
      const mode = fs.statSync(connectionFilePath).mode & 0o777

      expect(mode & 0o077).toBe(0) // no group/other access
      expect(mode & 0o600).toBe(0o600) // owner read+write
    }
  })

  it("tightens permissions when overwriting a pre-existing world-readable file", async () => {
    if (!isPosix) {
      return
    }

    const { writeLocalConnectionFile } = await import("@/main/local-connection")

    fs.mkdirSync(path.dirname(connectionFilePath), { recursive: true })
    fs.writeFileSync(connectionFilePath, "{}", { mode: 0o644 })
    fs.chmodSync(connectionFilePath, 0o644)

    writeLocalConnectionFile("http://127.0.0.1:5678")

    const mode = fs.statSync(connectionFilePath).mode & 0o777

    expect(mode & 0o077).toBe(0)
  })
})
```

Notes for the executor:

- Import `writeLocalConnectionFile` with a dynamic `await import(...)` inside the
  test (after `vi.mock`) so the electron mock is in place first; this matches
  how the existing suites order hoisted mocks and imports.
- If the `@/main/...` path alias does not resolve in the test, check
  `apps/desktop/tsconfig*.json` / the vite config for the alias and use the same
  form the other `test/main/**` files use (they import `@/main/...`).

**Verify**: `vp test run test/main/local-connection.test.ts` → all pass (2
tests on POSIX; the second is skipped on Windows).

### Step 3: Confirm no regressions

**Verify**: `vp test run test/main` → all pass; `tsc --noEmit` → exit 0;
`vp check` → exit 0.

## Test plan

- New file `apps/desktop/test/main/local-connection.test.ts`, modeled on the
  temp-dir + electron-mock pattern in
  `apps/desktop/test/main/agents/agent-event-store.test.ts`.
- Cases: (1) fresh write produces an owner-only file; (2) overwriting a
  pre-existing `0644` file tightens it to no group/other access. Both POSIX-gated.
- Verification: `vp test run test/main/local-connection.test.ts` → all pass.

## Done criteria

Machine-checkable. ALL must hold (run from `apps/desktop/`):

- [ ] `tsc --noEmit` exits 0
- [ ] `vp check` exits 0
- [ ] `vp test run test/main/local-connection.test.ts` passes; the new test exists
- [ ] `vp test run test/main` passes (no regressions)
- [ ] `grep -n "0o600" src/main/local-connection.ts` shows the file write/chmod uses `0o600`
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `writeLocalConnectionFile` no longer matches the "Current state" excerpt (the
  file drifted since this plan was written).
- The `@/main/...` import alias cannot be made to resolve in the new test after
  matching the convention used by the existing `test/main/**` files.
- `vp test run test/main` reveals pre-existing failures unrelated to this change
  (report them; do not try to fix them here).

## Maintenance notes

- For a reviewer: confirm the `chmodSync` runs unconditionally after the write
  (not only on create), and that the test asserts `mode & 0o077 === 0`.
- Follow-up deferred: pre-existing `connection.json` files written by older
  builds are only tightened the next time the app writes the file; no migration
  is included (the token is regenerated each launch, so a stale world-readable
  copy is short-lived). Plan 003 (event-store secret redaction) is the sibling
  secret-handling change; the two can be reviewed together.
