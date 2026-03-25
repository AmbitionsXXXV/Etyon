import type { LocalePreference } from "@etyon/i18n"
import type {
  AiProviderConfig,
  AiProviderName,
  AppIcon,
  AppSettings,
  CustomTheme,
  DarkColorSchema,
  LightColorSchema,
  Theme
} from "@etyon/rpc"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

import { applySettings, applyThemePreview } from "../settings"
import { settingsEqual } from "./settings-equal"

export const useSettingsPageDraft = () => {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(orpc.settings.get.queryOptions({}))
  const settingsQueryKey = orpc.settings.get.queryOptions({}).queryKey
  const saved = settingsQuery.data

  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<AppSettings | null>(null)
  const draftRef = useRef<AppSettings | null>(null)
  const pendingSaveRef = useRef<AppSettings | null>(null)
  const savedSnapshotRef = useRef<AppSettings | null>(null)

  draftRef.current = draft

  const syncSavedSnapshot = useCallback((nextSettings: AppSettings) => {
    savedSnapshotRef.current = nextSettings
    setSavedSnapshot(nextSettings)
  }, [])

  const clearSavedSnapshot = useCallback(() => {
    savedSnapshotRef.current = null
    setSavedSnapshot(null)
  }, [])

  useEffect(() => {
    if (!saved) {
      return
    }

    const previousSavedSnapshot = savedSnapshotRef.current

    if (!previousSavedSnapshot) {
      syncSavedSnapshot(saved)
      setDraft(saved)
      return
    }

    const currentDraft = draftRef.current
    const hasLocalChanges = currentDraft
      ? !settingsEqual(previousSavedSnapshot, currentDraft)
      : false

    syncSavedSnapshot(saved)

    if (!hasLocalChanges) {
      setDraft(saved)
    }
  }, [saved, syncSavedSnapshot])

  const isDirty = useMemo(() => {
    if (!savedSnapshot || !draft) {
      return false
    }
    return !settingsEqual(savedSnapshot, draft)
  }, [draft, savedSnapshot])

  const updateMutation = useMutation<
    AppSettings,
    Error,
    AppSettings,
    {
      previousDraft: AppSettings | null
      previousSavedSnapshot: AppSettings | null
    }
  >({
    mutationFn: (nextSettings) => rpcClient.settings.update(nextSettings),
    onError: (_error, _nextSettings, context) => {
      const currentDraft = draftRef.current
      const pendingSave = pendingSaveRef.current
      const hasNewerLocalChanges =
        currentDraft && pendingSave
          ? !settingsEqual(currentDraft, pendingSave)
          : false

      pendingSaveRef.current = null

      if (context?.previousSavedSnapshot) {
        syncSavedSnapshot(context.previousSavedSnapshot)
      } else {
        clearSavedSnapshot()
      }

      if (!hasNewerLocalChanges) {
        setDraft(context?.previousDraft ?? null)
      }
    },
    onMutate: (nextSettings) => {
      pendingSaveRef.current = nextSettings
      syncSavedSnapshot(nextSettings)
      setDraft(nextSettings)

      return {
        previousDraft: draftRef.current,
        previousSavedSnapshot: savedSnapshotRef.current
      }
    },
    onSuccess: (data) => {
      const currentDraft = draftRef.current
      const pendingSave = pendingSaveRef.current
      const hasNewerLocalChanges =
        currentDraft && pendingSave
          ? !settingsEqual(currentDraft, pendingSave)
          : false

      pendingSaveRef.current = null
      queryClient.setQueryData(settingsQueryKey, data)
      syncSavedSnapshot(data)

      if (!hasNewerLocalChanges) {
        setDraft(data)
      }
    }
  })

  const draftTheme = draft?.theme

  useEffect(() => {
    if (draft) {
      applySettings(draft)
    }
  }, [draft])

  const draftDarkColorSchema = draft?.darkColorSchema
  const draftLightColorSchema = draft?.lightColorSchema

  useEffect(() => {
    if (!draftDarkColorSchema || !draftLightColorSchema) {
      return
    }

    window.electron.ipcRenderer.send("settings-preview-color-schemas", {
      darkColorSchema: draftDarkColorSchema,
      lightColorSchema: draftLightColorSchema
    })
  }, [draftDarkColorSchema, draftLightColorSchema])

  useEffect(() => {
    if (draftTheme) {
      applyThemePreview(draftTheme)
    }
  }, [draftTheme])

  useEffect(
    () => () => {
      const nextSavedSnapshot = savedSnapshotRef.current

      if (nextSavedSnapshot) {
        window.electron.ipcRenderer.send("settings-preview-color-schemas", {
          darkColorSchema: nextSavedSnapshot.darkColorSchema,
          lightColorSchema: nextSavedSnapshot.lightColorSchema
        })
      }
    },
    []
  )

  const updateDraft = useCallback(
    <K extends keyof AppSettings>(field: K, value: AppSettings[K]) =>
      setDraft((prev) => (prev ? { ...prev, [field]: value } : prev)),
    []
  )

  const updateDraftRef = useRef(updateDraft)
  updateDraftRef.current = updateDraft

  const handleAppIconChange = useCallback(
    (v: AppIcon) => updateDraftRef.current("appIcon", v),
    []
  )
  const handleAutoStartChange = useCallback(
    (v: boolean) => updateDraftRef.current("autoStart", v),
    []
  )
  const handleCloseToTrayChange = useCallback(
    (v: boolean) => updateDraftRef.current("closeToTray", v),
    []
  )
  const handleCustomThemeCreate = useCallback((theme: CustomTheme) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            customThemes: [theme, ...prev.customThemes]
          }
        : prev
    )
  }, [])
  const handleCustomThemeDelete = useCallback((themeId: string) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            customThemes: prev.customThemes.filter(
              (theme) => theme.id !== themeId
            )
          }
        : prev
    )
  }, [])
  const handleDarkColorSchemaChange = useCallback(
    (v: DarkColorSchema) => updateDraftRef.current("darkColorSchema", v),
    []
  )
  const handleFontFamilyChange = useCallback(
    (v: string) => updateDraftRef.current("fontFamily", v),
    []
  )
  const handleFontSizeChange = useCallback(
    (v: number) => updateDraftRef.current("fontSize", v),
    []
  )
  const handleLightColorSchemaChange = useCallback(
    (v: LightColorSchema) => updateDraftRef.current("lightColorSchema", v),
    []
  )
  const handleAiProviderConfigChange = useCallback(
    (
      providerId: AiProviderName,
      updater:
        | AiProviderConfig
        | ((previousProvider: AiProviderConfig) => AiProviderConfig)
    ) =>
      setDraft((prev) => {
        if (!prev) {
          return prev
        }

        const previousProvider = prev.ai.providers[providerId]
        const nextProvider =
          typeof updater === "function" ? updater(previousProvider) : updater

        return {
          ...prev,
          ai: {
            ...prev.ai,
            providers: {
              ...prev.ai.providers,
              [providerId]: nextProvider
            }
          }
        }
      }),
    []
  )

  const handleAiProviderEnabledChange = useCallback(
    (providerId: AiProviderName, enabled: boolean) => {
      const { current } = draftRef

      if (!current) {
        return
      }

      const nextSettings: AppSettings = {
        ...current,
        ai: {
          ...current.ai,
          providers: {
            ...current.ai.providers,
            [providerId]: {
              ...current.ai.providers[providerId],
              enabled
            }
          }
        }
      }

      setDraft(nextSettings)
      updateMutation.mutate(nextSettings)
    },
    [updateMutation]
  )
  const handleLocaleChange = useCallback(
    (v: LocalePreference) => updateDraftRef.current("locale", v),
    []
  )
  const handleMinimizeToTrayChange = useCallback(
    (v: boolean) => updateDraftRef.current("minimizeToTray", v),
    []
  )
  const handleStartMinimizedToTrayChange = useCallback(
    (v: boolean) => updateDraftRef.current("startMinimizedToTray", v),
    []
  )
  const handleThemeChange = useCallback(
    (v: Theme) => updateDraftRef.current("theme", v),
    []
  )

  const handleSave = useCallback(() => {
    if (draft) {
      updateMutation.mutate(draft)
    }
  }, [draft, updateMutation])

  const handleCancel = useCallback(() => {
    if (savedSnapshot) {
      setDraft(savedSnapshot)
    }
  }, [savedSnapshot])

  return {
    draft,
    handleAiProviderConfigChange,
    handleAiProviderEnabledChange,
    handleAppIconChange,
    handleAutoStartChange,
    handleCancel,
    handleCloseToTrayChange,
    handleCustomThemeCreate,
    handleCustomThemeDelete,
    handleDarkColorSchemaChange,
    handleFontFamilyChange,
    handleFontSizeChange,
    handleLightColorSchemaChange,
    handleLocaleChange,
    handleMinimizeToTrayChange,
    handleSave,
    handleStartMinimizedToTrayChange,
    handleThemeChange,
    isDirty,
    updateMutation
  }
}
