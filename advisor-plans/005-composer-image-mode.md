# 005 — Composer image mode: direct generation with image-output models (nano banana)

> Feature design handoff (2026-07-08, branch `feat/agent-event-sourcing`), authored by Fable after user sign-off on the architecture. Not part of the 2026-06-14 audit batch. Executor: implement in the working tree directly (no worktree isolation — the dev app at CDP :9333 hot-reloads for acceptance). Read fully before starting; honor STOP conditions.

## Product decision (user-confirmed, do not re-litigate)

- **Architecture: "选图像模型直出" (direct generation).** The composer gets an _Image_ toggle next to the model selector. It is only usable when the **selected chat model** is image-output-capable (e.g. `gemini-2.5-flash-image` — Nano Banana, `gpt-image-2`, `gemini-3-pro-image-preview`). When ON, the turn bypasses the LLM chat/agent loop entirely: the user's message text goes straight to the provider's Images API with the selected model, and the result renders through the **existing** inline imagen pipeline (skeleton → inline image → lightbox).
- **v1 scope: text→image only.** No reference-image input, no multi-turn image editing (explicitly deferred).
- Rejected alternatives (for the record): gating the `imagen` tool per-session with a configurable backend; hybrid auto-routing. The user chose direct generation for zero LLM overhead and literal "disable by selected model capability" semantics.

## Why (user's real setup)

The user's `openai` provider is an OpenAI-compatible aggregator (`https://api.amux.ai/v1`). Their curated `models` list already mixes image models into the chat selector: `gpt-image-2`, `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`, `gpt-image-2-official`, `MiniMax-Image-01`. Today selecting one does nothing useful, and the `imagen` tool hardcodes `gpt-image-2`, which has failed on this aggregator before ("分组 auto 下模型 gpt-image-2 的可用渠道不存在"). This feature makes those selector entries first-class.

## Current state (verified anchors)

- `apps/desktop/src/main/server/lib/providers.ts` — `resolveModel(modelId?)` parses compound ids `provider/model` via `parseModelId`; `resolveImageModel()` hardcodes `IMAGE_MODEL_ID = "gpt-image-2"` on the `openai` provider; `isImageGenerationAvailable()` gates the imagen tool.
- `apps/desktop/src/main/agents/minimal/imagen-tool.ts` — `buildImagenTool(workspace)`: zod schema (prompt/quality/size/title), `generateImage` + `workspace.writeBinaryFile` under `generated-images/`, returns `{byteLength, kind:"image", model, path, prompt, quality, size, title}`.
- `apps/desktop/src/main/server/routes/chat.ts` — POST `/chat` body `{agentMode, mentions, messages, model, sessionId}`; resolves `effectiveModelId = requestedModelId ?? session.modelId`; calls `prepareAgentChatContext`, `startAgentRun` (when agents enabled), then `buildChatStreamResponse` with `onFinishPersist` → `replaceChatMessages`.
- `apps/desktop/src/main/server/routes/build-chat-stream-response.ts` — `createUIMessageStreamResponse({stream: createUIMessageStream({execute({writer}), onError: describeChatStreamError, onFinish → onFinishPersist(attachWorkTimeToLatestAssistantMessage(...)), originalMessages})})`. `writeRequestPhase(writer, "model-start" | "agent-turn")` writes the `CHAT_REQUEST_PHASE_DATA_TYPE` data chunk the live-status UI keys off.
- `apps/desktop/src/main/agents/minimal/agent-loop.ts` — precedent for writing raw `UIMessageChunk`s to the writer (`{type:"finish"}`, `{type:"error", errorText}`, custom data chunks) and merging `result.toUIMessageStream(...)`.
- `packages/rpc/src/schemas/providers.ts` — `StoredProviderModelCapabilities` **already has `imageOutput?: boolean`** (currently `false` in seeds, normalized from `image_output` in `apps/desktop/src/main/providers/fetch-provider-models.ts`).
- `apps/desktop/src/renderer/lib/chat/model-options.ts` — `ChatModelOption` carries `capabilities`; `buildModelSummary` renders plain-English badges ("Vision", "Tools", …).
- `apps/desktop/src/renderer/routes/chat.$sessionId.tsx` — `buildChatRequestOptions` (~line 1305) builds the request body; the composer `footer` (~line 1844, and a second occurrence ~line 2009 — **update both**) holds `<ModelSelector …/>` inside `<div className="flex items-center gap-3">`.
- `apps/desktop/src/renderer/components/chat/prompt-input.tsx` — `PromptInputAgentModeControl` (~line 575) is the ToggleButton precedent: `@heroui/react` `ToggleButton`, `h-8 min-w-0 shrink-0 px-2.5 text-xs`, HugeiconsIcon size 14, per-state selected class.
- `apps/desktop/src/shared/providers/provider-catalog.ts` — `OPENAI_NON_CHAT_MODEL_ID_PATTERN` currently excludes `dall-e|image` ids from fetched model lists.
- Renderer imagen rendering (`renderer/lib/chat/imagen-message.ts`, `renderer/components/chat/imagen-message.tsx`) — **do not modify**; just verified end-to-end. `getImagenPartState` reads tool parts of type `tool-imagen`: input `{title, size?}` while `state==="input-available"`, output `{path, title, size?}` when `output-available`, `errorText` on `output-error`/`output-denied`.
- Pre-existing noise: bare `tsc --noEmit` reports ~35 unrelated errors (sidebar/routes implicit-any). Gate on "no NEW errors referencing changed files".

## Design

### 1. Shared capability helper — `apps/desktop/src/shared/providers/image-output.ts` (new)

```ts
import type { StoredProviderModel } from "@etyon/rpc"

// Explicit capability wins; otherwise recognize image-output families by id.
// Covers: gpt-image-*, dall-e-*, gemini-*-image*, *nano-banana*, imagen-*,
// flux, seedream, MiniMax-Image-01. Does NOT match seedance (video) or plain
// vision models.
const IMAGE_OUTPUT_MODEL_ID_PATTERN =
  /image|imagen|banana|dall-e|flux|seedream/iu

export const isImageOutputModel = (
  model: Pick<StoredProviderModel, "capabilities" | "id">
): boolean =>
  model.capabilities?.imageOutput ??
  IMAGE_OUTPUT_MODEL_ID_PATTERN.test(model.id)
```

Used by: renderer toggle state, renderer model badge, server routing validation. Keep it dependency-free (node-testable; no `window`, no rpc — see repo memory on renderer module organization; `shared/` is safe for both processes).

### 2. Renderer — toggle state lib `apps/desktop/src/renderer/lib/chat/image-mode.ts` (new, node-tested)

```ts
export const getImageModeToggleDisabled = ({
  isCapable,
  isModelUpdating,
  isRequestPending
}) => !isCapable || isModelUpdating || isRequestPending

// On model change: capable model newly selected → auto-ON (pure image models
// can't chat, so defaulting ON prevents a guaranteed-failing send); switching
// to a non-capable model → forced OFF; otherwise keep the user's choice.
export const resolveImageModeForModelChange = ({
  isCapable,
  previous,
  wasCapable
}) => {
  if (!isCapable) return false
  if (!wasCapable) return true
  return previous
}
```

State behavior table (implement exactly):

| Event | Toggle |
| --- | --- |
| Session opens with image-capable model selected | ON |
| Session opens with normal chat model | OFF + disabled |
| Switch gpt-5.5 → gemini-2.5-flash-image | auto-ON (still user-toggleable) |
| Switch gemini-…-image → gpt-5.5 | forced OFF + disabled |
| User toggles OFF with image model selected | stays OFF (plain chat-completions turn with that model — allowed; behavior is whatever the provider does) |
| Request pending / model updating | disabled (frozen) |

State lives in `chat.$sessionId.tsx` component state (like `agentMode`), re-derived per selected model via the helper — **no DB migration, no settings persistence**.

### 3. Renderer — toggle UI

In `chat.$sessionId.tsx`, both composer `footer` blocks: add the toggle inside the existing `flex items-center gap-3` div, after `<ModelSelector/>`. Follow the `PromptInputAgentModeControl` visual recipe:

- `ToggleButton` from `@heroui/react`, `size="sm"`, `className="h-8 min-w-0 shrink-0 px-2.5 text-xs"`, selected state class like the agent-mode control's (primary-tinted when ON).
- Icon: a Hugeicons **free** image icon at size 14 (verify the exact export in `node_modules/@hugeicons/core-free-icons/dist/types/index.d.ts` — e.g. `Image01Icon` / `ImageAdd01Icon`; grep, don't guess) + text label `t("chat.imageMode.label")`.
- `isSelected={isImageMode}`, `onPress` flips it, `isDisabled` from `getImageModeToggleDisabled`.
- Tooltip: follow the conditional-tooltip precedent in `project-context-panel.tsx` (~line 306: disabled → render button bare; enabled → wrap in `Tooltip`/`Tooltip.Trigger`/`Tooltip.Content`). Enabled tooltip: `t("chat.imageMode.tooltip")`. Keep `aria-label` on the button in both cases; when disabled, use `t("chat.imageMode.unsupported")` as the aria-label so the reason is still discoverable.
- If the two footer occurrences share enough props, extract a small local component in `chat.$sessionId.tsx` rather than a new file — mirror how `ModelSelector` is used twice.

Model selector badge: in `renderer/lib/chat/model-options.ts` `buildModelSummary`, prepend `"Image"` when `isImageOutputModel(model)` (plain string, consistent with the existing non-i18n badges).

### 4. Request plumbing

- `buildChatRequestOptions` (~line 1305): add `imageMode: isImageMode || undefined` to the body.
- `chat.ts` request parse: read `imageMode` (`body.imageMode === true`).

### 5. Server routing — `chat.ts`

After resolving `effectiveModelId`, **before** `prepareAgentChatContext`/`startAgentRun`:

```ts
if (imageMode && isImageOutputModelSelection(settings.ai, effectiveModelId)) {
  return buildImageGenerationStreamResponse({ … })   // no agent run, no agent context
}
```

`isImageOutputModelSelection(aiSettings, compoundId)`: parse `compoundId` with the same `parseModelId` semantics (default provider fallback), look up the `StoredProviderModel` by id in that provider's `models` then `availableModels`, and return `isImageOutputModel(entry)`; if no entry found, apply the heuristic to the bare model id. Put it next to `isImageOutputModel` in `shared/providers/image-output.ts` **only if** it can stay free of main-only imports — otherwise as a local helper in `providers.ts`. If `imageMode` is set but the model is not capable, **fall through silently** to the normal chat path (the renderer already prevents this; server re-validation is a safety net, not an error surface).

### 6. Direct generation stream — `apps/desktop/src/main/server/routes/build-image-generation-response.ts` (new)

Signature (mirror `BuildChatStreamResponseOptions` style):

```ts
buildImageGenerationStreamResponse({
  abortSignal, messages, modelValue /* compound id */, onFinishPersist,
  projectPath, requestStartedAt, sessionId
}): Response
```

Inside `createUIMessageStream.execute({writer})`:

1. `writeRequestPhase(writer, "model-start")` — export `writeRequestPhase` from `build-chat-stream-response.ts` (or move it to a small shared module) rather than duplicating; reusing the `model-start` phase keeps `renderer/lib/chat/live-status.ts` untouched.
2. Derive `prompt` = latest user message text. `getLatestUserMessageText` is currently local to `chat.ts` — export it from there (or move it next to the new builder) instead of duplicating.
3. Write the assistant message manually as `UIMessageChunk`s (the writer accepts them; `agent-loop.ts` is the precedent for raw writes):
   - `{type: "start"}`, `{type: "start-step"}`
   - `{type: "tool-input-available", toolCallId, toolName: "imagen", input: { prompt, title }}` where `toolCallId` = `generateId()` from `ai` (or `imagen-${randomUUID()}`), `title` = first line of the prompt truncated to ~60 chars (pure helper, fine to keep local). **No `size` in input** → the renderer skeleton falls back to a square aspect (verified default in `parseImageAspectRatio`).
   - `try`: `const output = await generateAndPersistImage(…)` → `{type: "tool-output-available", toolCallId, output}`.
   - `catch`: `{type: "tool-output-error", toolCallId, errorText: describeChatStreamError(error)}` (reuse the exported formatter). Do not rethrow — finish the stream cleanly.
   - `{type: "finish-step"}`, `{type: "finish"}`.
4. `onError: describeChatStreamError`, `originalMessages: messages`, and `onFinish` → `onFinishPersist(attachWorkTimeToLatestAssistantMessage(nextMessages, Date.now() - requestStartedAt))` — mirroring `buildChatStreamResponse` exactly, minus the agent-outcome argument (pass `null` or drop the param at the `chat.ts` call site: `onFinishPersist` there should just `replaceChatMessages` without agent-run bookkeeping).

Acceptance-critical: the resulting persisted assistant message must contain a part that `isImagenToolPart` recognizes (`type === "tool-imagen"`, or `dynamic-tool` + `toolName === "imagen"`) with `state` reaching `output-available` and `output.path` set — that is the entire contract with the untouched renderer. If manually-written chunks come out as a different part `type`, STOP (see below).

### 7. Image model resolution + shared generation core

`providers.ts`:

```ts
export const resolveImageModelById = (compoundId: string): ImageModel => {
  // parseModelId with aiSettings.defaultProvider, like resolveModel
  // provider "openai" → createOpenAI({apiKey, baseURL: resolveProviderBaseURL(...), fetch: proxyAwareFetch}).image(model)
  // provider "gateway" → createGateway({apiKey, fetch}).imageModel(model)
  // anything else → throw `Provider "${provider}" does not support image generation.`
}
```

New `apps/desktop/src/main/server/lib/image-generation.ts` — extract the imagen tool's execute body into a shared core so the tool and the direct route stay in lockstep:

```ts
generateAndPersistImage({
  abortSignal?, imageModel, modelIdForOutput, prompt, quality?, size?, title, workspace
}) → { byteLength, kind: "image", model, path, prompt, quality?, size?, title }
```

- `generateImage({ model: imageModel, n: 1, prompt, ...(size ? {size} : {}), ...(providerOptions) , abortSignal? })`.
- **Provider options are gpt-image-family-only**: include `providerOptions: {openai: {outputFormat: "png", quality}}` only when the bare model id starts with `gpt-image`; for gemini/nano-banana/other ids send _no_ `providerOptions` and _no_ `quality` (aggregators reject unknown params on non-OpenAI image models). The direct route passes neither `size` nor `quality` (provider defaults); the imagen tool keeps passing both from its schema.
- File extension from `image.mediaType` (`image/png`→`.png`, `image/jpeg`→`.jpg`, `image/webp`→`.webp`, default `.png`) — generalizes the current hardcoded `.png` in `buildImageArtifactPath`; keep `generated-images/` + slug + random suffix naming (move `slugifyImageTitle`/path builder into the core, re-export from the tool module if its tests import them — check `test/main/agents/imagen-tool.test.ts` imports first).
- `imagen-tool.ts` becomes a thin wrapper: schema + `generateAndPersistImage({imageModel: resolveImageModel(), modelIdForOutput: IMAGE_MODEL_ID, …})`. Its observable behavior must not change (existing tests keep passing, modulo import-path updates).

### 8. Catalog exclude pattern

`provider-catalog.ts`: change `OPENAI_NON_CHAT_MODEL_ID_PATTERN` to stop excluding image models — new value `/audio|babbage|davinci|embedding|moderation|realtime|transcribe|tts|whisper/iu` — and update its comment: image-output models are now selectable on purpose (the composer image mode uses them); everything else non-generative stays filtered.

### 9. i18n — `packages/i18n/src/locales/{en-US,zh-CN,ja-JP}/translation.json`

Add under `chat` (keep keys alphabetical within their object, matching file style):

| key | en-US | zh-CN | ja-JP |
| --- | --- | --- | --- |
| `chat.imageMode.label` | `Image` | `图像` | `画像` |
| `chat.imageMode.tooltip` | `Generate an image from your message` | `开启后，发送的消息将直接生成图片` | `オンにすると、メッセージから画像を生成します` |
| `chat.imageMode.unsupported` | `The selected model can't generate images` | `当前模型不支持图片生成` | `選択中のモデルは画像生成に対応していません` |

### 10. Tests

1. `image-output` helper — heuristic + explicit-capability override, using the user's real ids as cases: positive `gpt-image-2`, `gemini-2.5-flash-image`, `gemini-3-pro-image-preview`, `MiniMax-Image-01`, `nano-banana`; negative `gpt-5.5`, `claude-opus-4-8`, `gemini-3.5-flash`, `doubao-seedance-2.0`, `amux-stt-1.0`; override `{id:"weird", capabilities:{imageOutput:true}}` → true and `{id:"gpt-image-2", capabilities:{imageOutput:false}}` → false. Location: follow existing layout — shared-code tests live under `apps/desktop/test/` mirroring `src/` (grep for an existing `shared/` test to confirm the exact directory; create it consistently if absent).
2. `test/renderer/lib/chat/image-mode.test.ts` — the state table above, one assertion per row.
3. `test/main/agents/imagen-tool.test.ts` — must keep passing after the core extraction (update imports only if the plan moves symbols; do not weaken assertions).
4. Stream-builder unit test only if `test/main/server/` already has a `createUIMessageStream` harness precedent to mirror — otherwise skip; the CDP acceptance pass covers it.

## Explicitly out of scope (do not do)

- Reference-image input / multi-turn image editing (deferred v2).
- Changing the `imagen` tool's backend model, its schema, or the `/imagen` command semantics (beyond the shared-core extraction).
- Any edit to `renderer/lib/chat/imagen-message.ts`, `renderer/components/chat/imagen-message.tsx`, or `live-status.ts`.
- Size/quality pickers in the composer; toggle-state persistence in DB/settings.
- Touching the running dev app (it hot-reloads; leave it running for acceptance).

## STOP conditions

- The manually-written tool chunks do not surface as a `tool-imagen` part with `output-available` in the persisted message / renderer (e.g. the AI SDK version routes them as `dynamic-tool` with a different shape that `isImagenToolPart` rejects): STOP after checking `isImagenToolPart`'s dual matching (`tool-imagen` OR `dynamic-tool`+`toolName:"imagen"`); report the exact chunk/part shapes observed. Do not patch the renderer to fit.
- `ToggleButton` or a free Hugeicons image icon doesn't exist as assumed: grep the actual exports; if genuinely absent, STOP and report (don't substitute a plain Button silently).
- `createUIMessageStream` rejects raw writes of `tool-input-available`/`tool-output-available` chunk types (type error against `UIMessageChunk`): check the `ai` package's chunk union first; STOP if the shapes fundamentally mismatch.
- Anything requiring a DB migration: STOP (this design needs none).

## Done criteria

- `cd apps/desktop && vp check <changed files>` — no formatting/lint errors.
- `vp test test/renderer/lib/chat/image-mode.test.ts test/main/agents/imagen-tool.test.ts <image-output test>` — pass; `vp test test/main test/renderer` — no new failures.
- `npx tsc --noEmit` — no NEW errors referencing changed files (~35 pre-existing unrelated errors are the baseline).
- Behavior matches the state table in §2 and the routing in §5.
- Report back: files changed with one-line-each rationale, test results, any deviations from this plan.

Acceptance (performed by Fable after handback, via CDP against the running dev app): select `gemini-2.5-flash-image` → toggle auto-ON with primary tint → send a prompt → skeleton then inline image (live amux call) → lightbox regression; switch to `gpt-5.5` → toggle forced OFF + disabled with correct zh copy; `vp check`/tests/tsc gates re-run independently.
