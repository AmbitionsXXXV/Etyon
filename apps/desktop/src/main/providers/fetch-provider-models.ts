import type {
  ProviderFetchModelsInput,
  ProviderFetchModelsOutput,
  StoredProviderModel,
  StoredProviderModelCapabilities
} from "@etyon/rpc"

import {
  getProviderCatalogEntry,
  getProviderSeedModels
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
  capabilities: unknown
): StoredProviderModelCapabilities | undefined => {
  if (!isRecord(capabilities)) {
    return undefined
  }

  return {
    contextWindow:
      normalizeNumber(capabilities.contextWindow) ??
      normalizeNumber(capabilities.context_window),
    functionCalling:
      normalizeBoolean(capabilities.functionCalling) ??
      normalizeBoolean(capabilities.function_calling),
    imageOutput:
      normalizeBoolean(capabilities.imageOutput) ??
      normalizeBoolean(capabilities.image_output),
    jsonMode:
      normalizeBoolean(capabilities.jsonMode) ??
      normalizeBoolean(capabilities.json_mode),
    maxOutputTokens:
      normalizeNumber(capabilities.maxOutputTokens) ??
      normalizeNumber(capabilities.max_output_tokens),
    reasoning: normalizeBoolean(capabilities.reasoning),
    streaming: normalizeBoolean(capabilities.streaming),
    vision: normalizeBoolean(capabilities.vision)
  }
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

  return {
    capabilities: normalizeCapabilities(model.capabilities),
    id: model.id,
    isManual: undefined,
    name: typeof model.name === "string" ? model.name : model.id
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
  const apiKey = provider.apiKey.trim()

  if (!apiKey) {
    throw new Error("API Key is required before fetching models.")
  }

  const catalogEntry = getProviderCatalogEntry(provider.providerId)
  const controller = new AbortController()
  const endpoint = buildModelsEndpoint(
    provider.baseURL || catalogEntry.baseURL,
    catalogEntry.modelsApiPath
  )
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(endpoint, {
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
        normalizeModelsPayload(payload),
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
