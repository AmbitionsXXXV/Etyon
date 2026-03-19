import type { LocalePreference } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type {
  AppIcon,
  AppSettings,
  CustomTheme,
  DarkColorSchema,
  LightColorSchema,
  Theme
} from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import { Skeleton } from "@etyon/ui/components/skeleton"
import {
  ComputerIcon,
  Moon02Icon,
  PaintBrush01Icon,
  Settings02Icon,
  Sun02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

import { applySettings, applyThemePreview } from "../lib/settings"
import { CustomThemesTab } from "./settings/custom-themes"
import {
  AppIconSelector,
  AutoStartCheckbox,
  LanguageSelect
} from "./settings/general-tab"
import { NavButton } from "./settings/nav-button"
import type { ColorSchemaOption, ThemeOption } from "./settings/ui-tab"
import {
  ColorSchemaSelector,
  FontFamilyCombobox,
  FontSizeInput,
  ThemeSelector
} from "./settings/ui-tab"

const EASE_CURVE = [0.25, 0.1, 0.25, 1] as const

const sectionAnimation = (delay: number) => ({
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: 10 },
  transition: { delay, duration: 0.35, ease: EASE_CURVE }
})

const settingsEqual = (a: AppSettings, b: AppSettings) =>
  a.appIcon === b.appIcon &&
  a.autoStart === b.autoStart &&
  a.darkColorSchema === b.darkColorSchema &&
  a.fontFamily === b.fontFamily &&
  a.fontSize === b.fontSize &&
  a.lightColorSchema === b.lightColorSchema &&
  a.locale === b.locale &&
  a.theme === b.theme &&
  a.customThemes.length === b.customThemes.length &&
  a.customThemes.every((t, i) => t.id === b.customThemes[i]?.id)

export const SettingsPage = () => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState("general")

  const handleNavColorSchema = useCallback(
    () => setActiveSection("color-schema"),
    []
  )
  const handleNavGeneral = useCallback(() => setActiveSection("general"), [])
  const handleNavUI = useCallback(() => setActiveSection("user-interface"), [])

  const navItems = useMemo(
    () => [
      {
        handleSelect: handleNavGeneral,
        icon: Settings02Icon,
        id: "general" as const,
        label: t("settings.nav.general")
      },
      {
        handleSelect: handleNavColorSchema,
        icon: PaintBrush01Icon,
        id: "color-schema" as const,
        label: t("settings.nav.colorSchema")
      },
      {
        handleSelect: handleNavUI,
        icon: ComputerIcon,
        id: "user-interface" as const,
        label: t("settings.nav.userInterface")
      }
    ],
    [t, handleNavColorSchema, handleNavGeneral, handleNavUI]
  )

  const activeSectionLabel = useMemo(
    () => navItems.find((item) => item.id === activeSection)?.label ?? "",
    [activeSection, navItems]
  )

  const themeOptions = useMemo<ThemeOption[]>(
    () => [
      {
        icon: <HugeiconsIcon icon={Sun02Icon} size={24} />,
        label: t("settings.theme.option.light"),
        value: "light"
      },
      {
        icon: <HugeiconsIcon icon={Moon02Icon} size={24} />,
        label: t("settings.theme.option.dark"),
        value: "dark"
      },
      {
        icon: <HugeiconsIcon icon={ComputerIcon} size={24} />,
        label: t("settings.theme.option.system"),
        value: "system"
      }
    ],
    [t]
  )

  const darkColorSchemaOptions = useMemo<ColorSchemaOption<DarkColorSchema>[]>(
    () => [
      {
        label: t("settings.colorScheme.option.default"),
        swatches: [
          "oklch(0.145 0 0)",
          "oklch(0.205 0 0)",
          "oklch(0.269 0 0)",
          "oklch(0.488 0.243 264.376)",
          "oklch(0.704 0.191 22.216)"
        ],
        value: "default"
      },
      {
        label: t("settings.colorScheme.option.tokyoNight"),
        swatches: [
          "oklch(0.226 0.021 280.487)",
          "oklch(0.282 0.036 274.748)",
          "oklch(0.846 0.061 274.763)",
          "oklch(0.719 0.132 264.202)",
          "oklch(0.723 0.159 10.276)"
        ],
        value: "tokyo-night"
      }
    ],
    [t]
  )

  const lightColorSchemaOptions = useMemo<
    ColorSchemaOption<LightColorSchema>[]
  >(
    () => [
      {
        label: t("settings.colorScheme.option.default"),
        swatches: [
          "oklch(1 0 0)",
          "oklch(0.97 0 0)",
          "oklch(0.922 0 0)",
          "oklch(0.205 0 0)",
          "oklch(0.577 0.245 27.325)"
        ],
        value: "default"
      },
      {
        label: t("settings.colorScheme.option.oneLight"),
        swatches: [
          "oklch(0.985 0 89.876)",
          "oklch(0.955 0.001 286.375)",
          "oklch(0.35 0.014 274.503)",
          "oklch(0.602 0.193 263.246)",
          "oklch(0.639 0.179 28.344)"
        ],
        value: "one-light"
      }
    ],
    [t]
  )

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

  const handleFontFamilyChange = useCallback(
    (v: string) => updateDraftRef.current("fontFamily", v),
    []
  )
  const handleFontSizeChange = useCallback(
    (v: number) => updateDraftRef.current("fontSize", v),
    []
  )
  const handleLocaleChange = useCallback(
    (v: LocalePreference) => updateDraftRef.current("locale", v),
    []
  )
  const handleAppIconChange = useCallback(
    (v: AppIcon) => updateDraftRef.current("appIcon", v),
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
  const handleAutoStartChange = useCallback(
    (v: boolean) => updateDraftRef.current("autoStart", v),
    []
  )
  const handleDarkColorSchemaChange = useCallback(
    (v: DarkColorSchema) => updateDraftRef.current("darkColorSchema", v),
    []
  )
  const handleLightColorSchemaChange = useCallback(
    (v: LightColorSchema) => updateDraftRef.current("lightColorSchema", v),
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

  if (!draft) {
    return (
      <div className="flex h-svh">
        <aside className="w-[160px] shrink-0 border-r border-border bg-background p-3 pt-10">
          <Skeleton className="h-7 w-full rounded-md" />
        </aside>

        <main className="flex-1 overflow-y-auto pt-8">
          <div className="mx-auto p-6">
            <Skeleton className="mb-6 h-6 w-36" />

            <div className="space-y-8">
              <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-3 w-56" />
              </div>

              <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-16" />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-[72px] rounded-lg" />
                  <Skeleton className="h-[72px] rounded-lg" />
                  <Skeleton className="h-[72px] rounded-lg" />
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-28" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-svh">
      <motion.aside
        animate={{ opacity: 1, x: 0 }}
        className="shrink-0 border-r border-border bg-background p-3 pt-10"
        initial={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.3, ease: EASE_CURVE }}
      >
        <nav className="space-y-0.5">
          {navItems.map((item) => (
            <NavButton
              icon={item.icon}
              isActive={activeSection === item.id}
              key={item.id}
              label={item.label}
              onSelect={item.handleSelect}
            />
          ))}
        </nav>
      </motion.aside>

      <main className="flex-1 overflow-y-auto pt-8">
        <div className="mx-auto p-6">
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 text-lg font-semibold"
            initial={{ opacity: 0, y: -8 }}
            key={activeSection}
            transition={{ delay: 0.1, duration: 0.3, ease: EASE_CURVE }}
          >
            {activeSectionLabel}
          </motion.h1>

          {activeSection === "general" && (
            <div className="space-y-8">
              <motion.section
                {...sectionAnimation(0.15)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.language.title")}
                </h2>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("settings.language.label")}
                  </h3>
                  <LanguageSelect
                    onChange={handleLocaleChange}
                    value={draft.locale}
                  />
                </div>
              </motion.section>

              <motion.section
                {...sectionAnimation(0.25)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.appIcon.title")}
                </h2>

                <p className="text-xs text-muted-foreground">
                  {t("settings.appIcon.description")}
                </p>

                <AppIconSelector
                  onChange={handleAppIconChange}
                  value={draft.appIcon}
                />
              </motion.section>

              <motion.section
                {...sectionAnimation(0.35)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.startup.title")}
                </h2>

                <AutoStartCheckbox
                  onChange={handleAutoStartChange}
                  value={draft.autoStart}
                />
              </motion.section>
            </div>
          )}

          {activeSection === "color-schema" && (
            <div className="space-y-8">
              <motion.section {...sectionAnimation(0.25)} className="space-y-4">
                <CustomThemesTab
                  onCreateTheme={handleCustomThemeCreate}
                  onDeleteTheme={handleCustomThemeDelete}
                  themes={draft.customThemes}
                />
              </motion.section>

              <motion.section
                {...sectionAnimation(0.15)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.colorScheme.title")}
                </h2>

                <p className="text-xs text-muted-foreground">
                  {t("settings.colorScheme.description")}
                </p>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("settings.colorScheme.dark.label")}
                  </h3>
                  <ColorSchemaSelector
                    onChange={handleDarkColorSchemaChange}
                    options={darkColorSchemaOptions}
                    value={draft.darkColorSchema}
                  />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("settings.colorScheme.light.label")}
                  </h3>
                  <ColorSchemaSelector
                    onChange={handleLightColorSchemaChange}
                    options={lightColorSchemaOptions}
                    value={draft.lightColorSchema}
                  />
                </div>
              </motion.section>
            </div>
          )}

          {activeSection === "user-interface" && (
            <div className="space-y-8">
              <motion.section
                {...sectionAnimation(0.15)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.theme.title")}
                </h2>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("settings.theme.appearance")}
                  </h3>
                  <ThemeSelector
                    onChange={handleThemeChange}
                    options={themeOptions}
                    value={draft.theme}
                  />
                </div>
              </motion.section>

              <motion.section
                {...sectionAnimation(0.25)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.fonts.title")}
                </h2>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("settings.fonts.family.label")}
                  </h3>
                  <FontFamilyCombobox
                    onChange={handleFontFamilyChange}
                    value={draft.fontFamily}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("settings.fonts.family.description")}
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("settings.fonts.size.label")}
                  </h3>
                  <FontSizeInput
                    onChange={handleFontSizeChange}
                    value={draft.fontSize}
                  />
                </div>
              </motion.section>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {isDirty && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
            exit={{ opacity: 0, y: 8 }}
            initial={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: EASE_CURVE }}
          >
            <Button
              disabled={updateMutation.isPending}
              onClick={handleCancel}
              variant="ghost"
            >
              {t("settings.common.cancel")}
            </Button>
            <Button disabled={updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending
                ? t("settings.common.saving")
                : t("settings.common.save")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
