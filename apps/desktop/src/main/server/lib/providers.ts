import { createAnthropic } from "@ai-sdk/anthropic"
import { createGateway } from "@ai-sdk/gateway"
import { createOpenAI } from "@ai-sdk/openai"
import type { BuiltInProviderId } from "@etyon/rpc"
import type { LanguageModel } from "ai"

import { getSettings } from "@/main/settings"
import { getProviderCatalogEntry } from "@/shared/providers/provider-catalog"

type ProviderName = BuiltInProviderId

const PROVIDER_PREFIX_MAP: Record<string, ProviderName> = {
  anthropic: "anthropic",
  gateway: "gateway",
  moonshot: "moonshot",
  openai: "openai",
  "zai-coding-plan": "zai-coding-plan"
}

const parseModelId = (
  modelId: string
): { model: string; provider: ProviderName } => {
  const slashIndex = modelId.indexOf("/")

  if (slashIndex === -1) {
    const { ai } = getSettings()

    return { model: modelId, provider: ai.defaultProvider }
  }

  const prefix = modelId.slice(0, slashIndex)
  const model = modelId.slice(slashIndex + 1)
  const provider = PROVIDER_PREFIX_MAP[prefix]

  if (!provider) {
    throw new Error(`Unknown provider prefix: "${prefix}"`)
  }

  return { model, provider }
}

const createProviderModel = (
  provider: ProviderName,
  model: string
): LanguageModel => {
  const { ai: aiSettings } = getSettings()
  const providerConfig = aiSettings.providers[provider]

  if (!providerConfig.enabled) {
    throw new Error(`Provider "${provider}" is disabled.`)
  }

  const apiKey = providerConfig.apiKey.trim()

  if (!apiKey) {
    throw new Error(`Provider "${provider}" is missing an API Key.`)
  }

  const createOpenAICompatibleModel = (baseURL?: string) => {
    const openai = createOpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {})
    })

    return openai(model)
  }

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey })

      return anthropic(model)
    }
    case "gateway": {
      const gateway = createGateway({ apiKey })

      return gateway(model)
    }
    case "moonshot": {
      return createOpenAICompatibleModel(
        providerConfig.baseURL || getProviderCatalogEntry(provider).baseURL
      )
    }
    case "openai": {
      return createOpenAICompatibleModel(providerConfig.baseURL)
    }
    case "zai-coding-plan": {
      return createOpenAICompatibleModel(
        providerConfig.baseURL || getProviderCatalogEntry(provider).baseURL
      )
    }
    default: {
      const _exhaustive: never = provider

      throw new Error(`Unsupported provider: ${_exhaustive}`)
    }
  }
}

export const resolveModel = (modelId?: string): LanguageModel => {
  const { ai: aiSettings } = getSettings()
  const effectiveModelId = modelId || aiSettings.defaultModel || "openai/gpt-4o"
  const { model, provider } = parseModelId(effectiveModelId)

  return createProviderModel(provider, model)
}
