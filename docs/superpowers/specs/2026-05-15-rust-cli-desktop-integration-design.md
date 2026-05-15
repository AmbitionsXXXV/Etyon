# Rust CLI Desktop Integration Design

Date: 2026-05-15

## Summary

Etyon will replace the current TypeScript CLI with a Rust-first CLI stack. The first implementation phase connects the CLI to the already-running desktop app through a formal local control surface. The desktop backend stays in TypeScript / Electron for now so desktop AI capabilities can continue iterating before a later Rust backend or daemon migration.

This design also introduces a Rust project index foundation under each project root at `.etyon-snapshot/`. It references the current `.alma-snapshots` implementation but upgrades the structure for future coding-agent use by adding real chunk output, explicit metadata, and embedding placeholders.

## Goals

- Make `etyon` a Rust CLI, not a TypeScript CLI wrapper.
- Remove `apps/cli` as the long-term CLI surface.
- Let the CLI connect to the current desktop app when the desktop app is already running.
- Keep desktop startup, AI provider, session, snapshot, and renderer behavior stable in the first phase.
- Add a secure local connection file and token gate for CLI access.
- Cover settings, providers, proxy, sessions, projects, snapshots, and chat commands.
- Reserve `--tui` and `etyon tui` in the first CLI version without implementing a TUI.
- Introduce `.etyon-snapshot/` as the future coding-agent project index store.
- Auto-ignore `.etyon-snapshot/` in Git projects by updating or creating `.gitignore`.

## Non-Goals

- Do not migrate the desktop backend to Rust in this phase.
- Do not introduce a Rust daemon yet.
- Do not make the CLI work when desktop is not running.
- Do not make desktop auto-start from the CLI in the first phase.
- Do not generate embeddings by default in the first phase.
- Do not add a full coding agent in this phase.
- Do not preserve the TypeScript CLI as an active feature surface.

## Existing Context

The desktop app currently owns the local backend:

- Electron main process lifecycle, windows, tray, menu, and native IPC.
- Hono local HTTP server bound to `127.0.0.1` on an OS-assigned random port.
- oRPC over MessagePort for renderer calls and `/rpc/*` over HTTP for machine calls.
- `/api/chat` for AI SDK streaming chat.
- Drizzle / libSQL storage for chat sessions.
- Project snapshot support under `.alma-snapshots/`.

The current `.alma-snapshots/` layout is:

```text
.alma-snapshots/
  config.json
  index.json
  history.json
  snapshots/<snapshotId>.json
  documents/<snapshotId>.json
```

It already handles ignore rules, file hashing, text previews, folder candidates, and mention context. It also has schema fields for `embeddingState` and `embeddingRef`, but it does not generate embeddings or real chunk files.

## Architecture

The first phase uses the current desktop backend as the service provider and Rust as the CLI implementation language.

```text
Rust CLI
  -> etyon-client
  -> connection.json
  -> desktop Hono server
      -> /health
      -> /rpc/*
      -> /api/chat
```

The CLI calls desktop APIs through HTTP. It must not read or mutate desktop database files, settings files, or project index files directly unless the command is specifically part of the Rust project index module.

## Monorepo Structure

Add a Cargo workspace at the repository root:

```text
Cargo.toml
crates/
  etyon-cli/
  etyon-client/
  etyon-types/
  etyon-index/
apps/
  desktop/
packages/
  rpc/
  ui/
  i18n/
  logger/
```

### `crates/etyon-cli`

Responsibilities:

- Parse commands with `clap`.
- Apply global flags such as `--json`, `--connection`, `--timeout`, `--verbose`, and `--tui`.
- Format human-readable output.
- Format JSON or JSONL output for scripts.
- Map client errors into stable process exit codes.
- Expose `etyon tui` and `--tui` as planned-but-unavailable entry points.

### `crates/etyon-client`

Responsibilities:

- Read and validate `connection.json`.
- Check whether the recorded desktop process is still alive.
- Call `/health` before protected calls.
- Attach `Authorization: Bearer <token>` to protected requests.
- Call `/rpc/*` for management, provider, session, project, and snapshot operations.
- Call `/api/chat` and process SSE for streaming chat.
- Provide typed Rust client methods for `etyon-cli`.

### `crates/etyon-types`

Responsibilities:

- Own Rust DTOs for request and response payloads.
- Mirror the current TypeScript / Zod schema shape from `packages/rpc`.
- Keep JSON field names compatible with desktop.
- Avoid HTTP, CLI, and desktop implementation dependencies.

### `crates/etyon-index`

Responsibilities:

- Initialize `.etyon-snapshot/`.
- Refresh project file indexes.
- Respect Git and ignore rules.
- Produce document metadata and chunk files.
- Maintain index history and snapshot metadata.
- Ensure `.etyon-snapshot/` is ignored by Git projects.

This crate is Rust-only and becomes the reusable foundation for future CLI, desktop, and daemon indexing.

## Rust Stack

Use a conservative Rust stack:

- `clap` derive for command parsing.
- `tokio` runtime for async I/O.
- `reqwest` for HTTP calls.
- `serde` and `serde_json` for JSON.
- `eventsource-stream` for `/api/chat` SSE.
- `thiserror` for library errors.
- `anyhow` or `miette` for CLI-facing error presentation.
- `tracing` for `--verbose` diagnostics.
- `ignore` for project traversal and `.gitignore` semantics.
- `blake3` for fast content hashing in the new project index.

Avoid gRPC, `tonic`, `tarpc`, OpenAPI generation, and daemon protocol work in the first phase.

## Desktop Local Connection

Desktop writes a connection file after the local Hono server starts:

```text
~/.config/etyon/connection.json
```

Shape:

```json
{
  "pid": 12345,
  "token": "random-url-safe-token",
  "transport": "desktop-http",
  "url": "http://127.0.0.1:49152",
  "version": 1,
  "writtenAt": "2026-05-15T00:00:00.000Z"
}
```

Rules:

- `url` uses the current random local port.
- `token` is generated on every desktop start.
- `version` starts at `1`.
- The file is removed on normal desktop shutdown when possible.
- Stale files are expected and handled by CLI validation.

CLI validation sequence:

1. Read the configured connection file path.
2. Validate `version`.
3. Check that `pid` is still alive.
4. Call `GET /health`.
5. Use the token for protected calls.

## Local Authentication

`/health` remains unauthenticated so the CLI can distinguish a dead desktop from an auth failure.

Protected endpoints require:

```text
Authorization: Bearer <token>
```

Protected endpoints:

- `/rpc/*`
- `/api/chat`

Invalid or missing tokens return `401`. The CLI translates this into a clear local connection error and tells the user the desktop connection is stale or unauthorized.

## CLI Command Tree

The first command tree is:

```text
etyon
  status
  settings get
  settings set
  providers list
  providers fetch-models
  proxy test
  sessions list
  sessions create
  sessions open
  sessions archive
  sessions pin
  sessions set-model
  projects list
  projects rename
  projects pin
  projects archive-chats
  projects remove
  projects index init
  projects index refresh
  projects index status
  snapshots ensure
  snapshots files
  chat send
  tui
```

Global flags:

```text
--json
--connection <path>
--timeout <ms>
--verbose
--tui
```

`--tui` and `etyon tui` return a planned-but-unavailable message in the first version. They should have a stable non-zero exit code so scripts can detect unsupported TUI mode.

## Chat Behavior

`etyon chat send` calls `/api/chat`.

Examples:

```text
etyon chat send --session <id> --message "Explain this project"
etyon chat send --session <id> --model "openai/gpt-5.4" --message "Review this"
etyon chat send --session <id> --file src/main.rs --message "Explain this file"
etyon chat send --session <id> --folder src --message "Summarize this folder"
```

Default output streams assistant text to stdout.

With `--json`, streaming output is JSONL instead of a single JSON object. This preserves stream semantics and stays script-friendly.

## Project Index Foundation

The new project index directory is:

```text
<project>/.etyon-snapshot/
```

Initial layout:

```text
.etyon-snapshot/
  config.json
  manifest.json
  index.json
  history.json
  snapshots/<snapshotId>.json
  documents/<snapshotId>.json
  chunks/<snapshotId>.jsonl
  embeddings/
```

### `config.json`

Stores project index settings:

- schema version.
- ignore patterns.
- chunking settings.
- embedding settings with default disabled state.

### `manifest.json`

Stores project-level metadata:

- project path.
- index schema version.
- created timestamp.
- last refreshed timestamp.
- hash algorithm.
- index producer name and version.

### `index.json`

Maps relative file paths to content metadata:

- content hash.
- file size.
- modification time.
- detected language.
- text / binary classification.

### `history.json`

Tracks refresh history:

- snapshot id.
- parent snapshot id.
- timestamp.
- message.
- added / modified / deleted counts.

### `documents/<snapshotId>.json`

Stores text document records:

- absolute path.
- relative path.
- content hash.
- size.
- mtime.
- language.
- preview.
- chunk count.
- optional `embeddingState`.
- optional `embeddingRef`.

### `chunks/<snapshotId>.jsonl`

Stores real chunk rows:

```json
{"chunkId":"...","relativePath":"src/main.rs","startByte":0,"endByte":1200,"text":"...","hash":"..."}
```

Chunks are the first durable unit for future coding-agent retrieval. They are generated in phase one even though embeddings are not.

### `embeddings/`

Reserved for later. Phase one does not generate embeddings by default.

## Git Ignore Behavior

When initializing or refreshing the project index:

- Detect Git by checking whether `<project>/.git` exists as a directory or file.
- If it is a Git project, ensure `.gitignore` contains `.etyon-snapshot/`.
- If `.gitignore` does not exist, create it with `.etyon-snapshot/`.
- If `.gitignore` exists, append a single `.etyon-snapshot/` entry only when missing.
- Preserve existing `.gitignore` content.
- Do not modify `.gitignore` for non-Git projects.

## Relationship To `.alma-snapshots`

`.alma-snapshots` remains the current desktop chat context cache until migration work is explicitly planned.

`.etyon-snapshot` is the new Rust indexing foundation. It references the existing ideas but improves them:

- Uses Rust `ignore` crate instead of a custom glob parser.
- Uses real chunk files instead of only `preview` and `chunkCount`.
- Uses explicit manifest metadata.
- Uses `.gitignore` mutation for Git projects.
- Reserves embeddings without enabling embedding cost or provider coupling by default.

The later migration can either:

- adapt desktop chat context to read `.etyon-snapshot`, or
- replace `.alma-snapshots` after feature parity is proven.

## Error Handling

CLI errors are grouped:

- connection file missing.
- connection file invalid.
- desktop process not running.
- desktop health check failed.
- unauthorized token.
- desktop API version mismatch.
- HTTP transport failure.
- desktop returned structured RPC error.
- chat stream failed.
- project index initialization failed.

Human output should be concise and actionable. JSON output should include stable error codes.

## Testing

Rust tests:

- `etyon-client` connection file parsing.
- stale PID handling.
- auth header injection.
- HTTP status mapping.
- SSE stream parsing.
- `etyon-index` ignore behavior.
- `.gitignore` append / create behavior.
- index refresh stats.
- chunk generation.

Desktop tests:

- writes connection file after server starts.
- removes connection file on normal shutdown where practical.
- rejects protected endpoints without token.
- accepts protected endpoints with token.
- keeps `/health` unauthenticated.

CLI integration tests:

- `etyon status`.
- `etyon --json status`.
- planned TUI command error.
- snapshot / project index commands against temp projects.

Repository checks:

- Add Rust tasks to the root scripts without replacing existing Vite+ tasks.
- Keep existing `vp check` flow for TypeScript.
- Use Cargo as the source of truth for Rust checks and tests.

## Rollout

Phase 1:

- Add Cargo workspace and Rust crates.
- Remove `apps/cli`.
- Implement desktop connection file and token middleware.
- Implement Rust CLI connection, status, and planned TUI placeholder.

Phase 2:

- Add management, provider, proxy, session, project, and snapshot commands.
- Add `chat send` with SSE streaming.

Phase 3:

- Add `etyon-index`.
- Add `.etyon-snapshot` init / refresh / status.
- Add Git ignore mutation for `.etyon-snapshot/`.

Phase 4:

- Revisit desktop snapshot usage and decide whether desktop should consume `.etyon-snapshot`.
- Plan daemon or Rust backend migration separately.

## Open Decisions Resolved In This Spec

- CLI will be Rust-only.
- `apps/cli` will be removed rather than kept as a wrapper.
- Desktop must already be running in phase one.
- Discovery uses `~/.config/etyon/connection.json`.
- Protected local calls require a per-start token.
- TUI is reserved but not implemented.
- `.etyon-snapshot/` is the new project index directory.
- Git projects auto-ignore `.etyon-snapshot/`.
- Embeddings are reserved but disabled by default.
