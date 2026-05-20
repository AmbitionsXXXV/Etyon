import type { BuiltInPlugin, BuiltInPluginId } from "@etyon/rpc"

import { isBuiltInPluginEnabled, setBuiltInPluginEnabled } from "./plugin-store"

const BUILT_IN_PLUGIN_DEFINITIONS: readonly Omit<BuiltInPlugin, "enabled">[] = [
  {
    capabilities: ["provider-auth", "provider-models"],
    description:
      "Built-in Cursor subscription authentication bridge with OAuth token storage.",
    id: "cursor-auth",
    name: "Cursor Auth",
    permissions: [
      "network:api2.cursor.sh",
      "network:cursor.com",
      "os:open-external-url",
      "storage:secrets"
    ]
  }
]

export const listBuiltInPlugins = (): BuiltInPlugin[] =>
  BUILT_IN_PLUGIN_DEFINITIONS.map((plugin) => ({
    capabilities: [...plugin.capabilities],
    description: plugin.description,
    enabled: isBuiltInPluginEnabled(plugin.id),
    id: plugin.id,
    name: plugin.name,
    permissions: [...plugin.permissions]
  }))

export const setBuiltInPluginEnabledState = (
  pluginId: BuiltInPluginId,
  enabled: boolean
): BuiltInPlugin[] => {
  setBuiltInPluginEnabled(pluginId, enabled)

  return listBuiltInPlugins()
}
