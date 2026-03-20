import type { AppSettings, Theme } from "@etyon/rpc"

const THEME_TRANSITION_MS = 200

const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

const resolvePrefersDark = (theme: Theme) =>
  theme === "system" ? darkMediaQuery.matches : theme === "dark"

const applyColorSchemas = ({
  darkColorSchema,
  lightColorSchema
}: Pick<AppSettings, "darkColorSchema" | "lightColorSchema">) => {
  const root = document.documentElement
  root.dataset.darkColorSchema = darkColorSchema
  root.dataset.lightColorSchema = lightColorSchema
}

export const applyColorSchemaPreview = (
  settings: Pick<AppSettings, "darkColorSchema" | "lightColorSchema">
) => {
  const root = document.documentElement
  root.classList.add("theme-transitioning")
  applyColorSchemas(settings)
  setTimeout(() => {
    root.classList.remove("theme-transitioning")
  }, THEME_TRANSITION_MS)
}

const applyTheme = (theme: Theme) => {
  const prefersDark = resolvePrefersDark(theme)
  const root = document.documentElement
  root.classList.remove("dark", "light")
  root.classList.toggle("dark", prefersDark)
  root.classList.toggle("light", !prefersDark)
}

export const applyThemePreview = (theme: Theme) => {
  const root = document.documentElement
  root.classList.add("theme-transitioning")
  applyTheme(theme)
  setTimeout(() => {
    root.classList.remove("theme-transitioning")
  }, THEME_TRANSITION_MS)
}

export const applySettings = (settings: AppSettings) => {
  applyTheme(settings.theme)
  applyColorSchemas(settings)

  const fontFamily =
    settings.fontFamily === "System Default"
      ? '"Inter Variable", system-ui, sans-serif'
      : `"${settings.fontFamily}", "Inter Variable", sans-serif`

  const root = document.documentElement
  root.style.setProperty("--user-font-family", fontFamily)
  root.style.setProperty("--user-font-size", `${settings.fontSize}px`)
}

export const watchSystemTheme = (
  getCurrentTheme: () => Theme,
  onSystemChange: () => void
) => {
  const handler = () => {
    if (getCurrentTheme() === "system") {
      applyThemePreview("system")
      onSystemChange()
    }
  }

  darkMediaQuery.addEventListener("change", handler)
  return () => darkMediaQuery.removeEventListener("change", handler)
}
