import path from "node:path"

import type { AppSettings } from "@etyon/rpc"
import { app } from "electron"
import ElectronStore from "electron-store"

const SETTINGS_DIR = path.join(app.getPath("home"), ".config", "etyon")

const DEFAULTS: AppSettings = {
  fontFamily: "System Default",
  fontSize: 16,
  theme: "system"
}

const store = new ElectronStore({
  cwd: SETTINGS_DIR,
  defaults: { settings: DEFAULTS },
  name: "settings"
})

export const getSettings = (): AppSettings =>
  (store.get("settings") as AppSettings) ?? DEFAULTS

export const updateSettings = (partial: Partial<AppSettings>): AppSettings => {
  const current = (store.get("settings") as AppSettings) ?? DEFAULTS
  const next = { ...current, ...partial }
  store.set("settings", next)
  return next
}
