# Memory Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Etyon's local-first memory system with full settings controls, phased runtime summarization, embedding retrieval, lifecycle maintenance, and future chat auto compact integration.

**Architecture:** The desktop main process owns memory capture, summarization, embeddings, retrieval, injection, and lifecycle maintenance. The renderer settings pages expose configuration and status only. Implementation lands in phases so existing deterministic memory remains the fallback throughout the migration.

**Tech Stack:** Electron main process, React 19 renderer, HeroUI React v3, oRPC, Zod v4, Drizzle SQLite, AI SDK v6, Vite+ / Ultracite, `vp`, and repo-local `rtk` shell command prefix.

---

## File Structure

Phase 1 changes:

- Modify `packages/rpc/src/schemas/memory.ts`: extend `MemorySettingsSchema`, add embedding model schemas, keep legacy `maxContextEntries` compatibility.
- Modify `packages/rpc/src/schemas/settings.ts`: update `MEMORY_SETTINGS_DEFAULT`.
- Modify `packages/rpc/test/schemas/memory.test.ts`: cover new memory defaults and stats compatibility.
- Modify `packages/rpc/test/schemas/settings.test.ts`: cover legacy app settings hydration.
- Create `apps/desktop/src/renderer/lib/memory/embedding-model-catalog.ts`: local embedding model metadata and default ids.
- Create `apps/desktop/src/renderer/lib/memory/memory-settings.ts`: clamp, percent conversion, and labels used by the UI.
- Create `apps/desktop/src/renderer/lib/memory/memory-tool-model-options.ts`: `__auto__` option plus chat model group normalization.
- Modify `apps/desktop/src/renderer/components/settings/memory-tab.tsx`: add summarization, retrieval, embedding model, and memory tool model controls.
- Modify `apps/desktop/src/renderer/components/settings-page.tsx`: pass model groups to `MemoryTab`.
- Modify locale files under `packages/i18n/src/locales/*/translation.json`: add new keys for `Memory` settings.
- Modify docs: `doc/ai.md`, `doc/settings.md`, `doc/database.md`, `doc/api-spec.md`, and `doc/rpc.md`.

Later runtime phases:

- Create `apps/desktop/src/main/memory/tool-model.ts`.
- Create `apps/desktop/src/main/memory/prompts.ts`.
- Create `apps/desktop/src/main/memory/summarization.ts`.
- Create `apps/desktop/src/main/memory/embedding-models.ts`.
- Create `apps/desktop/src/main/memory/embeddings.ts`.
- Create `apps/desktop/src/main/memory/retrieval.ts`.
- Create `apps/desktop/src/main/memory/lifecycle.ts`.
- Convert `apps/desktop/src/main/memory.ts` into a compatibility facade after the new modules exist.

## Task 1: Extend Memory Settings Schema

**Files:**

- Modify: `packages/rpc/src/schemas/memory.ts`
- Modify: `packages/rpc/src/schemas/settings.ts`
- Test: `packages/rpc/test/schemas/memory.test.ts`
- Test: `packages/rpc/test/schemas/settings.test.ts`

- [ ] **Step 1: Write the failing schema expectations**

Update `packages/rpc/test/schemas/memory.test.ts` so the default parse expects:

```ts
expect(MemorySettingsSchema.parse({})).toEqual({
  autoRetrieve: true,
  autoSummarize: false,
  embeddingModel: "",
  enabled: true,
  includeChatbot: true,
  maxContextEntries: 8,
  maxRetrievedMemories: 8,
  memoryToolModel: "__auto__",
  queryRewriting: true,
  shareAcrossProjects: true,
  similarityThreshold: 0.1
})
```

Add a legacy compatibility assertion:

```ts
expect(
  MemorySettingsSchema.parse({
    maxContextEntries: 5
  }).maxRetrievedMemories
).toBe(5)
```

- [ ] **Step 2: Run the focused schema test and verify it fails**

Run:

```bash
rtk vp test run packages/rpc/test/schemas/memory.test.ts
```

Expected: fails because the new fields are not defined yet.

- [ ] **Step 3: Extend the schema**

In `packages/rpc/src/schemas/memory.ts`, add constants and defaults:

```ts
const MEMORY_TOOL_MODEL_AUTO = "__auto__" as const

export const MemorySettingsSchema = z
  .object({
    autoRetrieve: z.boolean().default(true),
    autoSummarize: z.boolean().default(false),
    embeddingModel: z.string().default(""),
    enabled: z.boolean().default(true),
    includeChatbot: z.boolean().default(true),
    maxContextEntries: z.number().int().min(1).max(20).default(8),
    maxRetrievedMemories: z.number().int().min(1).max(20).optional(),
    memoryToolModel: z.string().default(MEMORY_TOOL_MODEL_AUTO),
    queryRewriting: z.boolean().default(true),
    shareAcrossProjects: z.boolean().default(true),
    similarityThreshold: z.number().min(0).max(1).default(0.1)
  })
  .transform((settings) => ({
    ...settings,
    maxRetrievedMemories:
      settings.maxRetrievedMemories ?? settings.maxContextEntries
  }))
```

- [ ] **Step 4: Update app settings defaults**

In `packages/rpc/src/schemas/settings.ts`, update `MEMORY_SETTINGS_DEFAULT` to the same values.

- [ ] **Step 5: Run schema tests**

Run:

```bash
rtk vp test run packages/rpc/test/schemas/memory.test.ts packages/rpc/test/schemas/settings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/rpc/src/schemas/memory.ts packages/rpc/src/schemas/settings.ts packages/rpc/test/schemas/memory.test.ts packages/rpc/test/schemas/settings.test.ts
rtk git commit -m "feat: extend memory settings schema"
```

## Task 2: Add Renderer Memory Helpers

**Files:**

- Create: `apps/desktop/src/renderer/lib/memory/embedding-model-catalog.ts`
- Create: `apps/desktop/src/renderer/lib/memory/memory-settings.ts`
- Create: `apps/desktop/src/renderer/lib/memory/memory-tool-model-options.ts`

- [ ] **Step 1: Create embedding catalog**

Add `embedding-model-catalog.ts`:

```ts
export interface LocalEmbeddingModelOption {
  downloadSize: string
  id: string
  installed: boolean
  label: string
}

export const DEFAULT_EMBEDDING_MODEL_ID = ""
export const DEFAULT_EMBEDDING_MODEL_LABEL = "text-embedding-3-small"

export const LOCAL_EMBEDDING_MODEL_OPTIONS = [
  {
    downloadSize: "~23 MB",
    id: "local:minilm-l6-v2",
    installed: true,
    label: "MiniLM L6 v2"
  },
  {
    downloadSize: "~33 MB",
    id: "local:bge-small-en-v1.5",
    installed: false,
    label: "BGE Small EN v1.5"
  },
  {
    downloadSize: "~118 MB",
    id: "local:multilingual-e5-small",
    installed: true,
    label: "Multilingual E5 Small"
  },
  {
    downloadSize: "~118 MB",
    id: "local:paraphrase-multilingual-minilm",
    installed: false,
    label: "Paraphrase Multilingual MiniLM"
  }
] as const satisfies readonly LocalEmbeddingModelOption[]
```

- [ ] **Step 2: Create settings helpers**

Add `memory-settings.ts`:

```ts
export const MEMORY_MAX_RETRIEVED_MEMORIES_MAX = 20
export const MEMORY_MAX_RETRIEVED_MEMORIES_MIN = 1
export const MEMORY_SIMILARITY_THRESHOLD_MAX = 100
export const MEMORY_SIMILARITY_THRESHOLD_MIN = 0

export const clampMaxRetrievedMemories = (value: number): number =>
  Math.min(
    MEMORY_MAX_RETRIEVED_MEMORIES_MAX,
    Math.max(MEMORY_MAX_RETRIEVED_MEMORIES_MIN, value)
  )

export const clampSimilarityThresholdPercent = (value: number): number =>
  Math.min(
    MEMORY_SIMILARITY_THRESHOLD_MAX,
    Math.max(MEMORY_SIMILARITY_THRESHOLD_MIN, value)
  )

export const formatSimilarityThreshold = (value: number): string =>
  `${Math.round(value * 100)}%`

export const percentToSimilarityThreshold = (value: number): number =>
  clampSimilarityThresholdPercent(value) / 100

export const similarityThresholdToPercent = (value: number): number =>
  clampSimilarityThresholdPercent(Math.round(value * 100))
```

- [ ] **Step 3: Create memory tool model helpers**

Add `memory-tool-model-options.ts`:

```ts
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"

export const MEMORY_TOOL_MODEL_AUTO_VALUE = "__auto__"

export const getMemoryToolModelSelectedValue = (value: string): string =>
  value || MEMORY_TOOL_MODEL_AUTO_VALUE

export const normalizeMemoryToolModelValue = (
  value: string | number | null
): string =>
  value === null || value === MEMORY_TOOL_MODEL_AUTO_VALUE ? "" : String(value)

export const findChatModelLabel = (
  modelGroups: ChatModelGroup[],
  value: string
): string | null =>
  modelGroups
    .flatMap((group) => group.options)
    .find((option) => option.value === value)?.label ?? null
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
rtk vp run website#check-types
```

Expected: PASS or no new errors from these files.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/desktop/src/renderer/lib/memory/embedding-model-catalog.ts apps/desktop/src/renderer/lib/memory/memory-settings.ts apps/desktop/src/renderer/lib/memory/memory-tool-model-options.ts
rtk git commit -m "feat: add memory settings helpers"
```

## Task 3: Enhance Memory Tab UI

**Files:**

- Modify: `apps/desktop/src/renderer/components/settings/memory-tab.tsx`
- Modify: `apps/desktop/src/renderer/components/settings-page.tsx`

- [ ] **Step 1: Add props for model groups**

Change `MemoryTabProps`:

```ts
interface MemoryTabProps {
  memory: MemorySettings
  modelGroups: ChatModelGroup[]
  onChange: (memory: MemorySettings) => void
}
```

Update `settings-page.tsx`:

```tsx
<MemoryTab
  memory={draft.memory}
  modelGroups={channelModelGroups}
  onChange={handleMemoryChange}
/>
```

- [ ] **Step 2: Add controls**

In `memory-tab.tsx`, add:

- `Memory Summarization` section with `autoSummarize` and `memoryToolModel`.
- `Memory Retrieval` section with `autoRetrieve`, nested `queryRewriting`, `maxRetrievedMemories`, and `similarityThreshold`.
- `Embedding Model` section with default and local model modal.

The UI should use HeroUI v3 compound components already used in this repo:

```tsx
import {
  Button,
  Dialog,
  Input,
  Label,
  ListBox,
  Select,
  Slider,
  Switch
} from "@heroui/react"
```

For sliders:

```tsx
<Slider
  maxValue={20}
  minValue={1}
  onChange={handleMaxRetrievedMemoriesChange}
  value={memory.maxRetrievedMemories}
>
  <Label>{t("settings.memory.retrieval.maxRetrievedMemories.label")}</Label>
  <Slider.Track>
    <Slider.Fill />
    <Slider.Thumb />
  </Slider.Track>
</Slider>
```

- [ ] **Step 3: Keep legacy status**

Keep the existing memory store status section:

- total entries,
- last updated,
- recent entries preview.

- [ ] **Step 4: Run typecheck**

Run:

```bash
rtk vp run website#check-types
```

Expected: PASS or only unrelated existing errors.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/desktop/src/renderer/components/settings/memory-tab.tsx apps/desktop/src/renderer/components/settings-page.tsx
rtk git commit -m "feat: enhance memory settings tab"
```

## Task 4: Add I18n Copy

**Files:**

- Modify: `packages/i18n/src/locales/en-US/translation.json`
- Modify: `packages/i18n/src/locales/zh-CN/translation.json`
- Modify: `packages/i18n/src/locales/ja-JP/translation.json`

- [ ] **Step 1: Add English copy**

Add keys under `settings.memory`:

```json
{
  "embedding": {
    "description": "The embedding model used for semantic search. Leave empty to use the default (text-embedding-3-small).",
    "localModels": "Local Models",
    "searchPlaceholder": "Search embedding models...",
    "title": "Embedding Model"
  },
  "retrieval": {
    "autoRetrieve": {
      "description": "Automatically search and inject relevant memories before each conversation.",
      "label": "Auto Retrieve Memories"
    },
    "queryRewriting": {
      "description": "Use the Memory Tool Model to optimize your message before searching memories.",
      "label": "Query Rewriting"
    },
    "similarityThreshold": {
      "description": "Minimum similarity score required for a memory to be retrieved.",
      "label": "Similarity Threshold"
    }
  },
  "summarization": {
    "description": "Use the Memory Tool Model to extract durable summaries, decisions, and facts.",
    "title": "Memory Summarization"
  },
  "toolModel": {
    "auto": "Auto",
    "description": "Used for memory summarization, query rewriting, and future auto compact summaries.",
    "label": "Memory Tool Model"
  }
}
```

- [ ] **Step 2: Add Chinese and Japanese equivalents**

Translate the same keys and keep object keys sorted alphabetically.

- [ ] **Step 3: Run i18n/package check**

Run:

```bash
rtk vp run check-types
```

Expected: PASS or no new i18n typing errors.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/i18n/src/locales/en-US/translation.json packages/i18n/src/locales/zh-CN/translation.json packages/i18n/src/locales/ja-JP/translation.json
rtk git commit -m "feat: add memory settings copy"
```

## Task 5: Update Documentation

**Files:**

- Modify: `doc/ai.md`
- Modify: `doc/settings.md`
- Modify: `doc/database.md`
- Modify: `doc/api-spec.md`
- Modify: `doc/rpc.md`

- [ ] **Step 1: Update AI docs**

Document the new memory pipeline:

```markdown
## Memory Enhancement Pipeline

Memory uses `Capture -> Summarize -> Embed -> Retrieve -> Inject -> Maintain`.
The renderer controls settings only. Main process runtime owns summarization,
embedding generation, hybrid retrieval, and lifecycle maintenance.
```

- [ ] **Step 2: Update settings docs**

Document the `Memory` tab sections and explicitly state `Auto Compact` belongs to phase 7 `Chat` settings.

- [ ] **Step 3: Update database docs**

Document planned fields and `memory_embeddings`.

- [ ] **Step 4: Update API spec and RPC docs**

Add the new memory settings fields and future embedding model status procedures.

- [ ] **Step 5: Commit**

```bash
rtk git add doc/ai.md doc/settings.md doc/database.md doc/api-spec.md doc/rpc.md
rtk git commit -m "docs: update memory enhancement docs"
```

## Task 6: Runtime Memory Tool Model

**Files:**

- Create: `apps/desktop/src/main/memory/tool-model.ts`
- Test: `apps/desktop/test/main/memory/tool-model.test.ts`

- [ ] **Step 1: Write model resolver tests**

Test `__auto__` chooses the first enabled provider with usable credentials and available models. Test concrete model ids pass through. Test missing credentials return a diagnostic.

- [ ] **Step 2: Implement resolver**

Export:

```ts
export interface MemoryToolModelResolution {
  diagnostic: string | null
  modelId: string | null
}

export const resolveMemoryToolModel = (
  settings: AppSettings
): MemoryToolModelResolution => {
  // implementation uses settings.memory.memoryToolModel and settings.ai.providers
}
```

- [ ] **Step 3: Commit**

```bash
rtk git add apps/desktop/src/main/memory/tool-model.ts apps/desktop/test/main/memory/tool-model.test.ts
rtk git commit -m "feat: resolve memory tool model"
```

## Task 7: Query Rewriting and Summarization Runtime

**Files:**

- Create: `apps/desktop/src/main/memory/prompts.ts`
- Create: `apps/desktop/src/main/memory/summarization.ts`
- Modify: `apps/desktop/src/main/memory.ts`
- Test: `apps/desktop/test/main/memory/summarization.test.ts`

- [ ] **Step 1: Add prompts**

Create prompts for query rewriting and structured memory extraction. Require JSON output with `summary`, `decisions`, `facts`, `procedures`, and `confidence`.

- [ ] **Step 2: Add fallback behavior**

When model calls fail or parsing fails, return deterministic compact memory content from the current implementation.

- [ ] **Step 3: Wire chat and Telegram writes**

Update chat and Telegram upsert paths so `autoSummarize` enables structured summary generation before storing memory entries.

- [ ] **Step 4: Commit**

```bash
rtk git add apps/desktop/src/main/memory/prompts.ts apps/desktop/src/main/memory/summarization.ts apps/desktop/src/main/memory.ts apps/desktop/test/main/memory/summarization.test.ts
rtk git commit -m "feat: add memory summarization runtime"
```

## Task 8: Embedding Runtime and Local Catalog

**Files:**

- Create: `apps/desktop/src/main/memory/embedding-models.ts`
- Create: `apps/desktop/src/main/memory/embeddings.ts`
- Modify: `apps/desktop/src/main/rpc/router.ts`
- Modify: `packages/rpc/src/schemas/memory.ts`
- Test: `apps/desktop/test/main/memory/embeddings.test.ts`

- [ ] **Step 1: Add local model status RPC schema**

Expose installed state, size, model id, and download status.

- [ ] **Step 2: Add embedding abstraction**

Create an interface:

```ts
export interface MemoryEmbeddingProvider {
  embed: (input: string) => Promise<number[]>
  model: string
}
```

- [ ] **Step 3: Persist embeddings**

Add `memory_embeddings` and store vectors as JSON.

- [ ] **Step 4: Commit**

```bash
rtk git add apps/desktop/src/main/memory/embedding-models.ts apps/desktop/src/main/memory/embeddings.ts apps/desktop/src/main/rpc/router.ts packages/rpc/src/schemas/memory.ts apps/desktop/test/main/memory/embeddings.test.ts
rtk git commit -m "feat: add memory embeddings runtime"
```

## Task 9: Hybrid Retrieval and Lifecycle

**Files:**

- Create: `apps/desktop/src/main/memory/retrieval.ts`
- Create: `apps/desktop/src/main/memory/lifecycle.ts`
- Modify: `apps/desktop/src/main/memory.ts`
- Test: `apps/desktop/test/main/memory/retrieval.test.ts`

- [ ] **Step 1: Move current retrieval into focused module**

Keep existing behavior passing before adding vector scoring.

- [ ] **Step 2: Add hybrid scoring**

Combine lexical score, vector similarity, recency, access count, scope, and strength.

- [ ] **Step 3: Add lifecycle helpers**

Implement dedupe, decay, archive, stale embedding stats, and rebuild diagnostics.

- [ ] **Step 4: Commit**

```bash
rtk git add apps/desktop/src/main/memory/retrieval.ts apps/desktop/src/main/memory/lifecycle.ts apps/desktop/src/main/memory.ts apps/desktop/test/main/memory/retrieval.test.ts
rtk git commit -m "feat: add hybrid memory retrieval"
```

## Task 10: Auto Compact Chat Settings

**Files:**

- Create: `apps/desktop/src/renderer/components/settings/chat-tab.tsx`
- Modify: `apps/desktop/src/renderer/lib/settings-page/nav-config.ts`
- Modify: `apps/desktop/src/renderer/components/settings-page.tsx`
- Modify: `packages/rpc/src/schemas/settings.ts`
- Test: `packages/rpc/test/schemas/settings.test.ts`

- [ ] **Step 1: Add chat settings schema**

Add:

```ts
export const ChatSettingsSchema = z.object({
  autoCompact: z
    .object({
      enabled: z.boolean().default(true),
      keepRecentMessages: z.number().int().min(2).max(20).default(4),
      threshold: z.number().min(5).max(95).default(80)
    })
    .default({
      enabled: true,
      keepRecentMessages: 4,
      threshold: 80
    })
})
```

- [ ] **Step 2: Add Chat tab**

Add controls matching the reference image:

- enable auto compact,
- compaction threshold slider,
- keep recent messages input.

- [ ] **Step 3: Wire runtime trigger**

Use the shared summary pipeline to compact old chat messages when context use exceeds threshold.

- [ ] **Step 4: Commit**

```bash
rtk git add apps/desktop/src/renderer/components/settings/chat-tab.tsx apps/desktop/src/renderer/lib/settings-page/nav-config.ts apps/desktop/src/renderer/components/settings-page.tsx packages/rpc/src/schemas/settings.ts packages/rpc/test/schemas/settings.test.ts
rtk git commit -m "feat: add auto compact settings"
```

## Final Verification

- [ ] Run schema tests:

```bash
rtk vp test run packages/rpc/test/schemas/memory.test.ts packages/rpc/test/schemas/settings.test.ts
```

- [ ] Run desktop checks:

```bash
rtk vp run website#check-types
rtk vp run server#check-types
```

- [ ] Run full check if the focused checks pass:

```bash
rtk vp check
```

- [ ] Document any pre-existing failure separately from new failures.
