import type {
  AiProviderConfig,
  AiProviderName,
  AppSettings,
  StoredProviderModel
} from "@etyon/rpc"
import { MEMORY_TOOL_MODEL_AUTO_VALUE } from "@etyon/rpc"

import { BUILT_IN_PROVIDER_CATALOG } from "@/shared/providers/provider-catalog"

export interface MemoryToolModelResolution {
  diagnostic: null | string
  modelId: null | string
}

interface ParsedModelId {
  model: string
  provider: AiProviderName
}

interface ScoredModel {
  model: StoredProviderModel
  modelId: string
  score: number
}

const CHEAP_MODEL_KEYWORDS = [
  "cheap",
  "flash",
  "haiku",
  "lite",
  "mini",
  "small"
]

const EXPENSIVE_MODEL_KEYWORDS = [
  "large",
  "max",
  "opus",
  "pro",
  "sonnet",
  "ultra"
]

const MEMORY_TOOL_PROVIDER_ORDER: AiProviderName[] = [
  "openai",
  "gateway",
  "moonshot",
  "zai-coding-plan",
  "anthropic",
  "cursor"
]

const PROVIDER_IDS = new Set(
  BUILT_IN_PROVIDER_CATALOG.map((provider) => provider.id)
)

const isProviderName = (value: string): value is AiProviderName =>
  PROVIDER_IDS.has(value as AiProviderName)

const getProviderModels = (
  providerConfig: AiProviderConfig
): StoredProviderModel[] =>
  providerConfig.models.length > 0
    ? providerConfig.models
    : providerConfig.availableModels

const hasProviderCredential = (providerConfig: AiProviderConfig): boolean =>
  Boolean(providerConfig.apiKey.trim())

const isSupportedMemoryToolProvider = (provider: AiProviderName): boolean =>
  provider !== "cursor"

const parseMemoryToolModelId = (
  modelId: string,
  defaultProvider: AiProviderName
): ParsedModelId | null => {
  const slashIndex = modelId.indexOf("/")

  if (slashIndex === -1) {
    return {
      model: modelId,
      provider: defaultProvider
    }
  }

  const provider = modelId.slice(0, slashIndex)
  const model = modelId.slice(slashIndex + 1)

  if (!(provider && model && isProviderName(provider))) {
    return null
  }

  return {
    model,
    provider
  }
}

const scoreModelName = (model: StoredProviderModel): number => {
  const normalizedName = `${model.id} ${model.name}`.toLowerCase()
  const cheapScore = CHEAP_MODEL_KEYWORDS.some((keyword) =>
    normalizedName.includes(keyword)
  )
    ? 30
    : 0
  const expensivePenalty = EXPENSIVE_MODEL_KEYWORDS.some((keyword) =>
    normalizedName.includes(keyword)
  )
    ? 20
    : 0

  return cheapScore - expensivePenalty
}

const scoreModelCapabilities = (model: StoredProviderModel): number => {
  const contextWindow = model.capabilities?.contextWindow ?? 0
  const contextScore = Math.min(12, Math.floor(contextWindow / 32_000) * 2)

  return (
    (model.capabilities?.jsonMode ? 18 : 0) +
    (model.capabilities?.functionCalling ? 8 : 0) +
    (model.capabilities?.streaming ? 4 : 0) +
    (model.capabilities?.reasoning ? 3 : 0) +
    contextScore
  )
}

const scoreMemoryToolModel = (model: StoredProviderModel): number =>
  scoreModelName(model) + scoreModelCapabilities(model)

const resolveConcreteMemoryToolModel = ({
  modelId,
  settings
}: {
  modelId: string
  settings: AppSettings
}): MemoryToolModelResolution => {
  const parsedModel = parseMemoryToolModelId(
    modelId,
    settings.ai.defaultProvider
  )

  if (!parsedModel) {
    return {
      diagnostic: `Memory Tool Model "${modelId}" is not a valid model id.`,
      modelId: null
    }
  }

  const providerConfig = settings.ai.providers[parsedModel.provider]

  if (!isSupportedMemoryToolProvider(parsedModel.provider)) {
    return {
      diagnostic: `Provider "${parsedModel.provider}" is not supported for memory tool calls yet.`,
      modelId: null
    }
  }

  if (!providerConfig.enabled) {
    return {
      diagnostic: `Provider "${parsedModel.provider}" is disabled.`,
      modelId: null
    }
  }

  if (!hasProviderCredential(providerConfig)) {
    return {
      diagnostic: `Provider "${parsedModel.provider}" is missing an API Key.`,
      modelId: null
    }
  }

  return {
    diagnostic: null,
    modelId: `${parsedModel.provider}/${parsedModel.model}`
  }
}

const getAutoProviderOrder = (
  defaultProvider: AiProviderName
): AiProviderName[] => [
  defaultProvider,
  ...MEMORY_TOOL_PROVIDER_ORDER.filter(
    (provider) => provider !== defaultProvider
  )
]

const resolveAutoMemoryToolModel = (
  settings: AppSettings
): MemoryToolModelResolution => {
  const scoredModels: ScoredModel[] = []

  for (const provider of getAutoProviderOrder(settings.ai.defaultProvider)) {
    const providerConfig = settings.ai.providers[provider]

    if (
      !isSupportedMemoryToolProvider(provider) ||
      !providerConfig.enabled ||
      !hasProviderCredential(providerConfig)
    ) {
      continue
    }

    for (const model of getProviderModels(providerConfig)) {
      scoredModels.push({
        model,
        modelId: `${provider}/${model.id}`,
        score: scoreMemoryToolModel(model)
      })
    }
  }

  const [bestModel] = scoredModels.toSorted((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return left.modelId.localeCompare(right.modelId)
  })

  if (bestModel) {
    return {
      diagnostic: null,
      modelId: bestModel.modelId
    }
  }

  return {
    diagnostic:
      "No enabled AI provider with API Key and memory tool models is configured.",
    modelId: null
  }
}

export const resolveMemoryToolModel = (
  settings: AppSettings
): MemoryToolModelResolution => {
  const configuredModel = settings.memory.memoryToolModel

  if (configuredModel && configuredModel !== MEMORY_TOOL_MODEL_AUTO_VALUE) {
    return resolveConcreteMemoryToolModel({
      modelId: configuredModel,
      settings
    })
  }

  return resolveAutoMemoryToolModel(settings)
}
