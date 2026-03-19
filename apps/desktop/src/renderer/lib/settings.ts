import type { AppSettings } from "@etyon/rpc"

export const applySettings = (settings: AppSettings) => {
  const root = document.documentElement

  root.classList.add("theme-transitioning")

  root.classList.remove("dark", "light")
  if (settings.theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
    root.classList.toggle("dark", prefersDark)
  } else {
    root.classList.add(settings.theme)
  }

  const fontFamily =
    settings.fontFamily === "System Default"
      ? '"Inter Variable", system-ui, sans-serif'
      : `"${settings.fontFamily}", "Inter Variable", sans-serif`

  root.style.setProperty("--user-font-family", fontFamily)
  root.style.setProperty("--user-font-size", `${settings.fontSize}px`)

  setTimeout(() => {
    root.classList.remove("theme-transitioning")
  }, 200)
}
