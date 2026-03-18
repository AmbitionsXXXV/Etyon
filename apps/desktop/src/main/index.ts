import { optimizer, platform } from "@electron-toolkit/utils"
/* eslint-disable unicorn/prefer-module -- Electron main process requires CommonJS */
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
