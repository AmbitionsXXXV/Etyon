/* eslint-disable unicorn/prefer-module -- Electron main process requires CommonJS */
import { app, BrowserWindow } from "electron"
import started from "electron-squirrel-startup"

import { createWindow } from "./window"

if (started) {
  app.quit()
}

app.on("ready", createWindow)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
