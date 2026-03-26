import { optimizer, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow, ipcMain } from "electron"
import started from "electron-squirrel-startup"

import { createRuntimeIcon, getAppDisplayName } from "@/main/app-metadata"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { logger } from "@/main/logger"
import { setupMenu } from "@/main/menu"
import { registerRpcHandler } from "@/main/rpc"
import { startServer, stopServer } from "@/main/server"
import { getSettings } from "@/main/settings"
import {
  shouldStartMainWindowHidden,
  syncStartupSettings
} from "@/main/startup"
import { destroyTray, setupTray } from "@/main/tray"
import {
  createSettingsWindow,
  createWindow,
  focusOrCreateMainWindow,
  isAppQuitting,
  setAppQuitting
} from "@/main/window"

if (started) {
  app.quit()
}

const handleAppReady = async (): Promise<void> => {
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

  await ensureDatabaseReady()

  registerRpcHandler()
  await startServer()
  setupMenu(appDisplayName)
  setupTray()

  ipcMain.on("open-settings", (_event, tab?: string) => {
    createSettingsWindow(tab)
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
}

app.on("ready", async () => {
  try {
    await handleAppReady()
  } catch (error: unknown) {
    logger.error("app_ready_failed", { error })
    app.quit()
  }
})

app.on("window-all-closed", () => {
  if (isAppQuitting()) {
    destroyTray()
  }
})

app.on("before-quit", () => {
  setAppQuitting(true)
  stopServer()
  destroyTray()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 || platform.isMacOS) {
    focusOrCreateMainWindow()
  }
})
