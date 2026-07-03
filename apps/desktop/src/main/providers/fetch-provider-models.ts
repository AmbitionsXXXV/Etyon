import type {
  ProviderFetchModelsInput,
  ProviderFetchModelsOutput,
  StoredProviderModel,
  StoredProviderModelCapabilities
} from "@etyon/rpc"

import { createProxyAwareFetch } from "@/main/proxy/proxy-fetch"
import { getSettings } from "@/main/settings"
import {
  getProviderCatalogEntry,
  getProviderSeedModels,
  resolveProviderBaseURL
} from "@/shared/providers/provider-catalog"

const FETCH_TIMEOUT_MS = 15_000

const buildModelsEndpoint = (baseURL: string, modelsApiPath: string) =>
  `${baseURL.replace(/\/+$/u, "")}/${modelsApiPath.replace(/^\/+/u, "")}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const normalizeBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : undefined

const normalizeNumber = (value: unknown) =>
  typeof value === "number" ? value : undefined

// Capability flags arrive either as a flat boolean (OpenAI-compatible
// providers) or nested as `{ supported: boolean }` (Anthropic's Models API).
// Read both shapes from one place.
const readSupportedFlag = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value
  }

  if (isRecord(value)) {
    return normalizeBoolean(value.supported)
  }

  return undefined
}

const compactCapabilities = (
  capabilities?: StoredProviderModelCapabilities
): Partial<StoredProviderModelCapabilities> => {
  if (!capabilities) {
    return {}
  }

  const compactedCapabilities: Partial<StoredProviderModelCapabilities> = {}

  if (capabilities.contextWindow !== undefined) {
    compactedCapabilities.contextWindow = capabilities.contextWindow
  }

  if (capabilities.functionCalling !== undefined) {
    compactedCapabilities.functionCalling = capabilities.functionCalling
  }

  if (capabilities.imageOutput !== undefined) {
    compactedCapabilities.imageOutput = capabilities.imageOutput
  }

  if (capabilities.jsonMode !== undefined) {
    compactedCapabilities.jsonMode = capabilities.jsonMode
  }

  if (capabilities.maxOutputTokens !== undefined) {
    compactedCapabilities.maxOutputTokens = capabilities.maxOutputTokens
  }

  if (capabilities.reasoning !== undefined) {
    compactedCapabilities.reasoning = capabilities.reasoning
  }

  if (capabilities.streaming !== undefined) {
    compactedCapabilities.streaming = capabilities.streaming
  }

  if (capabilities.vision !== undefined) {
    compactedCapabilities.vision = capabilities.vision
  }

  return compactedCapabilities
}

const mergeCapabilities = (
  fetchedCapabilities?: StoredProviderModelCapabilities,
  seedCapabilities?: StoredProviderModelCapabilities
): StoredProviderModelCapabilities | undefined => {
  const mergedCapabilities = {
    ...compactCapabilities(seedCapabilities),
    ...compactCapabilities(fetchedCapabilities)
  }

  return Object.keys(mergedCapabilities).length > 0
    ? mergedCapabilities
    : undefined
}

const normalizeCapabilities = (
  model: Record<string, unknown>
): StoredProviderModelCapabilities | undefined => {
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {}

  const normalized: StoredProviderModelCapabilities = {
    // Anthropic reports the context window at the model top level
    // (`max_input_tokens`); OpenAI-compatible providers nest it under
    // `capabilities`.
    contextWindow:
      normalizeNumber(capabilities.contextWindow) ??
      normalizeNumber(capabilities.context_window) ??
      normalizeNumber(model.max_input_tokens) ??
      normalizeNumber(model.context_length),
    functionCalling:
      readSupportedFlag(capabilities.functionCalling) ??
      readSupportedFlag(capabilities.function_calling) ??
      readSupportedFlag(capabilities.tool_use),
    imageOutput:
      readSupportedFlag(capabilities.imageOutput) ??
      readSupportedFlag(capabilities.image_output),
    // Anthropic calls JSON mode "structured outputs".
    jsonMode:
      readSupportedFlag(capabilities.jsonMode) ??
      readSupportedFlag(capabilities.json_mode) ??
      readSupportedFlag(capabilities.structured_outputs),
    maxOutputTokens:
      normalizeNumber(capabilities.maxOutputTokens) ??
      normalizeNumber(capabilities.max_output_tokens) ??
      normalizeNumber(model.max_tokens),
    reasoning:
      readSupportedFlag(capabilities.reasoning) ??
      readSupportedFlag(capabilities.thinking),
    streaming: readSupportedFlag(capabilities.streaming),
    // Anthropic's vision ("view image") flag is `image_input`.
    vision:
      readSupportedFlag(capabilities.vision) ??
      readSupportedFlag(capabilities.image_input)
  }

  return Object.values(normalized).some((value) => value !== undefined)
    ? normalized
    : undefined
}

const normalizeModel = (model: unknown): StoredProviderModel | null => {
  if (typeof model === "string") {
    return {
      capabilities: undefined,
      id: model,
      isManual: undefined,
      name: model
    }
  }

  if (!isRecord(model) || typeof model.id !== "string") {
    return null
  }

  // Anthropic returns the human-readable label as `display_name`;
  // OpenAI-compatible providers use `name`.
  const name =
    (typeof model.name === "string" && model.name) ||
    (typeof model.display_name === "string" && model.display_name) ||
    model.id

  return {
    capabilities: normalizeCapabilities(model),
    id: model.id,
    isManual: undefined,
    name
  }
}

const getCandidateModels = (payload: unknown): unknown[] | null => {
  if (Array.isArray(payload)) {
    return payload
  }

  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data
  }

  if (isRecord(payload) && Array.isArray(payload.models)) {
    return payload.models
  }

  return null
}

const normalizeModelsPayload = (payload: unknown): StoredProviderModel[] => {
  const candidateModels = getCandidateModels(payload)

  if (!candidateModels) {
    throw new Error("Provider models response is not a valid models list.")
  }

  const modelsById = new Map<string, StoredProviderModel>()

  for (const candidateModel of candidateModels) {
    const normalizedModel = normalizeModel(candidateModel)

    if (!normalizedModel) {
      continue
    }

    modelsById.set(normalizedModel.id, normalizedModel)
  }

  return [...modelsById.values()]
}

const filterExcludedModels = (
  models: StoredProviderModel[],
  modelIdExcludePattern?: RegExp
): StoredProviderModel[] => {
  if (!modelIdExcludePattern) {
    return models
  }

  return models.filter((model) => !modelIdExcludePattern.test(model.id))
}

const readErrorMessage = async (response: Response): Promise<string> => {
  const responseText = await response.text()

  if (!responseText) {
    return `Request failed with status ${response.status}.`
  }

  try {
    const parsed = JSON.parse(responseText) as unknown

    if (isRecord(parsed) && typeof parsed.error === "string") {
      return parsed.error
    }
  } catch {
    return responseText
  }

  return responseText
}

const withSeedFallbacks = (
  models: StoredProviderModel[],
  providerId: ProviderFetchModelsInput["provider"]["providerId"]
): StoredProviderModel[] => {
  const seedModelsById = new Map(
    getProviderSeedModels(providerId).map((model) => [model.id, model])
  )

  return models.map((model) => {
    const seedModel = seedModelsById.get(model.id)

    if (!seedModel) {
      return model
    }

    return {
      capabilities: mergeCapabilities(
        model.capabilities,
        seedModel.capabilities
      ),
      id: model.id,
      isManual: model.isManual,
      name: model.name || seedModel.name
    }
  })
}

export const fetchProviderModels = async ({
  provider
}: ProviderFetchModelsInput): Promise<ProviderFetchModelsOutput> => {
  if (provider.providerId === "cursor") {
    const { fetchCursorModels } = await import("@/main/cursor-auth/service")

    return fetchCursorModels()
  }

  const apiKey = provider.apiKey.trim()

  if (!apiKey) {
    throw new Error("API Key is required before fetching models.")
  }

  const catalogEntry = getProviderCatalogEntry(provider.providerId)
  const controller = new AbortController()
  const endpoint = buildModelsEndpoint(
    resolveProviderBaseURL(provider.providerId, {
      baseURL: provider.baseURL,
      region: provider.region
    }),
    catalogEntry.modelsApiPath
  )
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const { proxy } = getSettings()
  const proxyAwareFetch = createProxyAwareFetch(proxy)

  try {
    const response = await proxyAwareFetch(endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      method: "GET",
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }

    const payload = (await response.json()) as unknown

    return {
      models: withSeedFallbacks(
        filterExcludedModels(
          normalizeModelsPayload(payload),
          catalogEntry.modelIdExcludePattern
        ),
        provider.providerId
      )
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Fetching provider models timed out.", { cause: error })
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
