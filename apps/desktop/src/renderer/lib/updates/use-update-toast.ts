import { useI18n } from "@etyon/i18n/react"
import type { UpdateStatus } from "@etyon/rpc"
import { toast } from "@etyon/ui/components/sonner"
import { useEffect } from "react"

import { rpcClient } from "@/renderer/lib/rpc"
import { shouldNotify } from "@/shared/updates/core"

const ABOUT_SETTINGS_TAB = "about"

/**
 * The only toast in the app: fires once per newly published version found by a
 * background check, then records the version so a later check stays quiet.
 * Manual checks and every failure mode report inside the About tab instead.
 */
export const useUpdateToast = ({ enabled }: { enabled: boolean }): void => {
  const { t } = useI18n()

  useEffect(() => {
    if (!enabled) {
      return
    }

    let isActive = true
    const claimedVersions = new Set<string>()

    const handleStatus = async (status: UpdateStatus): Promise<void> => {
      const version = status.available?.version

      if (
        !version ||
        status.checkReason !== "auto" ||
        status.state !== "available" ||
        claimedVersions.has(version)
      ) {
        return
      }

      claimedVersions.add(version)

      try {
        const settings = await rpcClient.settings.get()

        if (
          !isActive ||
          !shouldNotify(status, settings.updates.lastNotifiedVersion)
        ) {
          return
        }

        toast(t("settings.about.updates.toast.title", { version }), {
          action: {
            label: t("settings.about.updates.toast.action"),
            onClick: () => {
              window.electron.ipcRenderer.send(
                "open-settings",
                ABOUT_SETTINGS_TAB
              )
            }
          }
        })

        await rpcClient.settings.update({
          updates: { ...settings.updates, lastNotifiedVersion: version }
        })
      } catch {
        claimedVersions.delete(version)
      }
    }

    const removeStatusListener = window.electron.onUpdatesStatusChanged(
      (status) => {
        void handleStatus(status)
      }
    )

    const replayCachedStatus = async (): Promise<void> => {
      try {
        const status = await rpcClient.updates.status()
        await handleStatus(status)
      } catch {
        // A later scheduled check or remount retries.
      }
    }

    // Replaying the cached status covers release builds that completed their
    // first automatic check while startup intentionally kept the main window
    // closed. Register the listener first so a concurrent check cannot be lost.
    void replayCachedStatus()

    return () => {
      isActive = false
      removeStatusListener()
    }
  }, [enabled, t])
}
