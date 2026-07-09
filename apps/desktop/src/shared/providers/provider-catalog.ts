import type { TranslationKey } from "@etyon/i18n"
import type {
  AiProviderConfig,
  AiSettings,
  BuiltInProviderId,
  StoredProviderModel
} from "@etyon/rpc"

import {
  getDefaultMoonshotBaseURL,
  resolveMoonshotBaseURL,
  resolveMoonshotRegion
} from "./moonshot-region"
import { BUILT_IN_PROVIDER_SEED_MODELS } from "./provider-seed-models"

type ProviderCredentialKind = "apiKey" | "oauth"

// OpenAI's /v1/models list includes non-generative models (audio, embedding,
// moderation, legacy completion) alongside chat models. Filter those out of the
// picker. Image-output models are intentionally kept selectable — the composer
// image mode targets them directly.
const OPENAI_NON_CHAT_MODEL_ID_PATTERN =
  /audio|babbage|davinci|embedding|moderation|realtime|transcribe|tts|whisper/iu

interface ProviderCatalogEntry {
  baseURL: string
  credential: ProviderCredentialKind
  descriptionKey?: TranslationKey
  id: BuiltInProviderId
  modelIdExcludePattern?: RegExp
  modelsApiPath: string
  name: string
  runtimeReady: boolean
  seedModels: StoredProviderModel[]
  settingsTab: boolean
  upstreamModelsApi: string
}

interface SettingsTabProviderCatalogEntry extends ProviderCatalogEntry {
  descriptionKey: TranslationKey
  id: SettingsTabProviderId
}

export const SETTINGS_PROVIDER_IDS = [
  "openai",
  "cursor",
  "moonshot",
  "zai-coding-plan"
] as const

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
  credential: "apiKey",
  id: "anthropic",
  modelsApiPath: "models",
  name: "Anthropic",
  runtimeReady: true,
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.anthropic,
  settingsTab: false,
  upstreamModelsApi: "GET /models"
}

const CURSOR_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "",
  credential: "oauth",
  descriptionKey: "settings.providers.provider.cursor.description",
  id: "cursor",
  modelsApiPath: "",
  name: "Cursor",
  runtimeReady: false,
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.cursor,
  settingsTab: true,
  upstreamModelsApi: "Cursor OAuth"
}

const GATEWAY_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "",
  credential: "apiKey",
  id: "gateway",
  modelsApiPath: "models",
  name: "AI Gateway",
  runtimeReady: true,
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.gateway,
  settingsTab: false,
  upstreamModelsApi: "GET /models"
}

const MOONSHOT_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "https://api.moonshot.cn/v1",
  credential: "apiKey",
  descriptionKey: "settings.providers.provider.moonshot.description",
  id: "moonshot",
  modelsApiPath: "models",
  name: "Moonshot",
  runtimeReady: true,
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.moonshot,
  settingsTab: true,
  upstreamModelsApi: "GET /v1/models"
}

const OPENAI_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "https://api.openai.com/v1",
  credential: "apiKey",
  descriptionKey: "settings.providers.provider.openai.description",
  id: "openai",
  modelIdExcludePattern: OPENAI_NON_CHAT_MODEL_ID_PATTERN,
  modelsApiPath: "models",
  name: "OpenAI",
  runtimeReady: true,
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS.openai,
  settingsTab: true,
  upstreamModelsApi: "GET /v1/models"
}

const ZAI_CODING_PLAN_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  baseURL: "https://api.z.ai/api/coding/paas/v4",
  credential: "apiKey",
  descriptionKey: "settings.providers.provider.zaiCodingPlan.description",
  id: "zai-coding-plan",
  modelsApiPath: "models",
  name: "Z.AI Coding Plan",
  runtimeReady: true,
  seedModels: BUILT_IN_PROVIDER_SEED_MODELS["zai-coding-plan"],
  settingsTab: true,
  upstreamModelsApi: "GET /models"
}

export const BUILT_IN_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  ANTHROPIC_PROVIDER_CATALOG_ENTRY,
  CURSOR_PROVIDER_CATALOG_ENTRY,
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
  cursor: CURSOR_PROVIDER_CATALOG_ENTRY,
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

const hydrateMoonshotProviderConfig = (
  config: AiProviderConfig,
  rawProvider: unknown
): AiProviderConfig => {
  const hydratedConfig = hydrateProviderConfig(config, "moonshot", rawProvider)
  const region = resolveMoonshotRegion(
    hydratedConfig.region,
    hydratedConfig.baseURL
  )

  return {
    ...hydratedConfig,
    baseURL: resolveMoonshotBaseURL(hydratedConfig.baseURL, region),
    region
  }
}

export const getProviderCatalogEntry = (providerId: BuiltInProviderId) =>
  BUILT_IN_PROVIDER_CATALOG_BY_ID[providerId]

export const getProviderDefaultBaseURL = (
  providerId: BuiltInProviderId,
  providerConfig?: Pick<AiProviderConfig, "region">
): string =>
  providerId === "moonshot"
    ? getDefaultMoonshotBaseURL(providerConfig?.region)
    : BUILT_IN_PROVIDER_CATALOG_BY_ID[providerId].baseURL

export const getProviderSeedModels = (providerId: BuiltInProviderId) =>
  cloneStoredProviderModels(
    BUILT_IN_PROVIDER_CATALOG_BY_ID[providerId].seedModels
  )

export const resolveProviderBaseURL = (
  providerId: BuiltInProviderId,
  providerConfig: Pick<AiProviderConfig, "baseURL" | "region">
): string => {
  if (providerId === "moonshot") {
    return resolveMoonshotBaseURL(providerConfig.baseURL, providerConfig.region)
  }

  return providerConfig.baseURL || getProviderDefaultBaseURL(providerId)
}

/**
 * An explicit apiMode always wins. Without one, only the official OpenAI
 * endpoint defaults to the Responses API: third-party OpenAI-compatible
 * gateways generally implement /chat/completions fully but reject or silently
 * drop the Responses API's HTTP multi-turn tool continuation (item_reference
 * resolution), which strands agent tool loops after the first step.
 */
export const resolveOpenAiApiMode = (
  providerConfig: Pick<AiProviderConfig, "apiMode" | "baseURL" | "region">
): "chat-completions" | "responses" => {
  if (providerConfig.apiMode) {
    return providerConfig.apiMode
  }

  return resolveProviderBaseURL("openai", providerConfig) ===
    getProviderDefaultBaseURL("openai")
    ? "responses"
    : "chat-completions"
}

export const getSettingsTabProviders = (): SettingsTabProviderCatalogEntry[] =>
  SETTINGS_PROVIDER_IDS.map(
    (providerId) =>
      BUILT_IN_PROVIDER_CATALOG_BY_ID[
        providerId
      ] as SettingsTabProviderCatalogEntry
  )

const hydrateProviderConfigById = (
  providerId: BuiltInProviderId,
  config: AiProviderConfig,
  rawProviders: unknown
): AiProviderConfig => {
  const rawProvider = hasOwn(providerId, rawProviders)
    ? rawProviders[providerId]
    : undefined

  return providerId === "moonshot"
    ? hydrateMoonshotProviderConfig(config, rawProvider)
    : hydrateProviderConfig(config, providerId, rawProvider)
}

export const hydrateAiSettingsProviders = (
  aiSettings: AiSettings,
  rawAiSettings: unknown
): AiSettings => {
  const rawProviders = hasOwn("providers", rawAiSettings)
    ? rawAiSettings.providers
    : undefined

  const hydratedProviders = Object.fromEntries(
    BUILT_IN_PROVIDER_CATALOG.map((catalogEntry) => [
      catalogEntry.id,
      hydrateProviderConfigById(
        catalogEntry.id,
        aiSettings.providers[catalogEntry.id],
        rawProviders
      )
    ])
  ) as AiSettings["providers"]

  return {
    ...aiSettings,
    providers: hydratedProviders
  }
}
