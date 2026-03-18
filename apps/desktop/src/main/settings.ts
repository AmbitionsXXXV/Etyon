import path from "node:path"

import type { AppSettings } from "@etyon/rpc"
import { app } from "electron"

const SETTINGS_DIR = path.join(app.getPath("home"), ".config", "etyon")

const DEFAULTS: AppSettings = {
  fontFamily: "System Default",
  fontSize: 16,
  theme: "system"
}

interface Store {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}
let store: Store | null = null

const getStore = async (): Promise<Store> => {
  if (store) {
    return store
  }
  const { default: ElectronStore } = await import("electron-store")
  store = new ElectronStore({
    cwd: SETTINGS_DIR,
    defaults: { settings: DEFAULTS },
    name: "settings"
  }) as Store
  return store
}

export const getSettings = async (): Promise<AppSettings> => {
  const s = await getStore()
  return (s.get("settings") as AppSettings) ?? DEFAULTS
}

export const updateSettings = async (
  partial: Partial<AppSettings>
): Promise<AppSettings> => {
  const s = await getStore()
  const current = (s.get("settings") as AppSettings) ?? DEFAULTS
  const next = { ...current, ...partial }
  s.set("settings", next)
  return next
}
