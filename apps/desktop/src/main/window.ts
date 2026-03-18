/* eslint-disable unicorn/prefer-module -- Electron main process requires CommonJS */
import path from "node:path"

import { is, platform } from "@electron-toolkit/utils"
import { BrowserWindow } from "electron"

const preloadPath = path.join(__dirname, "preload.js")

const loadRenderer = (win: BrowserWindow, query = "") => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    if (query) {
      url.searchParams.set("window", query)
    }
    win.loadURL(url.toString())
  } else {
    const filePath = path.join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
    )
    win.loadFile(filePath, query ? { query: { window: query } } : undefined)
  }
}

export const createWindow = () => {
  const mainWindow = new BrowserWindow({
    height: 600,
    titleBarStyle: "hidden",
    ...(platform.isMacOS ? {} : { titleBarOverlay: { height: 36 } }),
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: { preload: preloadPath },
    width: 800
  })

  loadRenderer(mainWindow)

  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  return mainWindow
}

let settingsWindow: BrowserWindow | null = null

export const createSettingsWindow = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    height: 520,
    maximizable: false,
    minHeight: 400,
    minWidth: 520,
    title: "Settings",
    titleBarStyle: "hidden",
    ...(platform.isMacOS
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : { titleBarOverlay: { height: 36 } }),
    webPreferences: { preload: preloadPath },
    width: 680
  })

  settingsWindow.center()
  loadRenderer(settingsWindow, "settings")

  settingsWindow.on("closed", () => {
    settingsWindow = null
  })

  return settingsWindow
}
