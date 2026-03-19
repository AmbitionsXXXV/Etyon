import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { AppSettings } from "@etyon/rpc"
import { app } from "electron"
import ElectronStore from "electron-store"

const SETTINGS_DIR = path.join(app.getPath("home"), ".config", "etyon")

const DEFAULTS: AppSettings = AppSettingsSchema.parse({})

const parseStoredSettings = (value: unknown): AppSettings =>
  AppSettingsSchema.parse(value ?? {})

const store = new ElectronStore({
  cwd: SETTINGS_DIR,
  defaults: { settings: DEFAULTS },
  name: "settings"
})

export const getSettings = (): AppSettings =>
  parseStoredSettings(store.get("settings"))

export const updateSettings = (partial: Partial<AppSettings>): AppSettings => {
  const current = getSettings()
  const next = AppSettingsSchema.parse({ ...current, ...partial })
  store.set("settings", next)
  return next
}
