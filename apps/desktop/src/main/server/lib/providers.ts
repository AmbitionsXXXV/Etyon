import { createAnthropic } from "@ai-sdk/anthropic"
import { createGateway } from "@ai-sdk/gateway"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"

import { getSettings } from "@/main/settings"

type ProviderName = "anthropic" | "gateway" | "openai"

const PROVIDER_PREFIX_MAP: Record<string, ProviderName> = {
  anthropic: "anthropic",
  gateway: "gateway",
  openai: "openai"
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

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: aiSettings.providers.anthropic.apiKey
      })
      return anthropic(model)
    }
    case "gateway": {
      const gw = createGateway({
        apiKey: aiSettings.providers.gateway.apiKey
      })
      return gw(model)
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: aiSettings.providers.openai.apiKey
      })
      return openai(model)
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
