import type { StoredProviderModel } from "@etyon/rpc"

/**
 * Whether a model produces images (so the composer's image mode can target it).
 * An explicit `imageOutput` capability always wins; otherwise the model id is
 * matched against known image-output families. Covers gpt-image-*, dall-e-*,
 * gemini-*-image*, *nano-banana*, imagen-*, flux, seedream, MiniMax-Image-01.
 * Does NOT match seedance (video) or plain vision models.
 *
 * Dependency-free (types only) so it is safe in both the main and renderer
 * processes and node-testable.
 */
const IMAGE_OUTPUT_MODEL_ID_PATTERN =
  /image|imagen|banana|dall-e|flux|seedream/iu

export const isImageOutputModel = (
  model: Pick<StoredProviderModel, "capabilities" | "id">
): boolean =>
  model.capabilities?.imageOutput ??
  IMAGE_OUTPUT_MODEL_ID_PATTERN.test(model.id)
