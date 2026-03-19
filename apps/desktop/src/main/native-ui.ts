import { setupMenu } from "./menu"
import { syncSettingsWindowTitle } from "./window"

export const refreshLocalizedAppShell = () => {
  setupMenu()
  syncSettingsWindowTitle()
}
