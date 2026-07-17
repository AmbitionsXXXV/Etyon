import { createAnthropic } from "@ai-sdk/anthropic"
import { createGateway } from "@ai-sdk/gateway"
import { createOpenAI } from "@ai-sdk/openai"
import type {
  AiProviderConfig,
  AiSettings,
  BuiltInProviderId,
  ProxySettings
} from "@etyon/rpc"
import type { ImageModel, LanguageModel } from "ai"

import { createProxyAwareFetch } from "@/main/proxy/proxy-fetch"
import { getSettings } from "@/main/settings"
import { hasProviderCredential } from "@/shared/providers/credentials"
import { isImageOutputModel } from "@/shared/providers/image-output"
import { resolveEffortProviderOptions } from "@/shared/providers/model-effort"
import type { EffortProviderOptions } from "@/shared/providers/model-effort"
import { createMoonshotFetch } from "@/shared/providers/moonshot-reasoning"
import {
  BUILT_IN_PROVIDER_CATALOG,
  getProviderCatalogEntry,
  getProviderDefaultBaseURL,
  resolveOpenAiApiMode,
  resolveProviderBaseURL
} from "@/shared/providers/provider-catalog"

type ProviderName = BuiltInProviderId

const PROVIDER_PREFIX_MAP: Record<string, ProviderName> = {
  anthropic: "anthropic",
  cursor: "cursor",
  gateway: "gateway",
  moonshot: "moonshot",
  openai: "openai",
  "zai-coding-plan": "zai-coding-plan"
}

const getProviderModelId = (
  providerConfig: AiProviderConfig
): string | undefined => {
  const models =
    providerConfig.models.length > 0
      ? providerConfig.models
      : providerConfig.availableModels

  return models[0]?.id
}

const hasUsableProvider = (
  providerId: ProviderName,
  providerConfig: AiProviderConfig
): boolean => {
  const catalogEntry = getProviderCatalogEntry(providerId)

  return (
    providerConfig.enabled &&
    catalogEntry.runtimeReady &&
    hasProviderCredential(catalogEntry, providerConfig)
  )
}

const parseModelId = (
  modelId: string,
  defaultProvider: ProviderName
): { model: string; provider: ProviderName } => {
  const slashIndex = modelId.indexOf("/")

  if (slashIndex === -1) {
    return { model: modelId, provider: defaultProvider }
  }

  const prefix = modelId.slice(0, slashIndex)
  const model = modelId.slice(slashIndex + 1)
  const provider = PROVIDER_PREFIX_MAP[prefix]

  if (!provider) {
    throw new Error(`Unknown provider prefix: "${prefix}"`)
  }

  return { model, provider }
}

const resolveFallbackModelId = (aiSettings: AiSettings): string | null => {
  const providerCandidates = [
    aiSettings.defaultProvider,
    ...BUILT_IN_PROVIDER_CATALOG.map((provider) => provider.id).filter(
      (providerId) => providerId !== aiSettings.defaultProvider
    )
  ]

  for (const providerId of providerCandidates) {
    const providerConfig = aiSettings.providers[providerId]

    if (!hasUsableProvider(providerId, providerConfig)) {
      continue
    }

    const modelId = getProviderModelId(providerConfig)

    if (modelId) {
      return `${providerId}/${modelId}`
    }
  }

  return null
}

const resolveImplicitModelId = (aiSettings: AiSettings): string => {
  if (aiSettings.defaultModel) {
    const { provider } = parseModelId(
      aiSettings.defaultModel,
      aiSettings.defaultProvider
    )

    if (hasUsableProvider(provider, aiSettings.providers[provider])) {
      return aiSettings.defaultModel
    }
  }

  const fallbackModelId = resolveFallbackModelId(aiSettings)

  if (fallbackModelId) {
    return fallbackModelId
  }

  if (aiSettings.defaultModel) {
    return aiSettings.defaultModel
  }

  throw new Error("No enabled AI provider with an API Key is configured.")
}

const createProviderModel = (
  provider: ProviderName,
  model: string,
  aiSettings: AiSettings,
  proxy: ProxySettings
): LanguageModel => {
  const providerConfig = aiSettings.providers[provider]

  if (!providerConfig.enabled) {
    throw new Error(`Provider "${provider}" is disabled.`)
  }

  const proxyAwareFetch = createProxyAwareFetch(proxy)

  const createOpenAICompatibleChatModel = ({
    baseURL,
    fetch: customFetch
  }: {
    baseURL?: string
    fetch?: typeof fetch
  } = {}): LanguageModel => {
    const apiKey = providerConfig.apiKey.trim()

    if (!apiKey) {
      throw new Error(`Provider "${provider}" is missing an API Key.`)
    }

    const openai = createOpenAI({
      apiKey,
      name: provider,
      ...(baseURL ? { baseURL } : {}),
      fetch: customFetch ?? proxyAwareFetch
    })

    return openai.chat(model)
  }

  const createOpenAIResponsesModel = (baseURL?: string): LanguageModel => {
    const apiKey = providerConfig.apiKey.trim()

    if (!apiKey) {
      throw new Error(`Provider "${provider}" is missing an API Key.`)
    }

    const openai = createOpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      fetch: proxyAwareFetch
    })

    return openai(model)
  }

  switch (provider) {
    case "anthropic": {
      const apiKey = providerConfig.apiKey.trim()

      if (!apiKey) {
        throw new Error(`Provider "${provider}" is missing an API Key.`)
      }

      const anthropic = createAnthropic({ apiKey, fetch: proxyAwareFetch })

      return anthropic(model)
    }
    case "cursor": {
      throw new Error("Cursor provider runtime proxy is not configured yet.")
    }
    case "gateway": {
      const apiKey = providerConfig.apiKey.trim()

      if (!apiKey) {
        throw new Error(`Provider "${provider}" is missing an API Key.`)
      }

      const gateway = createGateway({ apiKey, fetch: proxyAwareFetch })

      return gateway(model)
    }
    case "moonshot": {
      return createOpenAICompatibleChatModel({
        baseURL: resolveProviderBaseURL(provider, providerConfig),
        fetch: createMoonshotFetch(proxyAwareFetch)
      })
    }
    case "openai": {
      const baseURL = resolveProviderBaseURL(provider, providerConfig)

      return resolveOpenAiApiMode(providerConfig, model) === "chat-completions"
        ? createOpenAICompatibleChatModel({ baseURL })
        : createOpenAIResponsesModel(baseURL)
    }
    case "zai-coding-plan": {
      return createOpenAICompatibleChatModel({
        baseURL: resolveProviderBaseURL(provider, providerConfig)
      })
    }
    default: {
      const _exhaustive: never = provider

      throw new Error(`Unsupported provider: ${_exhaustive}`)
    }
  }
}

export const resolveModel = (modelId?: string): LanguageModel => {
  const { ai: aiSettings, proxy } = getSettings()
  const effectiveModelId = modelId || resolveImplicitModelId(aiSettings)
  const { model, provider } = parseModelId(
    effectiveModelId,
    aiSettings.defaultProvider
  )

  return createProviderModel(provider, model, aiSettings, proxy)
}

// Image generation always runs through the OpenAI provider's Images API
// (gpt-image-*), independent of the session's chat model. It reuses the
// provider's key, base URL, and proxy-aware fetch, so a configured OpenAI
// endpoint (official or a compatible gateway) works without extra setup.
export const IMAGE_MODEL_ID = "gpt-image-2"

export const isImageGenerationAvailable = (): boolean =>
  hasUsableProvider("openai", getSettings().ai.providers.openai)

export const resolveImageModel = (): ImageModel => {
  const { ai: aiSettings, proxy } = getSettings()
  const providerConfig = aiSettings.providers.openai
  const apiKey = providerConfig.apiKey.trim()

  if (!apiKey) {
    throw new Error('Provider "openai" is missing an API Key.')
  }

  const openai = createOpenAI({
    apiKey,
    baseURL: resolveProviderBaseURL("openai", providerConfig),
    fetch: createProxyAwareFetch(proxy)
  })

  return openai.image(IMAGE_MODEL_ID)
}

// Direct composer image mode: resolve the *selected* chat model as an image
// model (unlike the imagen tool, which always targets gpt-image-2 on openai).
// Only providers with an Images API are supported.
export const resolveImageModelById = (compoundId: string): ImageModel => {
  const { ai: aiSettings, proxy } = getSettings()
  const { model, provider } = parseModelId(
    compoundId,
    aiSettings.defaultProvider
  )
  const providerConfig = aiSettings.providers[provider]
  const proxyAwareFetch = createProxyAwareFetch(proxy)

  if (provider === "openai") {
    const apiKey = providerConfig.apiKey.trim()

    if (!apiKey) {
      throw new Error('Provider "openai" is missing an API Key.')
    }

    const openai = createOpenAI({
      apiKey,
      baseURL: resolveProviderBaseURL("openai", providerConfig),
      fetch: proxyAwareFetch
    })

    return openai.image(model)
  }

  if (provider === "gateway") {
    const apiKey = providerConfig.apiKey.trim()

    if (!apiKey) {
      throw new Error('Provider "gateway" is missing an API Key.')
    }

    const gateway = createGateway({ apiKey, fetch: proxyAwareFetch })

    return gateway.imageModel(model)
  }

  throw new Error(`Provider "${provider}" does not support image generation.`)
}

// Safety-net re-validation for the composer image toggle: parse the compound id
// and check the matching stored model's capability (falling back to the id
// heuristic when the model is not in the catalog).
export const isImageOutputModelSelection = (
  aiSettings: AiSettings,
  compoundId: string
): boolean => {
  let parsed: { model: string; provider: ProviderName }

  try {
    parsed = parseModelId(compoundId, aiSettings.defaultProvider)
  } catch {
    return false
  }

  const providerConfig = aiSettings.providers[parsed.provider]
  const entry = [
    ...providerConfig.models,
    ...providerConfig.availableModels
  ].find((candidate) => candidate.id === parsed.model)

  return isImageOutputModel(entry ?? { id: parsed.model })
}

// Effort → AI SDK providerOptions for the current chat model selection. Mirrors
// isImageOutputModelSelection: parse the compound id, resolve the stored model
// (falling back to the id heuristic), then delegate to the shared effort
// resolver. Returns undefined when the provider has no effort knob or the id
// cannot be parsed.
export const resolveEffortProviderOptionsForSelection = (
  aiSettings: AiSettings,
  compoundId: string | null | undefined
): EffortProviderOptions | undefined => {
  if (!compoundId) {
    return undefined
  }

  let parsed: { model: string; provider: ProviderName }

  try {
    parsed = parseModelId(compoundId, aiSettings.defaultProvider)
  } catch {
    return undefined
  }

  const providerConfig = aiSettings.providers[parsed.provider]
  const entry = [
    ...providerConfig.models,
    ...providerConfig.availableModels
  ].find((candidate) => candidate.id === parsed.model)

  const base = resolveEffortProviderOptions({
    model: entry ?? { id: parsed.model },
    modelEffort: aiSettings.modelEffort,
    providerId: parsed.provider
  })

  // Responses-only: `reasoningSummary: "auto"` makes the (long) reasoning phase
  // visible in the stream. Excluded for Chat Completions / third-party relays
  // (they reject the parameter) and for effort "none" (a summary with reasoning
  // disabled risks a provider 400).
  //
  // Stateful relays don't persist Responses items, so `store: false` forces the
  // SDK to replay reasoning by value via encrypted_content instead of
  // item_reference ids (which 404 on relays); the SDK auto-requests
  // reasoning.encrypted_content once store is false. The official endpoint does
  // persist items, so it keeps the SDK's `store` default untouched.
  if (
    base &&
    "openai" in base &&
    parsed.provider === "openai" &&
    base.openai.reasoningEffort !== "none" &&
    resolveOpenAiApiMode(providerConfig, parsed.model) === "responses"
  ) {
    const isOfficialEndpoint =
      resolveProviderBaseURL("openai", providerConfig) ===
      getProviderDefaultBaseURL("openai")

    return {
      openai: {
        ...base.openai,
        reasoningSummary: "auto",
        ...(isOfficialEndpoint ? {} : { store: false })
      }
    }
  }

  return base
}
