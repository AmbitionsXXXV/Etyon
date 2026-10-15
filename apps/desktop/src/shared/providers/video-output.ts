import type { BuiltInProviderId, StoredProviderModel } from "@etyon/rpc"

/**
 * Whether a model produces video (so the composer's Video skill can target
 * it). Only the Seedance family for now: relays list it next to chat models
 * with no capability flag, so the id is the only signal.
 *
 * Dependency-free (types only) so it is safe in both the main and renderer
 * processes and node-testable.
 */
const VIDEO_OUTPUT_MODEL_ID_PATTERN = /seedance/iu

export const isVideoOutputModel = (
  model: Pick<StoredProviderModel, "id">
): boolean => VIDEO_OUTPUT_MODEL_ID_PATTERN.test(model.id)

const isAmuxBaseURL = (baseURL: string): boolean => {
  try {
    const { hostname } = new URL(baseURL)

    return hostname === "amux.ai" || hostname.endsWith(".amux.ai")
  } catch {
    return false
  }
}

/**
 * Video renders through amux's task API, so a provider can serve it when it
 * is the Amux provider or an OpenAI provider whose base URL points at amux.
 */
export const canProviderRenderVideo = (
  providerId: BuiltInProviderId,
  baseURL: string
): boolean =>
  providerId === "amux" || (providerId === "openai" && isAmuxBaseURL(baseURL))
