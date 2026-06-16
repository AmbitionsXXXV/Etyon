import { useI18n } from "@etyon/i18n/react"
import type { BuiltInPlugin } from "@etyon/rpc"
import { ScrollArea } from "@etyon/ui/components/scroll-area"
import { Skeleton } from "@etyon/ui/components/skeleton"
import { cn } from "@etyon/ui/lib/utils"
import { Switch } from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useCallback, useMemo, useState } from "react"

import { rpcClient } from "@/renderer/lib/rpc"
import { SETTINGS_PAGE_EASE_CURVE } from "@/renderer/lib/settings-page/constants"

const PluginListItem = ({
  isActive,
  onSelect,
  plugin
}: {
  isActive: boolean
  onSelect: (pluginId: BuiltInPlugin["id"]) => void
  plugin: BuiltInPlugin
}) => {
  const handleSelect = useCallback(() => {
    onSelect(plugin.id)
  }, [onSelect, plugin.id])

  return (
    <button
      className={cn(
        "w-full rounded-xl border px-3 py-3 text-left transition-colors",
        isActive
          ? "border-primary/50 bg-primary/10"
          : "border-border hover:border-primary/20 hover:bg-muted/40"
      )}
      onClick={handleSelect}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{plugin.name}</span>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            plugin.enabled ? "bg-primary" : "bg-muted-foreground/40"
          )}
        />
      </div>
      <p className="mt-1 line-clamp-2 text-[0.6875rem] text-muted-foreground">
        {plugin.description}
      </p>
    </button>
  )
}

const PluginDetailPanel = ({
  activePlugin,
  isUpdating,
  onEnabledChange
}: {
  activePlugin: BuiltInPlugin | undefined
  isUpdating: boolean
  onEnabledChange: (enabled: boolean) => void
}) => {
  const { t } = useI18n()

  if (!activePlugin) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80 p-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-base font-semibold">{activePlugin.name}</h3>
          <p className="text-xs text-muted-foreground">
            {activePlugin.description}
          </p>
        </div>

        <Switch
          aria-label={t("settings.plugins.enable.label", {
            name: activePlugin.name
          })}
          isDisabled={isUpdating}
          isSelected={activePlugin.enabled}
          onChange={onEnabledChange}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>

      <ScrollArea className="mt-4 min-h-0 flex-1">
        <div className="space-y-4 pr-2">
          <div className="rounded-xl border border-border bg-background/50 p-3">
            <p className="text-xs text-muted-foreground">
              {t("settings.plugins.enable.description")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {activePlugin.capabilities.map((capability) => (
              <span
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground"
                key={capability}
              >
                {capability}
              </span>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

export const PluginsTab = () => {
  const queryClient = useQueryClient()
  const [activePluginId, setActivePluginId] =
    useState<BuiltInPlugin["id"]>("cursor-auth")

  const pluginsQuery = useQuery({
    queryFn: () => rpcClient.plugins.list(),
    queryKey: ["plugins", "list"]
  })

  const setEnabledMutation = useMutation({
    mutationFn: ({
      enabled,
      pluginId
    }: {
      enabled: boolean
      pluginId: BuiltInPlugin["id"]
    }) => rpcClient.plugins.setEnabled({ enabled, pluginId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plugins", "list"] })
    }
  })

  const plugins = useMemo(
    () => pluginsQuery.data?.plugins ?? [],
    [pluginsQuery.data?.plugins]
  )

  const activePlugin = useMemo(
    () => plugins.find((plugin) => plugin.id === activePluginId) ?? plugins[0],
    [activePluginId, plugins]
  )

  const handlePluginSelect = useCallback((pluginId: BuiltInPlugin["id"]) => {
    setActivePluginId(pluginId)
  }, [])

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      if (!activePlugin) {
        return
      }

      setEnabledMutation.mutate({
        enabled,
        pluginId: activePlugin.id
      })
    },
    [activePlugin, setEnabledMutation]
  )

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="grid h-full min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-[14.5rem_minmax(0,1fr)]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.28, ease: SETTINGS_PAGE_EASE_CURVE }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80 p-3">
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 pr-2">
            {pluginsQuery.isPending && (
              <>
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </>
            )}

            {plugins.map((plugin) => (
              <PluginListItem
                isActive={plugin.id === activePlugin?.id}
                key={plugin.id}
                onSelect={handlePluginSelect}
                plugin={plugin}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      <PluginDetailPanel
        activePlugin={activePlugin}
        isUpdating={setEnabledMutation.isPending}
        onEnabledChange={handleEnabledChange}
      />
    </motion.section>
  )
}
