import type { LocalePreference } from "@etyon/i18n"
import type {
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

  useEffect(() => {
    if (saved && !draft) {
      setDraft(saved)
    }
  }, [saved, draft])

  const isDirty = useMemo(() => {
    if (!saved || !draft) {
      return false
    }
    return !settingsEqual(saved, draft)
  }, [draft, saved])

  const updateMutation = useMutation<AppSettings, Error, AppSettings>({
    mutationFn: (nextSettings) => rpcClient.settings.update(nextSettings),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsQueryKey, data)
      setDraft(data)
    }
  })

  const draftTheme = draft?.theme

  useEffect(() => {
    if (draft) {
      applySettings(draft)
    }
  }, [draft])

  useEffect(() => {
    if (draftTheme) {
      applyThemePreview(draftTheme)
    }
  }, [draftTheme])

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
  const handleLocaleChange = useCallback(
    (v: LocalePreference) => updateDraftRef.current("locale", v),
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
    if (saved) {
      setDraft(saved)
    }
  }, [saved])

  return {
    draft,
    handleAppIconChange,
    handleAutoStartChange,
    handleCancel,
    handleCustomThemeCreate,
    handleCustomThemeDelete,
    handleDarkColorSchemaChange,
    handleFontFamilyChange,
    handleFontSizeChange,
    handleLightColorSchemaChange,
    handleLocaleChange,
    handleSave,
    handleThemeChange,
    isDirty,
    updateMutation
  }
}
