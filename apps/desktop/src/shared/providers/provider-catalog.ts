import type {
  AiProviderConfig,
  AiSettings,
  BuiltInProviderId,
  StoredProviderModel
} from "@etyon/rpc"

import { BUILT_IN_PROVIDER_SEED_MODELS } from "./provider-seed-models"

interface ProviderCatalogEntry {
  baseURL: string
  id: BuiltInProviderId
  modelsApiPath: string
  name: string
  seedModels: StoredProviderModel[]
  settingsTab: boolean
  upstreamModelsApi: string
}

interface SettingsTabProviderCatalogEntry extends ProviderCatalogEntry {
  id: SettingsTabProviderId
}

export const SETTINGS_PROVIDER_IDS = ["moonshot", "zai-coding-plan"] as const

export type SettingsTabProviderId = (typeof SETTINGS_PROVIDER_IDS)[number]

const hasOwn = <TKey extends string>(
  key: TKey,
  value: unknown
): value is Record<TKey, unknown> =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key)

const cloneStoredProviderModel = (
  model: StoredProviderModel
): StoredProviderModel => ({
  capabilities: model.capabilities ? { ...model.capabilities } : undefined,
  id: model.id,
  isManual: model.isManual,
  name: model.name
})

const cloneStoredProviderModels = (models: StoredProviderModel[]) =>
  models.map(cloneStoredProviderModel)

const ANTHROPIC_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "",
  id: "anthropic",
  modelsApiPath: "models",
  name: "Anthropic",
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.anthropic,
  settingsTab: false,
  upstreamModelsApi: "GET /models"
}

const GATEWAY_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "",
  id: "gateway",
  modelsApiPath: "models",
  name: "AI Gateway",
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.gateway,
  settingsTab: false,
  upstreamModelsApi: "GET /models"
}

const MOONSHOT_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "https://api.moonshot.cn/v1",
  id: "moonshot",
  modelsApiPath: "models",
  name: "Moonshot",
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.moonshot,
  settingsTab: true,
  upstreamModelsApi: "GET /v1/models"
}

const OPENAI_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "",
  id: "openai",
  modelsApiPath: "models",
  name: "OpenAI",
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.openai,
  settingsTab: false,
  upstreamModelsApi: "GET /v1/models"
}

const ZAI_CODING_PLAN_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "https://api.z.ai/api/coding/paas/v4",
  id: "zai-coding-plan",
  modelsApiPath: "models",
  name: "Z.AI Coding Plan",
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS["zai-coding-plan"],
  settingsTab: true,
  upstreamModelsApi: "GET /models"
}

export const BUILT_IN_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  ANTHROPIC_PROVIDER_CATALOG_ENTRY,
  GATEWAY_PROVIDER_CATALOG_ENTRY,
  MOONSHOT_PROVIDER_CATALOG_ENTRY,
  OPENAI_PROVIDER_CATALOG_ENTRY,
  ZAI_CODING_PLAN_PROVIDER_CATALOG_ENTRY
]

export const BUILT_IN_PROVIDER_CATALOG_BY_ID: Record<
  BuiltInProviderId,
  ProviderCatalogEntry
> = {
  anthropic: ANTHROPIC_PROVIDER_CATALOG_ENTRY,
  gateway: GATEWAY_PROVIDER_CATALOG_ENTRY,
  moonshot: MOONSHOT_PROVIDER_CATALOG_ENTRY,
  openai: OPENAI_PROVIDER_CATALOG_ENTRY,
  "zai-coding-plan": ZAI_CODING_PLAN_PROVIDER_CATALOG_ENTRY
}

const hydrateProviderConfig = (
  config: AiProviderConfig,
  providerId: BuiltInProviderId,
  rawProvider: unknown
): AiProviderConfig => {
  const catalogEntry = BUILT_IN_PROVIDER_CATALOG_BY_ID[providerId]
  const seedModels = cloneStoredProviderModels(catalogEntry.seedModels)

  return {
    ...config,
    availableModels: hasOwn("availableModels", rawProvider)
      ? config.availableModels
      : seedModels,
    baseURL: config.baseURL || catalogEntry.baseURL,
    models: hasOwn("models", rawProvider) ? config.models : seedModels
  }
}

export const getProviderCatalogEntry = (providerId: BuiltInProviderId) =>
  BUILT_IN_PROVIDER_CATALOG_BY_ID[providerId]

export const getProviderSeedModels = (providerId: BuiltInProviderId) =>
  cloneStoredProviderModels(
    BUILT_IN_PROVIDER_CATALOG_BY_ID[providerId].seedModels
  )

export const getSettingsTabProviders = (): SettingsTabProviderCatalogEntry[] =>
  SETTINGS_PROVIDER_IDS.map(
    (providerId) =>
      BUILT_IN_PROVIDER_CATALOG_BY_ID[
        providerId
      ] as SettingsTabProviderCatalogEntry
  )

export const hydrateAiSettingsProviders = (
  aiSettings: AiSettings,
  rawAiSettings: unknown
): AiSettings => {
  const rawProviders = hasOwn("providers", rawAiSettings)
    ? rawAiSettings.providers
    : undefined

  return {
    ...aiSettings,
    providers: {
      anthropic: hydrateProviderConfig(
        aiSettings.providers.anthropic,
        "anthropic",
        hasOwn("anthropic", rawProviders) ? rawProviders.anthropic : undefined
      ),
      gateway: hydrateProviderConfig(
        aiSettings.providers.gateway,
        "gateway",
        hasOwn("gateway", rawProviders) ? rawProviders.gateway : undefined
      ),
      moonshot: hydrateProviderConfig(
        aiSettings.providers.moonshot,
        "moonshot",
        hasOwn("moonshot", rawProviders) ? rawProviders.moonshot : undefined
      ),
      openai: hydrateProviderConfig(
        aiSettings.providers.openai,
        "openai",
        hasOwn("openai", rawProviders) ? rawProviders.openai : undefined
      ),
      "zai-coding-plan": hydrateProviderConfig(
        aiSettings.providers["zai-coding-plan"],
        "zai-coding-plan",
        hasOwn("zai-coding-plan", rawProviders)
          ? rawProviders["zai-coding-plan"]
          : undefined
      )
    }
  }
}
