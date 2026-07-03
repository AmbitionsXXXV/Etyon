import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type {
  AiProviderConfig,
  AiSettings,
  MoonshotRegion,
  ProviderApiMode,
  ProviderFetchModelsOutput,
  StoredProviderModel
} from "@etyon/rpc"
import { ScrollArea } from "@etyon/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@etyon/ui/components/select"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Checkbox, Input, Switch } from "@heroui/react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import type { ChangeEventHandler } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { ProviderIcon } from "@/renderer/components/providers/provider-icon"
import { rpcClient } from "@/renderer/lib/rpc"
import { SETTINGS_PAGE_EASE_CURVE } from "@/renderer/lib/settings-page/constants"
import { hasProviderCredential } from "@/shared/providers/credentials"
import { resolveMoonshotBaseURL } from "@/shared/providers/moonshot-region"
import {
  getProviderDefaultBaseURL,
  getSettingsTabProviders,
  SETTINGS_PROVIDER_IDS
} from "@/shared/providers/provider-catalog"
import type { SettingsTabProviderId } from "@/shared/providers/provider-catalog"

interface ProviderFetchState {
  kind: "error" | "idle" | "loading" | "success"
  message: string
}

const CURSOR_LOGIN_POLL_INTERVAL_MS = 2000
const CURSOR_LOGIN_TIMEOUT_MS = 3 * 60 * 1000

const MOONSHOT_REGION_OPTIONS: readonly MoonshotRegion[] = [
  "china",
  "international"
]

const OPENAI_API_MODE_OPTIONS: readonly ProviderApiMode[] = [
  "responses",
  "chat-completions"
]

const OPENAI_API_MODE_OPTION_KEY: Record<ProviderApiMode, TranslationKey> = {
  "chat-completions":
    "settings.providers.fields.apiMode.option.chatCompletions",
  responses: "settings.providers.fields.apiMode.option.responses"
}

const createFetchStateMap = (): Record<
  SettingsTabProviderId,
  ProviderFetchState
> =>
  Object.fromEntries(
    SETTINGS_PROVIDER_IDS.map((providerId) => [
      providerId,
      { kind: "idle", message: "" } satisfies ProviderFetchState
    ])
  ) as Record<SettingsTabProviderId, ProviderFetchState>

const formatContextWindow = (contextWindow?: number) => {
  if (!contextWindow) {
    return null
  }

  if (contextWindow >= 1000) {
    return `${Math.round(contextWindow / 1000)}K ctx`
  }

  return `${contextWindow} ctx`
}

const getProviderCredentialStatusKey = (
  hasProviderCredential: boolean,
  isCursorProvider: boolean,
  isCursorAuthPluginEnabled: boolean
): TranslationKey => {
  if (hasProviderCredential) {
    return isCursorProvider
      ? "settings.providers.status.cursorReady"
      : "settings.providers.status.ready"
  }

  if (isCursorProvider) {
    if (isCursorAuthPluginEnabled) {
      return "settings.providers.status.cursorNeedsLogin"
    }

    return "settings.providers.status.cursorPluginDisabled"
  }

  return "settings.providers.status.needsApiKey"
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

const CursorProviderAuthActions = ({
  cursorLoginRequestId,
  isCursorAuthPluginEnabled,
  isCursorAuthenticated,
  logoutCursorMutationIsPending,
  onLogin,
  onLogout,
  startCursorLoginMutationIsPending,
  t
}: {
  cursorLoginRequestId: string | null
  isCursorAuthPluginEnabled: boolean
  isCursorAuthenticated: boolean
  logoutCursorMutationIsPending: boolean
  onLogin: () => void
  onLogout: () => void
  startCursorLoginMutationIsPending: boolean
  t: ReturnType<typeof useI18n>["t"]
}) => {
  if (!isCursorAuthPluginEnabled) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.providers.status.cursorPluginDisabled")}
      </p>
    )
  }

  if (isCursorAuthenticated) {
    return (
      <Button
        isDisabled={logoutCursorMutationIsPending}
        onPress={onLogout}
        size="sm"
        type="button"
        variant="outline"
      >
        {t("settings.plugins.cursor.actions.logout")}
      </Button>
    )
  }

  return (
    <Button
      isDisabled={
        startCursorLoginMutationIsPending || Boolean(cursorLoginRequestId)
      }
      onPress={onLogin}
      size="sm"
      type="button"
    >
      {cursorLoginRequestId
        ? t("settings.plugins.cursor.actions.polling")
        : t("settings.plugins.cursor.actions.login")}
    </Button>
  )
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
  <div className="relative max-w-full min-w-0">
    <HugeiconsIcon
      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      icon={Search01Icon}
      strokeWidth={2}
    />
    <Input
      className="h-8 w-full min-w-0 rounded-lg pl-8"
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

const ProviderSwitch = ({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch aria-label={label} isSelected={checked} onChange={onChange}>
    <Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Content>
  </Switch>
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
      aria-label={name}
      className={cn(
        "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-colors",
        isActive
          ? "border-primary/50 bg-primary/10"
          : "border-border hover:border-primary/20 hover:bg-muted/40"
      )}
      onClick={handleClick}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ProviderIcon className="size-5" providerId={providerId} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate pt-1 text-[0.6875rem] text-muted-foreground">
            {summary}
          </div>
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
      <Checkbox
        aria-label={model.name}
        className="mt-0.5"
        isSelected={isChecked}
        onChange={handleCheckedChange}
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox.Content>
      </Checkbox>

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

// eslint-disable-next-line complexity -- The settings provider page coordinates shared draft state with provider-specific auth controls.
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
  const queryClient = useQueryClient()
  const [activeProviderId, setActiveProviderId] =
    useState<SettingsTabProviderId>(SETTINGS_PROVIDER_IDS[0])
  const [fetchStates, setFetchStates] = useState(createFetchStateMap)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [cursorLoginRequestId, setCursorLoginRequestId] = useState<
    string | null
  >(null)
  const [cursorLoginStartedAt, setCursorLoginStartedAt] = useState<
    number | null
  >(null)
  const [modelSearchValue, setModelSearchValue] = useState("")
  const [providerSearchValue, setProviderSearchValue] = useState("")
  const providers = useMemo(() => getSettingsTabProviders(), [])
  const pluginsQuery = useQuery({
    queryFn: () => rpcClient.plugins.list(),
    queryKey: ["plugins", "list"]
  })
  const cursorStatusQuery = useQuery({
    queryFn: () => rpcClient.cursorAuth.status(),
    queryKey: ["cursor-auth", "status"]
  })

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
  const isCursorProvider = activeProvider.id === "cursor"
  const isCursorAuthPluginEnabled = Boolean(
    pluginsQuery.data?.plugins.find((plugin) => plugin.id === "cursor-auth")
      ?.enabled
  )
  const isCursorAuthenticated = Boolean(cursorStatusQuery.data?.authenticated)

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

  const logoutCursorMutation = useMutation({
    mutationFn: () => rpcClient.cursorAuth.logout(),
    onError: (error) => {
      setFetchStates((previousStates) => ({
        ...previousStates,
        cursor: {
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : t("settings.plugins.cursor.status.loginFailed")
        }
      }))
    },
    onSuccess: async () => {
      setCursorLoginRequestId(null)
      setCursorLoginStartedAt(null)
      setFetchStates((previousStates) => ({
        ...previousStates,
        cursor: {
          kind: "idle",
          message: t("settings.plugins.cursor.status.loggedOut")
        }
      }))
      await queryClient.invalidateQueries({
        queryKey: ["cursor-auth", "status"]
      })
    }
  })

  const pollCursorLoginMutation = useMutation({
    mutationFn: (requestId: string) =>
      rpcClient.cursorAuth.pollLogin({ requestId }),
    onError: (error) => {
      setCursorLoginRequestId(null)
      setCursorLoginStartedAt(null)
      setFetchStates((previousStates) => ({
        ...previousStates,
        cursor: {
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : t("settings.plugins.cursor.status.loginFailed")
        }
      }))
    },
    onSuccess: async (result) => {
      if (!result.authenticated) {
        setFetchStates((previousStates) => ({
          ...previousStates,
          cursor: {
            kind: "loading",
            message: t("settings.plugins.cursor.status.waiting")
          }
        }))
        return
      }

      setCursorLoginRequestId(null)
      setCursorLoginStartedAt(null)
      setFetchStates((previousStates) => ({
        ...previousStates,
        cursor: {
          kind: "success",
          message: t("settings.plugins.cursor.status.loginSuccess")
        }
      }))
      await queryClient.invalidateQueries({
        queryKey: ["cursor-auth", "status"]
      })
    }
  })

  const startCursorLoginMutation = useMutation({
    mutationFn: () => rpcClient.cursorAuth.startLogin(),
    onError: (error) => {
      setFetchStates((previousStates) => ({
        ...previousStates,
        cursor: {
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : t("settings.plugins.cursor.status.loginFailed")
        }
      }))
    },
    onSuccess: ({ requestId }) => {
      setCursorLoginRequestId(requestId)
      setCursorLoginStartedAt(Date.now())
      setFetchStates((previousStates) => ({
        ...previousStates,
        cursor: {
          kind: "loading",
          message: t("settings.plugins.cursor.status.waiting")
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

  const handleOpenAiApiModeChange = useCallback(
    (value: ProviderApiMode | null) => {
      if (activeProvider.id !== "openai" || !value) {
        return
      }

      handleProviderFieldChange("openai", (previousProvider) => ({
        ...previousProvider,
        apiMode: value
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

  const handleCursorLogin = useCallback(() => {
    startCursorLoginMutation.mutate()
  }, [startCursorLoginMutation])

  const handleCursorLogout = useCallback(() => {
    logoutCursorMutation.mutate()
  }, [logoutCursorMutation])

  useEffect(() => {
    if (!cursorLoginRequestId || !cursorLoginStartedAt) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (Date.now() - cursorLoginStartedAt > CURSOR_LOGIN_TIMEOUT_MS) {
        setCursorLoginRequestId(null)
        setCursorLoginStartedAt(null)
        setFetchStates((previousStates) => ({
          ...previousStates,
          cursor: {
            kind: "error",
            message: t("settings.plugins.cursor.status.loginTimeout")
          }
        }))
        return
      }

      if (!pollCursorLoginMutation.isPending) {
        pollCursorLoginMutation.mutate(cursorLoginRequestId)
      }
    }, CURSOR_LOGIN_POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [cursorLoginRequestId, cursorLoginStartedAt, pollCursorLoginMutation, t])

  const providerFetchState =
    fetchStates[activeProvider.id as keyof typeof fetchStates]
  const hasActiveProviderCredential = hasProviderCredential(
    activeProvider,
    activeProviderConfig,
    { cursorAuthenticated: isCursorAuthPluginEnabled && isCursorAuthenticated }
  )
  const providerStatusMessage =
    providerFetchState.message ||
    t(
      getProviderCredentialStatusKey(
        hasActiveProviderCredential,
        isCursorProvider,
        isCursorAuthPluginEnabled
      )
    )

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
  const defaultBaseURL = getProviderDefaultBaseURL(
    activeProvider.id,
    activeProviderConfig
  )

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

                if (providerConfig.enabled) {
                  statusClassName = hasProviderCredential(
                    provider,
                    providerConfig,
                    {
                      cursorAuthenticated:
                        isCursorAuthPluginEnabled && isCursorAuthenticated
                    }
                  )
                    ? "bg-primary"
                    : "bg-amber-400"
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
                  <ProviderIcon
                    className="size-5"
                    providerId={activeProvider.id}
                  />
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
                  {t(activeProvider.descriptionKey)}
                </p>
              </div>

              <ProviderSwitch
                checked={activeProviderConfig.enabled}
                label={activeProvider.name}
                onChange={handleEnabledChange}
              />
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col px-2">
            <div className="shrink-0 space-y-5 pr-2">
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs",
                  statusPanelClassName
                )}
              >
                {providerStatusMessage}
              </div>

              <div className="space-y-4">
                {isCursorProvider ? (
                  <div className="space-y-3 rounded-xl border border-border bg-background/50 p-3">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">
                        {t("settings.providers.fields.cursorAuth.label")}
                      </h4>
                      <p className="text-[0.6875rem] leading-5 text-muted-foreground">
                        {t("settings.providers.fields.cursorAuth.description")}
                      </p>
                    </div>

                    <CursorProviderAuthActions
                      cursorLoginRequestId={cursorLoginRequestId}
                      isCursorAuthPluginEnabled={isCursorAuthPluginEnabled}
                      isCursorAuthenticated={isCursorAuthenticated}
                      logoutCursorMutationIsPending={
                        logoutCursorMutation.isPending
                      }
                      onLogin={handleCursorLogin}
                      onLogout={handleCursorLogout}
                      startCursorLoginMutationIsPending={
                        startCursorLoginMutation.isPending
                      }
                      t={t}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium">
                        {t("settings.providers.fields.apiKey.label")}
                      </label>
                      <Button
                        onPress={handleToggleApiKeyVisibility}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {apiKeyVisibilityLabel}
                      </Button>
                    </div>
                    <Input
                      className="mx-0.5"
                      onChange={handleApiKeyInputChange}
                      placeholder={t(
                        "settings.providers.fields.apiKey.placeholder"
                      )}
                      type={isApiKeyVisible ? "text" : "password"}
                      value={activeProviderConfig.apiKey}
                    />
                  </div>
                )}

                {!isCursorProvider && (
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

                    {activeProvider.id === "openai" && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium">
                          {t("settings.providers.fields.apiMode.label")}
                        </label>
                        <Select
                          onValueChange={handleOpenAiApiModeChange}
                          value={activeProviderConfig.apiMode ?? "responses"}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {t(
                                OPENAI_API_MODE_OPTION_KEY[
                                  activeProviderConfig.apiMode ?? "responses"
                                ]
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {OPENAI_API_MODE_OPTIONS.map((apiMode) => (
                                <SelectItem key={apiMode} value={apiMode}>
                                  {t(OPENAI_API_MODE_OPTION_KEY[apiMode])}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <p className="text-[0.6875rem] leading-5 text-muted-foreground">
                          {t("settings.providers.fields.apiMode.description")}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium">
                        {t("settings.providers.fields.baseUrl.label")}
                      </label>
                    </div>
                    <Input
                      className="mx-0.5"
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
                )}
              </div>
            </div>

            <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-background/50 p-3">
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
                    isDisabled={
                      fetchModelsMutation.isPending ||
                      !hasActiveProviderCredential
                    }
                    onPress={handleFetchClick}
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

              <ScrollArea className="mt-3 min-h-0 flex-1 pr-1.5">
                <div className="space-y-2 pr-2">
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
              </ScrollArea>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  )
}
