import type { BuiltInPluginId } from "@etyon/rpc"
import ElectronStore from "electron-store"

const PLUGIN_STORE_NAME = "built-in-plugins"

interface PluginStoreState {
  enabledById?: Partial<Record<BuiltInPluginId, boolean>>
}

const store = new ElectronStore<PluginStoreState>({
  clearInvalidConfig: true,
  name: PLUGIN_STORE_NAME
})

const DEFAULT_PLUGIN_ENABLED: Record<BuiltInPluginId, boolean> = {
  "cursor-auth": true
}

export const isBuiltInPluginEnabled = (pluginId: BuiltInPluginId): boolean => {
  const enabledById = store.get("enabledById")

  if (!enabledById || !(pluginId in enabledById)) {
    return DEFAULT_PLUGIN_ENABLED[pluginId]
  }

  return Boolean(enabledById[pluginId])
}

export const setBuiltInPluginEnabled = (
  pluginId: BuiltInPluginId,
  enabled: boolean
): void => {
  const enabledById = store.get("enabledById") ?? {}

  store.set("enabledById", {
    ...enabledById,
    [pluginId]: enabled
  })
}
