import type {
  AiProviderName,
  AiSettings,
  StoredProviderModel
} from "@etyon/rpc"

import { BUILT_IN_PROVIDER_CATALOG } from "@/shared/providers/provider-catalog"

export interface ChatModelOption {
  capabilities: StoredProviderModel["capabilities"]
  id: string
  label: string
  providerId: AiProviderName
  providerName: string
  summary: string
  value: string
}

export interface ChatModelGroup {
  options: ChatModelOption[]
  providerId: AiProviderName
  providerName: string
}

const formatContextWindow = (contextWindow?: number): string | null => {
  if (!contextWindow) {
    return null
  }

  if (contextWindow >= 1000) {
    return `${Math.round(contextWindow / 1000)}K ctx`
  }

  return `${contextWindow} ctx`
}

const buildModelSummary = (model: StoredProviderModel): string =>
  [
    model.capabilities?.vision ? "Vision" : null,
    model.capabilities?.reasoning ? "Reasoning" : null,
    model.capabilities?.functionCalling ? "Tools" : null,
    model.capabilities?.jsonMode ? "JSON" : null,
    model.capabilities?.streaming ? "Streaming" : null,
    formatContextWindow(model.capabilities?.contextWindow)
  ]
    .filter(Boolean)
    .join(" · ")

const normalizeProviderModels = (
  models: StoredProviderModel[]
): StoredProviderModel[] => {
  const seenModelIds = new Set<string>()

  return models.filter((model) => {
    if (seenModelIds.has(model.id)) {
      return false
    }

    seenModelIds.add(model.id)

    return true
  })
}

export const buildChatModelGroups = (
  aiSettings: AiSettings
): ChatModelGroup[] =>
  BUILT_IN_PROVIDER_CATALOG.map((provider) => {
    const providerConfig = aiSettings.providers[provider.id]
    const candidateModels =
      providerConfig.models.length > 0
        ? providerConfig.models
        : providerConfig.availableModels

    return {
      options: normalizeProviderModels(candidateModels).map((model) => ({
        capabilities: model.capabilities,
        id: model.id,
        label: model.name,
        providerId: provider.id,
        providerName: provider.name,
        summary: buildModelSummary(model),
        value: `${provider.id}/${model.id}`
      })),
      providerId: provider.id,
      providerName: provider.name
    }
  })
    .filter(
      (group) =>
        aiSettings.providers[group.providerId].enabled &&
        group.options.length > 0
    )
    .toSorted((left, right) =>
      left.providerName.localeCompare(right.providerName)
    )

export const resolveChatModelValue = ({
  defaultModel,
  groups,
  sessionModelId
}: {
  defaultModel: string
  groups: ChatModelGroup[]
  sessionModelId: string | null
}): string => {
  const allOptions = groups.flatMap((group) => group.options)
  const availableValues = new Set(allOptions.map((option) => option.value))

  if (sessionModelId && availableValues.has(sessionModelId)) {
    return sessionModelId
  }

  if (defaultModel && availableValues.has(defaultModel)) {
    return defaultModel
  }

  return allOptions[0]?.value ?? ""
}
