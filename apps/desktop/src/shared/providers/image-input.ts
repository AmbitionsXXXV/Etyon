import type { StoredProviderModel } from "@etyon/rpc"

/**
 * Whether a model can *see* images (so the composer may attach image input to
 * a message). An explicit `vision` capability always wins; otherwise the model
 * id is matched against known vision-capable families. This mirrors
 * image-output.ts, but for input: the provider catalog already exposes a
 * `vision` capability flag (surfaced as the "Vision" badge in model-options),
 * so that is the explicit signal — there is no separate `imageInput` flag.
 *
 * The id heuristic is intentionally conservative — it only matches families
 * that are multimodal across their whole line, so a bare chat/text model is
 * never mistaken for a vision model:
 * - Anthropic Claude 3/4 (opus / sonnet / haiku are all multimodal)
 * - OpenAI gpt-4o, gpt-4.1, gpt-5, and the o3 / o4 reasoning line
 * - Google Gemini (1.5 / 2 / 2.5 / 3 accept image input)
 * - Open-weight vision models: Pixtral, Qwen-VL, LLaVA
 * - Moonshot Kimi vision (kimi-vl, k2.5) and any id explicitly tagged "vision"
 *
 * Dependency-free (types only) so it is safe in both the main and renderer
 * processes and node-testable.
 */
const IMAGE_INPUT_MODEL_ID_PATTERN =
  /vision|claude-3|opus|sonnet|haiku|gpt-4o|gpt-4\.1|gpt-5|\bo[34]\b|gemini|pixtral|qwen[\w.-]*-vl|llava|kimi-vl|kimi-k2[.-]5/iu

export const isImageInputModel = (
  model: Pick<StoredProviderModel, "capabilities" | "id">
): boolean =>
  model.capabilities?.vision ?? IMAGE_INPUT_MODEL_ID_PATTERN.test(model.id)
