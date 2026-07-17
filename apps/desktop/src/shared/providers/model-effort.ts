import type {
  AiProviderName,
  ModelEffortSettings,
  StoredProviderModel
} from "@etyon/rpc"

/**
 * Reasoning-effort mapping, scoped to the two providers whose installed AI SDK
 * integrations accept an effort knob: Anthropic (`effort`) and OpenAI
 * (`reasoningEffort`). Every other built-in provider (moonshot/zai/gateway/
 * cursor) is intentionally out of scope and resolves to `null`.
 *
 * A stored model's `capabilities.reasoning` is authoritative when present, but
 * OpenAI's `/v1/models` returns no capability metadata, so the gate falls back
 * to an id heuristic (mirroring `image-output.ts`: explicit capability wins,
 * regex fallback otherwise).
 *
 * Dependency-free (types only) so it is safe in both the main and renderer
 * processes and node-testable.
 */

// Element-type annotations keep these tuples aligned with the zod enums in
// `@etyon/rpc`; if a provider's effort enum drifts, these become type errors.
export const ANTHROPIC_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const satisfies readonly ModelEffortSettings["anthropic"][]

export const OPENAI_EFFORT_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh"
] as const satisfies readonly ModelEffortSettings["openai"][]

export type AnthropicEffortLevel = ModelEffortSettings["anthropic"]
export type OpenAiEffortLevel = ModelEffortSettings["openai"]
export type EffortProviderId = "anthropic" | "openai"

export type EffortProviderOptions =
  | { anthropic: { effort: AnthropicEffortLevel } }
  | {
      openai: {
        reasoningEffort: OpenAiEffortLevel
        reasoningSummary?: "auto"
        store?: boolean
      }
    }

export const DEFAULT_MODEL_EFFORT: ModelEffortSettings = {
  anthropic: "high",
  openai: "medium"
}

const ANTHROPIC_MODEL_ID_PATTERN = /^claude/iu
// The openai provider also fronts OpenAI-compatible relays that serve Claude
// models; those requests still speak `reasoning_effort` on the wire (the relay
// translates), so claude-* ids gate as "openai" here.
const OPENAI_REASONING_MODEL_ID_PATTERN = /^(?:o[134]|gpt-5|claude)/iu

/**
 * Which effort provider (if any) governs a given model selection. Only
 * Anthropic and OpenAI expose an effort knob; any other provider returns null.
 * The effort vocabulary follows the *provider* (wire format), not the model
 * family.
 */
export const getEffortProviderId = ({
  model,
  providerId
}: {
  model: Pick<StoredProviderModel, "capabilities" | "id">
  providerId: AiProviderName
}): EffortProviderId | null => {
  if (providerId === "anthropic") {
    return (model.capabilities?.reasoning ??
      ANTHROPIC_MODEL_ID_PATTERN.test(model.id))
      ? "anthropic"
      : null
  }

  if (providerId === "openai") {
    return (model.capabilities?.reasoning ??
      OPENAI_REASONING_MODEL_ID_PATTERN.test(model.id))
      ? "openai"
      : null
  }

  return null
}

export const getEffortLevels = (
  effortProviderId: EffortProviderId
): readonly AnthropicEffortLevel[] | readonly OpenAiEffortLevel[] =>
  effortProviderId === "anthropic"
    ? ANTHROPIC_EFFORT_LEVELS
    : OPENAI_EFFORT_LEVELS

/**
 * The AI SDK `providerOptions` object for the selected model's effort setting,
 * or `undefined` when the provider has no effort knob.
 */
export const resolveEffortProviderOptions = ({
  model,
  modelEffort,
  providerId
}: {
  model: Pick<StoredProviderModel, "capabilities" | "id">
  modelEffort: ModelEffortSettings
  providerId: AiProviderName
}): EffortProviderOptions | undefined => {
  const effortProviderId = getEffortProviderId({ model, providerId })

  if (effortProviderId === "anthropic") {
    // "high" is the Claude API default (documented as equivalent to omitting
    // the parameter), so omit it: Claude models the id-heuristic gate lets
    // through but that predate `output_config.effort` (Haiku, pre-4.5) keep
    // working at the default slider position instead of erroring on every turn.
    return modelEffort.anthropic === "high"
      ? undefined
      : { anthropic: { effort: modelEffort.anthropic } }
  }

  if (effortProviderId === "openai") {
    return { openai: { reasoningEffort: modelEffort.openai } }
  }

  return undefined
}
