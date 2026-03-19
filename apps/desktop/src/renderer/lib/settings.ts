import type { AppSettings, Theme } from "@etyon/rpc"

export const applyThemePreview = (theme: Theme) => {
  const root = document.documentElement
  root.classList.add("theme-transitioning")
  root.classList.remove("dark", "light")
  if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
    root.classList.toggle("dark", prefersDark)
  } else {
    root.classList.add(theme)
  }
  setTimeout(() => {
    root.classList.remove("theme-transitioning")
  }, 200)
}

export const applySettings = (settings: AppSettings) => {
  applyThemePreview(settings.theme)

  const fontFamily =
    settings.fontFamily === "System Default"
      ? '"Inter Variable", system-ui, sans-serif'
      : `"${settings.fontFamily}", "Inter Variable", sans-serif`

  const root = document.documentElement
  root.style.setProperty("--user-font-family", fontFamily)
  root.style.setProperty("--user-font-size", `${settings.fontSize}px`)
}
