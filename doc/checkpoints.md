# Workspace Checkpoints

## Phase 1 scope

Phase 1 persists a pre-image before the main agent's `write`, `edit`, and `bash` tools mutate a project. It provides the main-process capture, file restore, parent-chain, and garbage-collection APIs; it does not expose those APIs through RPC or renderer UI yet.

## Storage

- Manifests live in the SQLite `agent_checkpoints` table.
- File content is gzip-compressed and content-addressed by SHA-256 under `<app-config-dir>/checkpoints/<projectHash>/objects/<sha-prefix>/<sha>` (`app-config-dir` is `~/.config/etyon-dev` for development and `~/.config/etyon` for release).
- `projectHash` is the first 16 hexadecimal characters of the SHA-256 digest of the normalized absolute project path.
- A manifest points to the latest checkpoint for the same project through `parent_id`.
- Files larger than 5 MB retain their hash and mode in the manifest with `overCap: true`, but their content is not stored.
- Secret-looking files and paths that resolve outside the project are omitted.

## Capture and restore

`write` and `edit` capture the target file immediately before their workspace write helper runs. `bash` uses `git stash create` in Git projects, which writes an unreferenced Git object without changing the worktree, index, or refs. A clean Git tree and a non-Git project both produce a checkpoint with no snapshot hash; the non-Git checkpoint still records the tool event.

File restore is last-write-wins. Before restoring a manifest, it captures the current state of the same file list as a new `write` checkpoint. This safety checkpoint makes a restore itself restorable. Phase 1 does not apply Git/bash snapshot hashes.

## Retention

Every successful capture schedules best-effort pruning without delaying the tool call. Per project, manifests older than 14 days are removed, then the oldest remaining manifests are evicted until referenced blob storage is no more than 512 MB. Unreferenced blobs are removed after manifest pruning.

## Deferred to Phase 2

- oRPC schemas and router procedures
- Message/tool timeline restore anchors and confirmation UI
- Settings schema and retention controls
- User-facing warnings for over-cap files and expiring Git snapshot objects
- Git/bash snapshot restore
