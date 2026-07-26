import { subscribeBrowserState } from "@/main/browser/manager"
import { getMainWindow } from "@/main/window"

const BROWSER_STATE_CHANNEL = "browser:state"

export const registerBrowserIpcHandlers = (): void => {
  subscribeBrowserState((push) => {
    const window = getMainWindow()

    if (!window || window.webContents.isDestroyed()) {
      return
    }

    window.webContents.send(BROWSER_STATE_CHANNEL, push)
  })
}
