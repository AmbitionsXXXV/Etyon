import path from "node:path"
import { fileURLToPath } from "node:url"

import { is, platform } from "@electron-toolkit/utils"
import { BrowserWindow } from "electron"

import { translate } from "./localization"
import { getSettings } from "./settings"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
    syncSettingsWindowTitle()
    settingsWindow.focus()
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    height: 520,
    maximizable: false,
    minHeight: 400,
    minWidth: 520,
    title: translate("window.settings.title"),
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
    const currentSettings = getSettings()
    const preview = {
      darkColorSchema: currentSettings.darkColorSchema,
      lightColorSchema: currentSettings.lightColorSchema
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("settings-preview-color-schemas", preview)
      }
    }

    settingsWindow = null
  })

  return settingsWindow
}

export const syncSettingsWindowTitle = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitle(translate("window.settings.title"))
  }
}
