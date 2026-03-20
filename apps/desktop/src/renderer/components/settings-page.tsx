import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import { Skeleton } from "@etyon/ui/components/skeleton"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useMemo, useState } from "react"

import {
  buildDarkColorSchemaOptions,
  buildLightColorSchemaOptions
} from "@/renderer/lib/settings-page/build-color-schema-options"
import { buildThemeOptions } from "@/renderer/lib/settings-page/build-theme-options"
import {
  SETTINGS_PAGE_EASE_CURVE,
  SETTINGS_PAGE_SIDEBAR_WIDTH_CLASS
} from "@/renderer/lib/settings-page/constants"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"
import {
  SETTINGS_NAV_ENTRIES,
  SETTINGS_NAV_LABEL_KEY_BY_SECTION
} from "@/renderer/lib/settings-page/nav-config"
import type { SettingsSectionId } from "@/renderer/lib/settings-page/nav-config"
import { useSettingsPageDraft } from "@/renderer/lib/settings-page/use-settings-page-draft"

import { ColorSchemaTab } from "./settings/color-schema"
import {
  AppIconSelector,
  AutoStartCheckbox,
  CloseToTrayCheckbox,
  LanguageSelect,
  MinimizeToTrayCheckbox,
  StartMinimizedToTrayCheckbox
} from "./settings/general-tab"
import { NavButton } from "./settings/nav-button"
import {
  FontFamilyCombobox,
  FontSizeInput,
  ThemeSelector
} from "./settings/ui-tab"

export const SettingsPage = () => {
  const { t } = useI18n()
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("general")

  const {
    draft,
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
  } = useSettingsPageDraft()

  const handleNavSelect = useCallback((id: SettingsSectionId) => {
    setActiveSection(id)
  }, [])

  const navItems = useMemo(
    () =>
      SETTINGS_NAV_ENTRIES.map((entry) => ({
        handleSelect: () => handleNavSelect(entry.id),
        icon: entry.icon,
        id: entry.id,
        label: t(SETTINGS_NAV_LABEL_KEY_BY_SECTION[entry.id])
      })),
    [handleNavSelect, t]
  )

  const activeSectionLabel = useMemo(
    () => navItems.find((item) => item.id === activeSection)?.label ?? "",
    [activeSection, navItems]
  )

  const themeOptions = useMemo(() => buildThemeOptions(t), [t])
  const darkColorSchemaOptions = useMemo(
    () => buildDarkColorSchemaOptions(t),
    [t]
  )
  const lightColorSchemaOptions = useMemo(
    () => buildLightColorSchemaOptions(t),
    [t]
  )

  const sidebarChromeClassName = `${SETTINGS_PAGE_SIDEBAR_WIDTH_CLASS} shrink-0 border-r border-border bg-background p-3 pt-10`

  if (!draft) {
    return (
      <div className="flex h-svh">
        <aside className={sidebarChromeClassName}>
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

              <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-32" />
                <div className="space-y-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-44" />
                </div>
                <Skeleton className="h-3 w-72" />
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
        className={sidebarChromeClassName}
        initial={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.3, ease: SETTINGS_PAGE_EASE_CURVE }}
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
            transition={{
              delay: 0.1,
              duration: 0.3,
              ease: SETTINGS_PAGE_EASE_CURVE
            }}
          >
            {activeSectionLabel}
          </motion.h1>

          {activeSection === "general" && (
            <div className="space-y-8">
              <motion.section
                {...settingsPageSectionMotion(0.15)}
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
                {...settingsPageSectionMotion(0.25)}
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
                {...settingsPageSectionMotion(0.35)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.startup.title")}
                </h2>

                <div className="space-y-3">
                  <AutoStartCheckbox
                    onChange={handleAutoStartChange}
                    value={draft.autoStart}
                  />

                  <StartMinimizedToTrayCheckbox
                    onChange={handleStartMinimizedToTrayChange}
                    value={draft.startMinimizedToTray}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {t("settings.startup.description")}
                </p>
              </motion.section>

              <motion.section
                {...settingsPageSectionMotion(0.45)}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
              >
                <h2 className="text-sm font-semibold">
                  {t("settings.windowBehavior.title")}
                </h2>

                <div className="space-y-3">
                  <MinimizeToTrayCheckbox
                    onChange={handleMinimizeToTrayChange}
                    value={draft.minimizeToTray}
                  />

                  <CloseToTrayCheckbox
                    onChange={handleCloseToTrayChange}
                    value={draft.closeToTray}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {t("settings.windowBehavior.description")}
                </p>
              </motion.section>
            </div>
          )}

          {activeSection === "color-schema" && (
            <ColorSchemaTab
              darkColorSchema={draft.darkColorSchema}
              darkColorSchemaOptions={darkColorSchemaOptions}
              lightColorSchema={draft.lightColorSchema}
              lightColorSchemaOptions={lightColorSchemaOptions}
              onCreateTheme={handleCustomThemeCreate}
              onDarkColorSchemaChange={handleDarkColorSchemaChange}
              onDeleteTheme={handleCustomThemeDelete}
              onLightColorSchemaChange={handleLightColorSchemaChange}
              themes={draft.customThemes}
            />
          )}

          {activeSection === "user-interface" && (
            <div className="space-y-8">
              <motion.section
                {...settingsPageSectionMotion(0.15)}
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
                {...settingsPageSectionMotion(0.25)}
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
            transition={{ duration: 0.2, ease: SETTINGS_PAGE_EASE_CURVE }}
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
