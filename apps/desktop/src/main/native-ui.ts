import { getAppDisplayName } from "./app-metadata"
import { setupMenu } from "./menu"
import { refreshTray } from "./tray"
import { syncSettingsWindowTitle } from "./window"

export const refreshLocalizedAppShell = () => {
  refreshTray()
  setupMenu(getAppDisplayName())
  syncSettingsWindowTitle()
}
