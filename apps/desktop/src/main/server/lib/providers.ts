import { createAnthropic } from "@ai-sdk/anthropic"
import { createGateway } from "@ai-sdk/gateway"
import { createOpenAI } from "@ai-sdk/openai"
import type {
  AiProviderConfig,
  AiSettings,
  BuiltInProviderId
} from "@etyon/rpc"
import type { LanguageModel } from "ai"

import { getSettings } from "@/main/settings"
import { createMoonshotFetch } from "@/shared/providers/moonshot-reasoning"
import {
  BUILT_IN_PROVIDER_CATALOG,
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

const hasUsableProvider = (providerConfig: AiProviderConfig): boolean =>
  providerConfig.enabled && Boolean(providerConfig.apiKey.trim())

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

    if (!hasUsableProvider(providerConfig)) {
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

    if (hasUsableProvider(aiSettings.providers[provider])) {
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
  aiSettings: AiSettings
): LanguageModel => {
  const providerConfig = aiSettings.providers[provider]

  if (!providerConfig.enabled) {
    throw new Error(`Provider "${provider}" is disabled.`)
  }

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
      ...(customFetch ? { fetch: customFetch } : {})
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
      ...(baseURL ? { baseURL } : {})
    })

    return openai(model)
  }

  switch (provider) {
    case "anthropic": {
      const apiKey = providerConfig.apiKey.trim()

      if (!apiKey) {
        throw new Error(`Provider "${provider}" is missing an API Key.`)
      }

      const anthropic = createAnthropic({ apiKey })

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

      const gateway = createGateway({ apiKey })

      return gateway(model)
    }
    case "moonshot": {
      return createOpenAICompatibleChatModel({
        baseURL: resolveProviderBaseURL(provider, providerConfig),
        fetch: createMoonshotFetch()
      })
    }
    case "openai": {
      return createOpenAIResponsesModel(providerConfig.baseURL)
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
  const { ai: aiSettings } = getSettings()
  const effectiveModelId = modelId || resolveImplicitModelId(aiSettings)
  const { model, provider } = parseModelId(
    effectiveModelId,
    aiSettings.defaultProvider
  )

  return createProviderModel(provider, model, aiSettings)
}
