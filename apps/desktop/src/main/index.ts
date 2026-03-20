import { optimizer, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow, ipcMain } from "electron"
import started from "electron-squirrel-startup"

import { createRuntimeIcon, getAppDisplayName } from "./app-metadata"
import { setupMenu } from "./menu"
import { registerRpcHandler } from "./rpc"
import { getSettings } from "./settings"
import { shouldStartMainWindowHidden, syncStartupSettings } from "./startup"
import { destroyTray, setupTray } from "./tray"
import {
  createSettingsWindow,
  createWindow,
  focusOrCreateMainWindow,
  isAppQuitting,
  setAppQuitting
} from "./window"

if (started) {
  app.quit()
}

app.on("ready", () => {
  const appDisplayName = getAppDisplayName()
  const appIcon = createRuntimeIcon()

  app.setName(appDisplayName)

  if (platform.isMacOS && appIcon) {
    app.dock?.setIcon(appIcon)
  }

  const settings = getSettings()

  if (settings.autoStart) {
    syncStartupSettings(settings)
  }
  registerRpcHandler()
  setupMenu(appDisplayName)
  setupTray()

  ipcMain.on("open-settings", () => {
    createSettingsWindow()
  })

  ipcMain.on(
    "settings-preview-color-schemas",
    (
      event,
      preview: Pick<AppSettings, "darkColorSchema" | "lightColorSchema">
    ) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents.id !== event.sender.id) {
          win.webContents.send("settings-preview-color-schemas", preview)
        }
      }
    }
  )

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (!shouldStartMainWindowHidden(settings)) {
    createWindow()
  }
})

app.on("window-all-closed", () => {
  if (isAppQuitting()) {
    destroyTray()
  }
})

app.on("before-quit", () => {
  setAppQuitting(true)
  destroyTray()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 || platform.isMacOS) {
    focusOrCreateMainWindow()
  }
})
