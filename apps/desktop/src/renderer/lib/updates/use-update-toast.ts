import { useI18n } from "@etyon/i18n/react"
import type { UpdateStatus } from "@etyon/rpc"
import { toast } from "@etyon/ui/components/sonner"
import { shouldNotify } from "@main/updates/core"
import { useEffect } from "react"

import { rpcClient } from "@/renderer/lib/rpc"

const ABOUT_SETTINGS_TAB = "about"

/**
 * The only toast in the app: fires once per newly published version found by a
 * background check, then records the version so a later check stays quiet.
 * Manual checks and every failure mode report inside the About tab instead.
 */
export const useUpdateToast = (): void => {
  const { t } = useI18n()

  useEffect(() => {
    const handleStatus = async (status: UpdateStatus): Promise<void> => {
      try {
        const settings = await rpcClient.settings.get()

        if (
          !status.available ||
          !shouldNotify(status, settings.updates.lastNotifiedVersion)
        ) {
          return
        }

        const { version } = status.available

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
        // A failed settings read or write only costs this one notification; the
        // next scheduled check retries.
      }
    }

    return window.electron.onUpdatesStatusChanged((status) => {
      void handleStatus(status)
    })
  }, [t])
}
