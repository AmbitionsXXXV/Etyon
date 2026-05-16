# Rust CLI Desktop Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rust-only `etyon` CLI that connects to a running desktop app, reserves TUI mode, and adds the `.etyon-snapshot` project index foundation.

**Architecture:** Add a root Cargo workspace with `etyon-types`, `etyon-client`, `etyon-index`, and `etyon-cli`. Desktop keeps the current Electron / Hono backend but writes a local connection file and gates `/rpc/*` plus `/api/chat` with a per-start token. The Rust CLI calls desktop through `etyon-client` and performs project indexing through `etyon-index`.

**Tech Stack:** Rust 2024, Cargo workspace, `clap`, `tokio`, `reqwest`, `serde`, `eventsource-stream`, `thiserror`, `anyhow`, `tracing`, `ignore`, `blake3`, `cargo-nextest`, Electron main, Hono.

---

### Task 1: Cargo Workspace And Type Crate

**Files:**

- Create: `Cargo.toml`
- Create: `crates/etyon-types/Cargo.toml`
- Create: `crates/etyon-types/src/lib.rs`

- [ ] **Step 1: Add root Cargo workspace**

Create `Cargo.toml`:

```toml
[workspace]
members = [
  "crates/etyon-cli",
  "crates/etyon-client",
  "crates/etyon-index",
  "crates/etyon-types",
]
resolver = "3"

[workspace.package]
edition = "2024"
license = "MIT"
rust-version = "1.85"
version = "0.1.0"

[workspace.lints.rust]
unsafe_code = "warn"

[workspace.lints.clippy]
all = "warn"
pedantic = "warn"

[workspace.dependencies]
anyhow = "1.0"
blake3 = "1.5"
chrono = { version = "0.4", features = ["serde"] }
clap = { version = "4.5", features = ["derive", "env"] }
eventsource-stream = "0.2"
futures-util = "0.3"
ignore = "0.4"
reqwest = { version = "0.12", features = ["json", "stream"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tempfile = "3.10"
thiserror = "2.0"
tokio = { version = "1.48", features = ["macros", "rt-multi-thread"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
url = "2.5"
```

- [ ] **Step 2: Add `etyon-types` crate**

Create `crates/etyon-types/Cargo.toml`:

```toml
[package]
name = "etyon-types"
edition.workspace = true
license.workspace = true
rust-version.workspace = true
version.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true

[lints]
workspace = true
```

- [ ] **Step 3: Add shared DTOs**

Create `crates/etyon-types/src/lib.rs` with DTOs for connection metadata, status output, chat sessions, snapshot items, chat mentions, provider models, and JSON helpers. Use `#[serde(rename_all = "camelCase")]` where desktop JSON uses camelCase.

- [ ] **Step 4: Run nextest for the new crate**

Run: `cargo nextest run -p etyon-types`

Expected: PASS, or zero tests with a successful nextest run.

### Task 2: Desktop Connection File And Token Gate

**Files:**

- Create: `apps/desktop/src/main/local-connection.ts`
- Modify: `apps/desktop/src/main/server/app.ts`
- Modify: `apps/desktop/src/main/server/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/main/server/app.test.ts`

- [ ] **Step 1: Add desktop connection module**

Create `apps/desktop/src/main/local-connection.ts` with:

- `createLocalConnectionToken()`
- `getLocalConnectionToken()`
- `writeLocalConnectionFile(url: string)`
- `removeLocalConnectionFile()`
- `isAuthorizedLocalRequest(request: Request)`

The file path is `path.join(app.getPath("home"), ".config", "etyon", "connection.json")`.

- [ ] **Step 2: Gate protected HTTP endpoints**

Modify `apps/desktop/src/main/server/app.ts` so `/health` remains public, while `/rpc/*` and `/api/chat` reject missing or wrong bearer tokens with `401`.

- [ ] **Step 3: Write and remove connection file**

Modify `apps/desktop/src/main/server/index.ts` and `apps/desktop/src/main/index.ts` so the file is written after `startServer()` has a URL and removed during shutdown.

- [ ] **Step 4: Add desktop tests**

Update `apps/desktop/test/main/server/app.test.ts` to assert:

- `/health` succeeds without auth.
- `/rpc/*` returns `401` without auth.
- `/rpc/*` succeeds with the current token.
- `/api/chat` returns `401` without auth.

- [ ] **Step 5: Run focused desktop tests**

Run: `vp test apps/desktop/test/main/server/app.test.ts`

Expected: PASS.

### Task 3: Rust Client Crate

**Files:**

- Create: `crates/etyon-client/Cargo.toml`
- Create: `crates/etyon-client/src/lib.rs`
- Create: `crates/etyon-client/src/connection.rs`
- Create: `crates/etyon-client/src/error.rs`
- Create: `crates/etyon-client/src/http.rs`

- [ ] **Step 1: Add client crate manifest**

Create `crates/etyon-client/Cargo.toml` depending on `etyon-types`, `reqwest`, `serde`, `serde_json`, `thiserror`, `tokio`, `url`, `eventsource-stream`, and `futures-util`.

- [ ] **Step 2: Implement connection parsing**

Implement `ConnectionInfo::read(path)` and `default_connection_path()` with validation for `version == 1`.

- [ ] **Step 3: Implement HTTP client**

Implement an `EtyonClient` that:

- builds from connection info.
- adds bearer auth for protected requests.
- calls `GET /health`.
- exposes JSON request helpers.

- [ ] **Step 4: Add client tests**

Test connection parsing, invalid version errors, auth header injection, and URL composition.

- [ ] **Step 5: Run nextest for client**

Run: `cargo nextest run -p etyon-client`

Expected: PASS.

### Task 4: Rust Project Index Crate

**Files:**

- Create: `crates/etyon-index/Cargo.toml`
- Create: `crates/etyon-index/src/lib.rs`
- Create: `crates/etyon-index/src/gitignore.rs`
- Create: `crates/etyon-index/src/model.rs`
- Create: `crates/etyon-index/src/refresh.rs`

- [ ] **Step 1: Add index crate manifest**

Create `crates/etyon-index/Cargo.toml` depending on `blake3`, `chrono`, `ignore`, `serde`, `serde_json`, `tempfile`, and `thiserror`.

- [ ] **Step 2: Implement `.etyon-snapshot` layout**

Implement functions to create:

```text
.etyon-snapshot/
  config.json
  manifest.json
  index.json
  history.json
  snapshots/
  documents/
  chunks/
  embeddings/
```

- [ ] **Step 3: Implement Git ignore mutation**

If `<project>/.git` exists as a file or directory, ensure `.gitignore` contains `.etyon-snapshot/`. Preserve existing contents and avoid duplicates.

- [ ] **Step 4: Implement refresh and chunks**

Use `ignore::WalkBuilder`, BLAKE3 content hash, text detection, preview generation, and JSONL chunk output.

- [ ] **Step 5: Add index tests**

Test init layout, non-Git `.gitignore` no-op, Git `.gitignore` creation, duplicate prevention, ignored file traversal, refresh stats, and chunk JSONL generation.

- [ ] **Step 6: Run nextest for index**

Run: `cargo nextest run -p etyon-index`

Expected: PASS.

### Task 5: Rust CLI Crate

**Files:**

- Create: `crates/etyon-cli/Cargo.toml`
- Create: `crates/etyon-cli/src/main.rs`
- Create: `crates/etyon-cli/src/commands.rs`
- Create: `crates/etyon-cli/src/output.rs`
- Delete: `apps/cli/package.json`
- Delete: `apps/cli/tsconfig.json`
- Delete: `apps/cli/src/index.ts`

- [ ] **Step 1: Add CLI manifest**

Create `crates/etyon-cli/Cargo.toml` with binary name `etyon` and dependencies on `anyhow`, `clap`, `etyon-client`, `etyon-index`, `etyon-types`, `serde_json`, `tokio`, `tracing`, and `tracing-subscriber`.

- [ ] **Step 2: Implement command tree**

Implement the command tree from the spec, including `status`, `projects index init|refresh|status`, and planned TUI exits.

- [ ] **Step 3: Implement `status`**

`etyon status` reads `connection.json`, calls `/health`, and prints human output or JSON when `--json` is set.

- [ ] **Step 4: Implement index commands**

`etyon projects index init|refresh|status --project <path>` delegates to `etyon-index`.

- [ ] **Step 5: Remove TypeScript CLI app**

Delete `apps/cli` after the Rust CLI builds.

- [ ] **Step 6: Run nextest and CLI smoke commands**

Run:

```bash
cargo nextest run -p etyon-cli
cargo run -p etyon-cli -- tui
cargo run -p etyon-cli -- projects index init --project /tmp/etyon-index-smoke
```

Expected: nextest passes; TUI exits with planned unavailable error; index init creates `.etyon-snapshot`.

### Task 6: Root Scripts And Verification

**Files:**

- Modify: `package.json`
- Modify: `turbo.json` if needed
- Create: `doc/rust-cli.md`

- [ ] **Step 1: Add Rust scripts**

Add root scripts:

```json
"rust:check": "cargo check --workspace",
"rust:test": "cargo nextest run --workspace"
```

- [ ] **Step 2: Document CLI and index behavior**

Create `doc/rust-cli.md` covering Rust workspace, desktop connection file, token behavior, TUI placeholder, cargo-nextest testing, and `.etyon-snapshot`.

- [ ] **Step 3: Run final verification**

Run:

```bash
cargo check --workspace
cargo nextest run --workspace
vp test apps/desktop/test/main/server/app.test.ts
```

Expected: all pass.

## Self-Review

- Spec coverage: Rust CLI, removal of `apps/cli`, local connection, token auth, TUI placeholder, `.etyon-snapshot`, Git ignore mutation, chunks, tests, and documentation are mapped to tasks.
- Placeholder scan: planned TUI placeholder is an intentional product behavior, not an incomplete plan item.
- Type consistency: `connection.json` fields, `.etyon-snapshot` layout, and command names match the approved design spec.
