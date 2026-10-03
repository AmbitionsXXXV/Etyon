import { useEffect } from "react"

import { router } from "@/renderer/router"

export const useRuntimeNavigation = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    return window.electron.ipcRenderer.on(
      "automation-open-session",
      (_event, sessionId: unknown) => {
        if (typeof sessionId === "string") {
          void router.navigate({
            params: { sessionId },
            to: "/chat/$sessionId"
          })
        }
      }
    )
  }, [enabled])
}
