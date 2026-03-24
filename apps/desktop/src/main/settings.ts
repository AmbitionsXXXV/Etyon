import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { AppSettings } from "@etyon/rpc"
import { app } from "electron"
import ElectronStore from "electron-store"

import { hydrateAiSettingsProviders } from "@/shared/providers/provider-catalog"

const SETTINGS_DIR = path.join(app.getPath("home"), ".config", "etyon")

const parseStoredSettings = (value: unknown): AppSettings => {
  const parsedSettings = AppSettingsSchema.parse(value ?? {})
  const rawAiSettings =
    typeof value === "object" && value !== null && "ai" in value
      ? (value as { ai?: unknown }).ai
      : undefined

  return {
    ...parsedSettings,
    ai: hydrateAiSettingsProviders(parsedSettings.ai, rawAiSettings)
  }
}

const DEFAULTS: AppSettings = parseStoredSettings({})

const store = new ElectronStore({
  cwd: SETTINGS_DIR,
  defaults: { settings: DEFAULTS },
  name: "settings"
})

export const getSettings = (): AppSettings =>
  parseStoredSettings(store.get("settings"))

export const updateSettings = (partial: Partial<AppSettings>): AppSettings => {
  const current = getSettings()
  const next = parseStoredSettings({ ...current, ...partial })
  store.set("settings", next)
  return next
}
