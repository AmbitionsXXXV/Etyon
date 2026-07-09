# Rust CLI

Etyon now uses a Rust-first CLI workspace. The legacy TypeScript CLI under `apps/cli` has been removed.

## Workspace

```text
Cargo.toml
crates/
  etyon-cli/
  etyon-client/
  etyon-index/
  etyon-types/
```

- `etyon-cli`: command parsing, output, exit codes, and user-facing behavior.
- `etyon-client`: local desktop connection file parsing and HTTP calls.
- `etyon-index`: project index initialization and refresh.
- `etyon-types`: shared Rust DTOs that mirror desktop JSON payloads.

## Desktop Connection

The desktop app writes a connection file after its local server starts:

```text
~/.config/etyon/connection.json
```

The file contains the desktop URL, process id, transport version, and a per-start token. `/health` stays public; `/rpc/*` and `/api/chat` require:

```text
Authorization: Bearer <token>
```

The CLI expects desktop to already be running. It does not start desktop in the first Rust CLI version.

## Commands

Implemented in the first slice:

```bash
cargo run -p etyon-cli -- status
cargo run -p etyon-cli -- tui
cargo run -p etyon-cli -- projects index init --project /path/to/project
cargo run -p etyon-cli -- projects index refresh --project /path/to/project
cargo run -p etyon-cli -- projects index status --project /path/to/project
```

`--tui` and `etyon tui` are reserved entry points. They return a stable planned-but-unavailable result until a TUI is implemented.

## Project Index

Project indexing writes:

```text
<project>/.etyon-snapshot/
  config.json
  manifest.json
  index.json
  history.json
  snapshots/
  documents/
  chunks/
  embeddings/
```

Git projects automatically get `.etyon-snapshot/` added to `.gitignore`. Non-Git projects are not given a `.gitignore`.

Embeddings are reserved in the data model but disabled by default.

## Verification

Rust checks are wired into the root Vite+ workflow:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo deny check bans licenses sources
cargo nextest run --workspace
```

The root scripts expose:

```bash
vp run rust:check
vp run rust:test
```

The Vite+ pre-commit hook now runs:

```bash
vp staged
vp run typecheck
vp run rust:check
```

`vp staged` also formats staged Rust files through `cargo fmt`.
