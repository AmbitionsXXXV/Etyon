import type { AppSettings, Theme } from "@etyon/rpc"

import { resolveHeroUiProThemeName } from "@/renderer/lib/color-schema/heroui-pro-themes"
import type { HeroUiProThemeName } from "@/renderer/lib/color-schema/heroui-pro-themes"

import brutalismThemeUrl from "@etyon/ui/themes/brutalism.css?url"
import glassThemeUrl from "@etyon/ui/themes/glass.css?url"
import mouveThemeUrl from "@etyon/ui/themes/mouve.css?url"

const THEME_TRANSITION_MS = 200

/**
 * The pro color schemas (brutalism/glass/mouve) apply through this stylesheet
 * link, which loads asynchronously after the `data-theme` flip. Exported so
 * consumers that rasterize CSS variables (the terminal theme) can re-resolve
 * once the sheet actually lands.
 */
export const HEROUI_PRO_THEME_STYLESHEET_ID = "etyon-heroui-pro-theme"

const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

type ColorSchemaSettings = Pick<
  AppSettings,
  "darkColorSchema" | "lightColorSchema"
>

type ThemeColorSettings = ColorSchemaSettings & Pick<AppSettings, "theme">

const HEROUI_PRO_THEME_STYLESHEET_URLS = {
  brutalism: brutalismThemeUrl,
  glass: glassThemeUrl,
  mouve: mouveThemeUrl
} as const satisfies Record<HeroUiProThemeName, string>

const syncHeroUiProThemeStylesheet = (themeName: string) => {
  const proThemeName = resolveHeroUiProThemeName(themeName)
  const existingLink = document.head.querySelector<HTMLLinkElement>(
    `#${HEROUI_PRO_THEME_STYLESHEET_ID}`
  )

  if (!proThemeName) {
    existingLink?.remove()
    return
  }

  const href = HEROUI_PRO_THEME_STYLESHEET_URLS[proThemeName]
  const resolvedHref = new URL(href, window.location.href).href

  if (existingLink) {
    if (existingLink.href !== resolvedHref) {
      existingLink.href = href
    }
    return
  }

  const link = document.createElement("link")
  link.href = href
  link.id = HEROUI_PRO_THEME_STYLESHEET_ID
  link.rel = "stylesheet"
  document.head.append(link)
}

const resolvePrefersDark = (theme: Theme) =>
  theme === "system" ? darkMediaQuery.matches : theme === "dark"

const resolveThemeName = (
  { darkColorSchema, lightColorSchema }: ColorSchemaSettings,
  prefersDark: boolean
) => {
  const colorSchema = prefersDark ? darkColorSchema : lightColorSchema

  if (colorSchema === "default") {
    return prefersDark ? "dark" : "light"
  }

  return colorSchema
}

const clearLegacyColorSchemaAttributes = (root: HTMLElement) => {
  delete root.dataset.darkColorSchema
  delete root.dataset.lightColorSchema
}

const resolveCurrentPrefersDark = () => {
  const root = document.documentElement

  if (root.classList.contains("dark")) {
    return true
  }

  if (root.classList.contains("light")) {
    return false
  }

  return darkMediaQuery.matches
}

const applyResolvedColorTheme = (
  settings: ColorSchemaSettings,
  prefersDark: boolean
) => {
  const root = document.documentElement
  const themeName = resolveThemeName(settings, prefersDark)
  clearLegacyColorSchemaAttributes(root)
  root.dataset.theme = themeName
  syncHeroUiProThemeStylesheet(themeName)
}

const beginThemeTransition = () => {
  const root = document.documentElement
  root.classList.add("theme-transitioning")
  setTimeout(() => {
    root.classList.remove("theme-transitioning")
  }, THEME_TRANSITION_MS)
}

const applyThemeClass = (theme: Theme) => {
  const prefersDark = resolvePrefersDark(theme)
  const root = document.documentElement
  root.classList.remove("dark", "light")
  root.classList.toggle("dark", prefersDark)
  root.classList.toggle("light", !prefersDark)
  return prefersDark
}

const applyThemeSettings = (settings: ThemeColorSettings) => {
  const prefersDark = applyThemeClass(settings.theme)
  applyResolvedColorTheme(settings, prefersDark)
}

export const applyColorSchemaPreview = (settings: ColorSchemaSettings) => {
  beginThemeTransition()
  applyResolvedColorTheme(settings, resolveCurrentPrefersDark())
}

export const applySettings = (settings: AppSettings) => {
  applyThemeSettings(settings)

  const fontFamily =
    settings.fontFamily === "System Default"
      ? '"Inter Variable", system-ui, sans-serif'
      : `"${settings.fontFamily}", "Inter Variable", sans-serif`

  const root = document.documentElement
  root.style.setProperty("--user-font-family", fontFamily)
  root.style.setProperty("--user-font-size", `${settings.fontSize}px`)
}

export const watchSystemTheme = (
  getCurrentSettings: () => ThemeColorSettings,
  onSystemChange?: () => void
) => {
  const handler = () => {
    const settings = getCurrentSettings()

    if (settings.theme === "system") {
      beginThemeTransition()
      applyThemeSettings(settings)
      onSystemChange?.()
    }
  }

  darkMediaQuery.addEventListener("change", handler)
  return () => darkMediaQuery.removeEventListener("change", handler)
}
