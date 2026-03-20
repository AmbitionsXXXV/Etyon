import { optimizer, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow, ipcMain } from "electron"
import started from "electron-squirrel-startup"

import { setupMenu } from "./menu"
import { registerRpcHandler } from "./rpc"
import { createSettingsWindow, createWindow } from "./window"

if (started) {
  app.quit()
}

app.on("ready", () => {
  registerRpcHandler()
  setupMenu()

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

  createWindow()
})

app.on("window-all-closed", () => {
  if (!platform.isMacOS) {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
