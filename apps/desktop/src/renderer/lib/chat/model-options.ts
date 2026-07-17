import type {
  AiProviderName,
  AiSettings,
  StoredProviderModel
} from "@etyon/rpc"

import { formatContextWindowCompact } from "@/shared/providers/context-window"
import { hasProviderCredential } from "@/shared/providers/credentials"
import { resolveFunctionCallingSupport } from "@/shared/providers/function-calling"
import { isImageOutputModel } from "@/shared/providers/image-output"
import {
  BUILT_IN_PROVIDER_CATALOG,
  getProviderCatalogEntry
} from "@/shared/providers/provider-catalog"

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
  const compact = formatContextWindowCompact(contextWindow)

  return compact === null ? null : `${compact} ctx`
}

const resolveToolsSummaryTag = (model: StoredProviderModel): string | null => {
  switch (resolveFunctionCallingSupport(model)) {
    case "native": {
      return "Tools"
    }
    case "xml-middleware": {
      return "Tools (XML)"
    }
    default: {
      return null
    }
  }
}

const buildModelSummary = (model: StoredProviderModel): string =>
  [
    isImageOutputModel(model) ? "Image" : null,
    model.capabilities?.vision ? "Vision" : null,
    model.capabilities?.reasoning ? "Reasoning" : null,
    resolveToolsSummaryTag(model),
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
    .filter((group) => {
      const providerConfig = aiSettings.providers[group.providerId]
      const catalogEntry = getProviderCatalogEntry(group.providerId)

      return (
        providerConfig.enabled &&
        catalogEntry.runtimeReady &&
        hasProviderCredential(catalogEntry, providerConfig) &&
        group.options.length > 0
      )
    })
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

export const buildAiSettingsWithDefaultModel = (
  aiSettings: AiSettings,
  defaultModel: string
): AiSettings => ({
  ...aiSettings,
  defaultModel
})
