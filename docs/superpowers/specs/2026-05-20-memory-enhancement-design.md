# Memory Enhancement Design

Date: 2026-05-20

## Summary

Etyon will move from a deterministic long-term memory prototype to a local-first memory system inspired by the `agentmemory` project. The target design is complete, but implementation will land in phases so each runtime boundary stays testable.

The system remains embedded in the desktop main process. Etyon will not depend on an external `agentmemory` server by default. The renderer settings panels provide control and status only; summarization, embedding, retrieval, compaction, lifecycle maintenance, and model resolution live in main process modules.

## Goals

- Add a full `Memory` settings control plane for summarization, retrieval, query rewriting, memory tool model selection, and embedding model selection.
- Keep `Auto Compact` out of the `Memory` tab. It belongs to the phase 7 `Chat` settings tab and consumes the same summary pipeline.
- Add `Memory Tool Model` in the `Memory` tab. The default value is `auto`, which selects an enabled low-cost model that is strong enough for summary and rewrite tasks.
- Support semantic retrieval through embeddings. An empty embedding model value means the default cloud embedding model `text-embedding-3-small`.
- Support local embedding models through a searchable modal with on-demand download.
- Upgrade retrieval from keyword overlap to hybrid scoring: keyword score, embedding similarity, recency, access count, scope, and lifecycle strength.
- Preserve the current prompt injection order: session memory, long-term memory, skills, then explicit `@` mention context.
- Keep deterministic memory compression as the fallback whenever AI summarization, query rewriting, or embedding generation fails.

## Non-Goals

- Do not make an external `agentmemory` process a required dependency.
- Do not put `Auto Compact` controls into `memory-tab.tsx`.
- Do not implement full graph retrieval in the first runtime phase.
- Do not download local embedding models just because the user opens the `Memory` tab.
- Do not move memory business logic into React components.
- Do not change project snapshot or skill retrieval behavior except for prompt ordering compatibility.

## Existing Context

Current memory has three durable surfaces:

- `chat_session_memories`: session-level rolling recall built from recent messages.
- `memory_entries`: long-term memory entries for chat sessions and Telegram chatbot.
- `settings.memory`: long-term memory controls exposed in `memory-tab.tsx`.

Current runtime behavior is intentionally simple:

- `chat-session-memory.ts` keeps a deterministic rolling text summary.
- `memory.ts` writes and retrieves long-term memory entries.
- Retrieval scores keyword overlap plus access count.
- `/api/chat` injects session memory, long-term memory, skills, and mention context in that order.
- Telegram can read and write the same long-term memory store when enabled.

The design extends this shape instead of replacing it.

## External Research

The `agentmemory` project separates memory into capture hooks, summarization and compression functions, hybrid retrieval, context generation, and lifecycle maintenance. The reusable design ideas are:

- Capture should be automatic, but storage should keep source provenance.
- Summaries and lessons are denser than raw observations and should be retrievable separately.
- Context injection should respect a token budget and prefer recent or high-confidence blocks.
- Search benefits from a hybrid path: lexical search, vector search, optional graph expansion, and reranking.
- Lifecycle metadata such as access count, last access time, decay, dedupe, and archive state makes retrieval less noisy over time.

Etyon should borrow these runtime boundaries without adopting the external server.

## Architecture

The target runtime pipeline is:

```text
Capture -> Summarize -> Embed -> Retrieve -> Inject -> Maintain
```

### Capture

Capture receives candidate memory material from:

- chat session message persistence,
- Telegram bridge message persistence,
- phase 7 `Auto Compact` triggers,
- phase 7 explicit user actions such as "remember this".

Capture normalizes text, source, scope, project path, session id, message range, and created timestamp. It does not decide final retrieval ranking.

### Summarize

Summarization creates structured memory output:

- `summary`: concise session or source summary,
- `decisions`: durable decisions or preferences,
- `facts`: semantic facts,
- `procedures`: recurring steps or operational patterns,
- `confidence`: model-estimated confidence,
- `source`: source entry and message range.

Summarization uses `Memory Tool Model`. If model selection, provider auth, parsing, validation, or network calls fail, the existing deterministic compact text remains the stored fallback.

### Embed

Embedding generation runs after summary creation and after raw fallback memory updates. It stores vectors by entry id and embedding model id.

The default cloud model is represented by an empty settings value and resolves to `text-embedding-3-small`. Local models are user-selected and downloaded on demand.

Initial local model catalog:

- `MiniLM L6 v2`, around 23 MB,
- `BGE Small EN v1.5`, around 33 MB,
- `Multilingual E5 Small`, around 118 MB,
- `Paraphrase Multilingual MiniLM`, around 118 MB.

The local catalog belongs to main process runtime. The renderer receives status, size, installed state, and download progress through RPC.

### Retrieve

Retrieval accepts:

- current user query,
- project path,
- memory settings,
- candidate limit,
- token budget,
- rewritten query when query rewriting is enabled and succeeds.

The retrieval scorer combines:

- lexical score,
- vector similarity score,
- lifecycle strength,
- recency,
- access count,
- scope compatibility,
- source diversity.

`similarityThreshold` applies to vector similarity when embeddings are available. If embedding search is unavailable, retrieval falls back to lexical scoring and still respects max count and scope.

### Inject

The prompt injection order stays:

```text
session memory
long-term memory
skills
explicit @ mention context
```

This preserves current behavior where explicit files and folders remain closest to the live task, while memory provides recall before skills and mention context.

### Maintain

Maintenance jobs handle:

- dedupe similar memories,
- archive empty or obsolete memories,
- decay stale low-access memories,
- rebuild embeddings when the selected embedding model changes,
- recompute stats,
- expose diagnostics for Settings.

Maintenance is best-effort. It must not block chat response streaming.

## Settings Design

### Memory Tab

`memory-tab.tsx` should remain render-focused. Non-presentational constants, model catalogs, and formatting helpers belong under `apps/desktop/src/renderer/lib/memory/` or another feature-level renderer lib path.

The tab will contain four sections.

#### Long-Term Memory

Existing high-level switches stay:

- enabled,
- share across projects,
- include chatbot memory.

#### Memory Summarization

Fields:

- `autoSummarize`: enable AI summarization.
- `memoryToolModel`: `__auto__` or a provider model id.
- status row: last summary time, fallback state, and queued jobs if available.

The user-facing description should explain that `Memory Tool Model` powers summarization, query rewriting, and phase 7 auto compact summaries.

#### Memory Retrieval

Fields:

- `autoRetrieve`: automatically retrieve memories before model requests.
- `queryRewriting`: use the memory tool model to rewrite conversational messages into retrieval queries.
- `maxRetrievedMemories`: range `1-20`.
- `similarityThreshold`: range `0-100` in the UI, stored as `0-1`.

The visual structure should follow the reference: checkbox rows, nested query rewriting option, horizontal sliders, and clear loose-to-strict labels.

#### Embedding Model

Fields:

- `embeddingModel`: empty string for default `text-embedding-3-small`, otherwise a local or provider model id.
- `embeddingStatus`: resolved model, installed state, and pending rebuild count.

The model picker is a modal with:

- search input,
- "Default" option,
- "Local Models" group,
- model sizes,
- download icon for missing local models,
- progress or error state for downloads.

Download starts only when the user selects or explicitly downloads a missing local model.

### Chat Tab Design

The phase 7 `Chat` settings tab will own `Auto Compact`:

- `enabled`,
- `threshold`: `5-95`,
- `keepRecentMessages`: `2-20`,
- summary generation inherited from `Memory Tool Model`.

The design links `Auto Compact` to the shared summary pipeline and does not add a separate compact model selector.

## Settings Schema

Extend `MemorySettingsSchema` with:

```ts
{
  autoRetrieve: boolean
  autoSummarize: boolean
  embeddingModel: string
  includeChatbot: boolean
  maxContextEntries: number
  maxRetrievedMemories: number
  memoryToolModel: string
  queryRewriting: boolean
  shareAcrossProjects: boolean
  similarityThreshold: number
}
```

Compatibility mapping:

- `maxContextEntries` remains accepted for legacy settings and maps to `maxRetrievedMemories`.
- `memoryToolModel` defaults to `__auto__`.
- `embeddingModel` defaults to empty string.
- `autoRetrieve` defaults to current `enabled` behavior.
- `autoSummarize` defaults to false until the runtime pipeline is available.
- `similarityThreshold` defaults to `0.1`.

Phase 7 `ChatSettingsSchema` should include:

```ts
{
  autoCompact: {
    enabled: boolean
    keepRecentMessages: number
    threshold: number
  }
}
```

## Database Design

Keep `memory_entries` as the durable entry table and extend it in phases.

Planned `memory_entries` additions:

- `summary`,
- `confidence`,
- `strength`,
- `metadata_json`,
- `embedding_model`,
- `embedding_updated_at`,
- `summary_updated_at`.

Add `memory_embeddings`:

```text
id
entry_id
model
dimensions
vector_json or vector_blob
created_at
updated_at
```

Store vectors as JSON initially. The separate `memory_embeddings` table keeps the boundary stable if a later migration switches the payload to a blob.

Add `memory_summaries` only if entry-level summary fields become too crowded. The first implementation should prefer extending `memory_entries` to avoid premature table sprawl.

## Main Process Modules

Proposed module boundaries:

```text
apps/desktop/src/main/memory/
  capture.ts
  embeddings.ts
  embedding-models.ts
  lifecycle.ts
  prompts.ts
  retrieval.ts
  summarization.ts
  tool-model.ts
```

`apps/desktop/src/main/memory.ts` can become a compatibility facade that exports the existing public functions while delegating to focused modules.

Renderer support:

```text
apps/desktop/src/renderer/lib/memory/
  embedding-model-catalog.ts
  format-memory-settings.ts
  memory-settings-controls.ts
```

RPC schemas stay in `packages/rpc/src/schemas/memory.ts`.

## Model Resolution

`Memory Tool Model` resolver:

1. If a concrete model is selected, resolve it through the existing provider registry.
2. If `__auto__`, choose from enabled providers with usable credentials.
3. Prefer lower-cost models with good instruction following and JSON / structured-output reliability.
4. Prefer fast models for query rewriting.
5. Fall back to the default chat model only when no better utility model is available.

The resolver must return an explicit diagnostic when no model can be used. Runtime callers then use deterministic fallback.

## Error Handling

- Query rewriting failure uses the original query.
- Summarization failure stores deterministic compact memory.
- Embedding failure stores memory without vector and marks embedding status stale or failed.
- Local model download failure is visible in the modal and does not change the selected model unless the model was already installed.
- Retrieval failure returns no long-term memory rather than failing chat.
- Maintenance failure is logged and surfaced in stats, but never blocks chat.

## Implementation Phases

### Phase 1: Spec, Schema, and Settings Control Plane

- Update memory RPC schema and defaults.
- Add i18n keys.
- Enhance `memory-tab.tsx`.
- Add renderer helper modules for memory UI constants and formatting.
- Update docs.
- Add schema tests.

### Phase 2: Memory Tool Model Runtime

- Add memory tool model resolver.
- Add structured prompt helpers.
- Add query rewriting with fallback.
- Add tests for auto model selection and fallback.

### Phase 3: Summarization Pipeline

- Add summary generation and validation.
- Persist summary metadata.
- Keep deterministic compact fallback.
- Update chat and Telegram write paths to call the summarization pipeline when enabled.

### Phase 4: Embedding Runtime and Local Model Catalog

- Add embedding provider abstraction.
- Add cloud default resolver.
- Add local model catalog and download state RPC.
- Persist embeddings.
- Add embedding rebuild trigger when the selected model changes.

### Phase 5: Hybrid Retrieval

- Replace keyword-only scoring with hybrid scoring.
- Apply similarity threshold.
- Add source diversity.
- Update access tracking.
- Add tests for ranking, thresholds, and project scope.

### Phase 6: Lifecycle Maintenance

- Add dedupe, decay, archive, stale embedding stats, and rebuild diagnostics.
- Surface status in Settings.
- Keep jobs best-effort and non-blocking.

### Phase 7: Auto Compact Integration

- Add the `Chat` settings tab.
- Implement threshold and keep-recent-message settings.
- Reuse the summary pipeline.
- Persist compact summaries and write compact output back to long-term memory when the summarizer marks it as durable.

## Testing

- Schema tests for defaults and legacy compatibility.
- Unit tests for model resolution.
- Unit tests for query rewriting fallback.
- Unit tests for summary validation and deterministic fallback.
- Unit tests for retrieval ranking and scope filtering.
- RPC tests for embedding model list, download status, and stats.
- Renderer tests only for field wiring and important conditional states.

## Documentation

Update:

- `doc/ai.md`,
- `doc/settings.md`,
- `doc/database.md`,
- `doc/api-spec.md`,
- `doc/rpc.md`.

Docs must state that `Auto Compact` belongs to the phase 7 `Chat` settings tab and consumes the shared memory summary pipeline.

## Fixed Implementation Defaults

- Local embedding models cache under the desktop app user data directory at `models/embeddings/<model-id>`.
- The local model catalog contains explicit download references. A catalog entry is hidden until its download reference is verified.
- Vector storage starts as JSON in `memory_embeddings`.
- Full graph retrieval is deferred until hybrid retrieval and lifecycle maintenance are stable.
