import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type {
  AiProviderConfig,
  AiSettings,
  MoonshotRegion,
  ProviderFetchModelsOutput,
  StoredProviderModel
} from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import { Checkbox } from "@etyon/ui/components/checkbox"
import { Input } from "@etyon/ui/components/input"
import { ScrollArea } from "@etyon/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@etyon/ui/components/select"
import { Switch } from "@etyon/ui/components/switch"
import { cn } from "@etyon/ui/lib/utils"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ChangeEventHandler } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { rpcClient } from "@/renderer/lib/rpc"
import { SETTINGS_PAGE_EASE_CURVE } from "@/renderer/lib/settings-page/constants"
import {
  getDefaultMoonshotBaseURL,
  resolveMoonshotBaseURL
} from "@/shared/providers/moonshot-region"
import { getSettingsTabProviders } from "@/shared/providers/provider-catalog"
import type { SettingsTabProviderId } from "@/shared/providers/provider-catalog"

interface ProviderFetchState {
  kind: "error" | "idle" | "loading" | "success"
  message: string
}

const PROVIDER_DESCRIPTION_KEY_BY_ID: Record<
  SettingsTabProviderId,
  TranslationKey
> = {
  moonshot: "settings.providers.provider.moonshot.description",
  "zai-coding-plan": "settings.providers.provider.zaiCodingPlan.description"
}

const MOONSHOT_REGION_OPTIONS: readonly MoonshotRegion[] = [
  "china",
  "international"
]

const createFetchStateMap = (): Record<
  SettingsTabProviderId,
  ProviderFetchState
> => ({
  moonshot: { kind: "idle", message: "" },
  "zai-coding-plan": { kind: "idle", message: "" }
})

const formatContextWindow = (contextWindow?: number) => {
  if (!contextWindow) {
    return null
  }

  if (contextWindow >= 1000) {
    return `${Math.round(contextWindow / 1000)}K ctx`
  }

  return `${contextWindow} ctx`
}

const buildModelSummary = (model: StoredProviderModel) => {
  const tags = [
    model.capabilities?.vision ? "Vision" : null,
    model.capabilities?.reasoning ? "Reasoning" : null,
    model.capabilities?.functionCalling ? "Tools" : null,
    model.capabilities?.jsonMode ? "JSON" : null,
    model.capabilities?.streaming ? "Streaming" : null,
    formatContextWindow(model.capabilities?.contextWindow)
  ].filter(Boolean)

  return tags.join(" · ")
}

const SearchInput = ({
  onChange,
  placeholder,
  value
}: {
  onChange: ChangeEventHandler<HTMLInputElement>
  placeholder: string
  value: string
}) => (
  <div className="relative">
    <HugeiconsIcon
      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      icon={Search01Icon}
      strokeWidth={2}
    />
    <Input
      className="h-8 rounded-lg pl-8"
      onChange={onChange}
      placeholder={placeholder}
      value={value}
    />
  </div>
)

const StatusPill = ({
  isEnabled,
  label
}: {
  isEnabled: boolean
  label: string
}) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
      isEnabled
        ? "bg-primary/15 text-primary"
        : "bg-muted text-muted-foreground"
    )}
  >
    {label}
  </span>
)

const ProviderRailItem = ({
  isActive,
  name,
  onSelect,
  providerId,
  statusClassName,
  summary
}: {
  isActive: boolean
  name: string
  onSelect: (providerId: SettingsTabProviderId) => void
  providerId: SettingsTabProviderId
  statusClassName: string
  summary: string
}) => {
  const handleClick = useCallback(() => {
    onSelect(providerId)
  }, [onSelect, providerId])

  return (
    <button
      className={cn(
        "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-colors",
        isActive
          ? "border-primary/50 bg-primary/10"
          : "border-border hover:border-primary/20 hover:bg-muted/40"
      )}
      onClick={handleClick}
      type="button"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate pt-1 text-[0.6875rem] text-muted-foreground">
          {summary}
        </div>
      </div>

      <span className={cn("size-2 shrink-0 rounded-full", statusClassName)} />
    </button>
  )
}

const ProviderModelItem = ({
  isChecked,
  model,
  onCheckedChange
}: {
  isChecked: boolean
  model: StoredProviderModel
  onCheckedChange: (checked: boolean, model: StoredProviderModel) => void
}) => {
  const handleCheckedChange = useCallback(
    (checked: boolean) => {
      onCheckedChange(checked, model)
    },
    [model, onCheckedChange]
  )
  const summary = buildModelSummary(model)

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted/30">
      <Checkbox checked={isChecked} onCheckedChange={handleCheckedChange} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{model.name}</div>
        <div className="truncate pt-1 text-[0.6875rem] text-muted-foreground">
          {model.id}
        </div>
        {summary && (
          <div className="pt-1 text-[0.6875rem] text-muted-foreground">
            {summary}
          </div>
        )}
      </div>
    </div>
  )
}

export const ProvidersTab = ({
  aiSettings,
  onProviderConfigChange,
  onProviderEnabledChange
}: {
  aiSettings: AiSettings
  onProviderConfigChange: (
    providerId: SettingsTabProviderId,
    updater:
      | AiProviderConfig
      | ((previousProvider: AiProviderConfig) => AiProviderConfig)
  ) => void
  onProviderEnabledChange: (
    providerId: SettingsTabProviderId,
    enabled: boolean
  ) => void
}) => {
  const { t } = useI18n()
  const [activeProviderId, setActiveProviderId] =
    useState<SettingsTabProviderId>("moonshot")
  const [fetchStates, setFetchStates] = useState(createFetchStateMap)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [modelSearchValue, setModelSearchValue] = useState("")
  const [providerSearchValue, setProviderSearchValue] = useState("")
  const providers = useMemo(() => getSettingsTabProviders(), [])

  const filteredProviders = useMemo(() => {
    const normalizedSearchValue = providerSearchValue.trim().toLowerCase()

    if (!normalizedSearchValue) {
      return providers
    }

    return providers.filter((provider) =>
      provider.name.toLowerCase().includes(normalizedSearchValue)
    )
  }, [providerSearchValue, providers])

  useEffect(() => {
    if (
      filteredProviders.length > 0 &&
      !filteredProviders.some((provider) => provider.id === activeProviderId)
    ) {
      setActiveProviderId(filteredProviders[0].id)
    }
  }, [activeProviderId, filteredProviders])

  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers[0]
  const activeProviderConfig = aiSettings.providers[activeProvider.id]

  const filteredModels = useMemo(() => {
    const normalizedSearchValue = modelSearchValue.trim().toLowerCase()

    if (!normalizedSearchValue) {
      return activeProviderConfig.availableModels
    }

    return activeProviderConfig.availableModels.filter((model) => {
      const searchableText = `${model.id} ${model.name}`.toLowerCase()

      return searchableText.includes(normalizedSearchValue)
    })
  }, [activeProviderConfig.availableModels, modelSearchValue])

  const selectedModelIds = useMemo(
    () => new Set(activeProviderConfig.models.map((model) => model.id)),
    [activeProviderConfig.models]
  )

  const fetchModelsMutation = useMutation<
    ProviderFetchModelsOutput,
    Error,
    SettingsTabProviderId
  >({
    mutationFn: (providerId) =>
      rpcClient.providers.fetchModels({
        provider: {
          apiKey: aiSettings.providers[providerId].apiKey,
          baseURL: aiSettings.providers[providerId].baseURL,
          providerId,
          region: aiSettings.providers[providerId].region
        }
      }),
    onError: (error, providerId) => {
      setFetchStates((previousStates) => ({
        ...previousStates,
        [providerId]: {
          kind: "error",
          message: error.message || t("settings.providers.status.fetchFailed")
        }
      }))
    },
    onMutate: (providerId) => {
      setFetchStates((previousStates) => ({
        ...previousStates,
        [providerId]: {
          kind: "loading",
          message: t("settings.providers.status.fetching")
        }
      }))
    },
    onSuccess: ({ models }, providerId) => {
      const currentProviderConfig = aiSettings.providers[providerId]
      const currentEnabledModelIds = new Set(
        currentProviderConfig.models.map((model) => model.id)
      )
      const nextModels =
        currentProviderConfig.models.length > 0
          ? models.filter((model) => currentEnabledModelIds.has(model.id))
          : models

      onProviderConfigChange(providerId, (previousProvider) => ({
        ...previousProvider,
        availableModels: models,
        models: nextModels
      }))

      setFetchStates((previousStates) => ({
        ...previousStates,
        [providerId]: {
          kind: "success",
          message:
            models.length > 0
              ? t("settings.providers.status.fetchSuccess", {
                  count: models.length
                })
              : t("settings.providers.status.fetchSuccessEmpty")
        }
      }))
    }
  })

  const handleProviderFieldChange = useCallback(
    (
      providerId: SettingsTabProviderId,
      updater:
        | AiProviderConfig
        | ((previousProvider: AiProviderConfig) => AiProviderConfig)
    ) => {
      onProviderConfigChange(providerId, updater)
      setFetchStates((previousStates) => ({
        ...previousStates,
        [providerId]: { kind: "idle", message: "" }
      }))
    },
    [onProviderConfigChange]
  )

  const handleProviderSearchChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    setProviderSearchValue(event.target.value)
  }, [])

  const handleModelSearchChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    setModelSearchValue(event.target.value)
  }, [])

  const handleProviderSelect = useCallback(
    (providerId: SettingsTabProviderId) => {
      setActiveProviderId(providerId)
      setIsApiKeyVisible(false)
      setModelSearchValue("")
    },
    []
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => {
      onProviderEnabledChange(activeProvider.id, checked)
    },
    [activeProvider.id, onProviderEnabledChange]
  )

  const handleToggleApiKeyVisibility = useCallback(() => {
    setIsApiKeyVisible((previous) => !previous)
  }, [])

  const handleApiKeyInputChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >(
    (event) =>
      handleProviderFieldChange(activeProvider.id, (previousProvider) => ({
        ...previousProvider,
        apiKey: event.target.value
      })),
    [activeProvider.id, handleProviderFieldChange]
  )

  const handleBaseURLInputChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >(
    (event) =>
      handleProviderFieldChange(activeProvider.id, (previousProvider) => ({
        ...previousProvider,
        baseURL: event.target.value
      })),
    [activeProvider.id, handleProviderFieldChange]
  )

  const handleMoonshotRegionChange = useCallback(
    (value: MoonshotRegion | null) => {
      if (activeProvider.id !== "moonshot" || !value) {
        return
      }

      handleProviderFieldChange("moonshot", (previousProvider) => ({
        ...previousProvider,
        baseURL: resolveMoonshotBaseURL(previousProvider.baseURL, value),
        region: value
      }))
    },
    [activeProvider.id, handleProviderFieldChange]
  )

  const handleModelCheckedChange = useCallback(
    (checked: boolean, model: StoredProviderModel) =>
      handleProviderFieldChange(activeProvider.id, (previousProvider) => ({
        ...previousProvider,
        models: checked
          ? [...previousProvider.models, model]
          : previousProvider.models.filter(
              (previousModel) => previousModel.id !== model.id
            )
      })),
    [activeProvider.id, handleProviderFieldChange]
  )

  const handleFetchClick = useCallback(() => {
    fetchModelsMutation.mutate(activeProvider.id)
  }, [activeProvider.id, fetchModelsMutation])

  const providerFetchState = fetchStates[activeProvider.id]
  const providerStatusMessage =
    providerFetchState.message ||
    (activeProviderConfig.apiKey.trim()
      ? t("settings.providers.status.ready")
      : t("settings.providers.status.needsApiKey"))

  let statusPanelClassName = "border-border bg-muted/30 text-muted-foreground"

  if (providerFetchState.kind === "error") {
    statusPanelClassName =
      "border-destructive/30 bg-destructive/10 text-destructive"
  }

  if (providerFetchState.kind === "success") {
    statusPanelClassName = "border-primary/20 bg-primary/10 text-primary"
  }

  const fetchButtonLabel =
    fetchModelsMutation.isPending &&
    fetchModelsMutation.variables === activeProvider.id
      ? t("settings.providers.actions.fetching")
      : t("settings.providers.actions.fetch")
  const apiKeyVisibilityLabel = t(
    isApiKeyVisible
      ? "settings.providers.actions.hideApiKey"
      : "settings.providers.actions.showApiKey"
  )
  const defaultBaseURL =
    activeProvider.id === "moonshot"
      ? getDefaultMoonshotBaseURL(activeProviderConfig.region)
      : activeProvider.baseURL

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full min-h-0 flex-1 flex-col"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.28, ease: SETTINGS_PAGE_EASE_CURVE }}
    >
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-[14.5rem_minmax(0,1fr)]">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80 p-3">
          <SearchInput
            onChange={handleProviderSearchChange}
            placeholder={t("settings.providers.search")}
            value={providerSearchValue}
          />

          <ScrollArea className="mt-3 min-h-0 flex-1">
            <div className="space-y-2 pr-2">
              {filteredProviders.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("settings.providers.empty")}
                </div>
              )}

              {filteredProviders.map((provider) => {
                const providerConfig = aiSettings.providers[provider.id]
                const isActive = provider.id === activeProvider.id
                let statusClassName = "bg-muted-foreground/40"

                if (providerConfig.enabled && providerConfig.apiKey.trim()) {
                  statusClassName = "bg-primary"
                } else if (providerConfig.enabled) {
                  statusClassName = "bg-amber-400"
                }

                let summary = t("settings.providers.list.noEnabledModels")

                if (providerConfig.models.length > 0) {
                  summary = t("settings.providers.list.enabledModels", {
                    count: providerConfig.models.length
                  })
                }

                return (
                  <ProviderRailItem
                    isActive={isActive}
                    key={provider.id}
                    name={provider.name}
                    onSelect={handleProviderSelect}
                    providerId={provider.id}
                    statusClassName={statusClassName}
                    summary={summary}
                  />
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80 p-4"
          initial={{ opacity: 0, y: 8 }}
          key={activeProvider.id}
          transition={{ duration: 0.22, ease: SETTINGS_PAGE_EASE_CURVE }}
        >
          <div className="shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">
                    {activeProvider.name}
                  </h3>
                  <StatusPill
                    isEnabled={activeProviderConfig.enabled}
                    label={t(
                      activeProviderConfig.enabled
                        ? "settings.providers.status.enabled"
                        : "settings.providers.status.disabled"
                    )}
                  />
                </div>
                <p className="max-w-xl text-xs text-muted-foreground">
                  {t(PROVIDER_DESCRIPTION_KEY_BY_ID[activeProvider.id])}
                </p>
              </div>

              <Switch
                checked={activeProviderConfig.enabled}
                onCheckedChange={handleEnabledChange}
              />
            </div>
          </div>

          <ScrollArea className="mt-5 min-h-0 flex-1 px-2">
            <div className="space-y-5 pr-2">
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs",
                  statusPanelClassName
                )}
              >
                {providerStatusMessage}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium">
                      {t("settings.providers.fields.apiKey.label")}
                    </label>
                    <Button
                      onClick={handleToggleApiKeyVisibility}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      {apiKeyVisibilityLabel}
                    </Button>
                  </div>
                  <Input
                    onChange={handleApiKeyInputChange}
                    placeholder={t(
                      "settings.providers.fields.apiKey.placeholder"
                    )}
                    type={isApiKeyVisible ? "text" : "password"}
                    value={activeProviderConfig.apiKey}
                  />
                </div>

                <div className="space-y-2">
                  {activeProvider.id === "moonshot" && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium">
                        {t("settings.providers.fields.region.label")}
                      </label>
                      <Select
                        onValueChange={handleMoonshotRegionChange}
                        value={activeProviderConfig.region ?? "china"}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {t(
                              `settings.providers.fields.region.option.${activeProviderConfig.region ?? "china"}` as TranslationKey
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {MOONSHOT_REGION_OPTIONS.map((region) => (
                              <SelectItem key={region} value={region}>
                                {t(
                                  `settings.providers.fields.region.option.${region}` as TranslationKey
                                )}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <p className="text-[0.6875rem] leading-5 text-muted-foreground">
                        {t("settings.providers.fields.region.description")}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-medium">
                      {t("settings.providers.fields.baseUrl.label")}
                    </label>
                    <Input
                      onChange={handleBaseURLInputChange}
                      value={activeProviderConfig.baseURL}
                    />
                    <p className="text-[0.6875rem] leading-5 text-muted-foreground">
                      {t("settings.providers.fields.baseUrl.description", {
                        defaultBaseURL,
                        upstreamModelsApi: activeProvider.upstreamModelsApi
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex min-h-48 flex-col rounded-2xl border border-border bg-background/50 p-3">
                <div className="shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">
                        {t("settings.providers.models.title")}
                      </h4>
                      <p className="pt-1 text-[0.6875rem] text-muted-foreground">
                        {t("settings.providers.models.description")}
                      </p>
                    </div>
                    <Button
                      disabled={
                        fetchModelsMutation.isPending ||
                        !activeProviderConfig.apiKey
                      }
                      onClick={handleFetchClick}
                      type="button"
                      variant="outline"
                    >
                      {fetchButtonLabel}
                    </Button>
                  </div>

                  <div className="pt-3">
                    <SearchInput
                      onChange={handleModelSearchChange}
                      placeholder={t("settings.providers.models.search")}
                      value={modelSearchValue}
                    />
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {filteredModels.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      {t("settings.providers.models.empty")}
                    </div>
                  )}

                  {filteredModels.map((model) => (
                    <ProviderModelItem
                      isChecked={selectedModelIds.has(model.id)}
                      key={model.id}
                      model={model}
                      onCheckedChange={handleModelCheckedChange}
                    />
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </motion.div>
      </div>
    </motion.section>
  )
}
