import path from "node:path"
import { fileURLToPath } from "node:url"

import { is, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow } from "electron"
import type { Event } from "electron"

import { createRuntimeIcon, getAppDisplayName } from "./app-metadata"
import { applyLiquidGlass } from "./liquid-glass"
import { t } from "./localization"
import { getSettings } from "./settings"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const preloadPath = path.join(__dirname, "preload.js")
let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let shouldQuitApp = false

const getWindowIcon = () => createRuntimeIcon()

type WindowBehaviorSettings = Pick<
  AppSettings,
  "closeToTray" | "minimizeToTray"
>

const getWindowBehaviorSettings = (): WindowBehaviorSettings => {
  const { closeToTray, minimizeToTray } = getSettings()

  return {
    closeToTray,
    minimizeToTray
  }
}

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

const handleMainWindowClose = (event: Event) => {
  if (shouldQuitApp) {
    return
  }

  const { closeToTray } = getWindowBehaviorSettings()

  if (!closeToTray) {
    event.preventDefault()
    setAppQuitting(true)
    app.quit()
    return
  }

  event.preventDefault()
  hideMainWindow()
}

const handleMainWindowMinimize = () => {
  if (shouldQuitApp) {
    return
  }

  const { minimizeToTray } = getWindowBehaviorSettings()

  if (!minimizeToTray) {
    return
  }

  hideMainWindow()
}

const syncMainWindowReference = (window: BrowserWindow) => {
  mainWindow = window

  window.on("close", handleMainWindowClose)
  window.on("minimize", handleMainWindowMinimize)
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })
}

export const createWindow = () => {
  const existingWindow = getMainWindow()

  if (existingWindow) {
    return existingWindow
  }

  const windowIcon = getWindowIcon()
  const window = new BrowserWindow({
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...(platform.isMacOS
      ? { transparent: true }
      : { titleBarOverlay: { height: 36 } }),
    height: 800,
    minHeight: 392,
    minWidth: 732,
    title: getAppDisplayName(),
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: preloadPath },
    width: 1000
  })

  syncMainWindowReference(window)
  applyLiquidGlass(window)
  loadRenderer(window)

  if (is.dev) {
    window.webContents.openDevTools({ mode: "undocked" })
  }

  return window
}

export const focusOrCreateMainWindow = () => {
  const window = showMainWindow()
  window.focus()
  return window
}

export const getMainWindow = (): BrowserWindow | null => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null
  }

  return mainWindow
}

export const hideMainWindow = () => {
  const window = getMainWindow()

  if (window && window.isVisible()) {
    window.hide()
  }
}

export const isAppQuitting = (): boolean => shouldQuitApp

export const setAppQuitting = (value: boolean) => {
  shouldQuitApp = value
}

export const showMainWindow = () => {
  const window = createWindow()

  if (window.isMinimized()) {
    window.restore()
  }

  if (!window.isVisible()) {
    window.show()
  }

  return window
}

export const createSettingsWindow = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    syncSettingsWindowTitle()
    settingsWindow.focus()
    return settingsWindow
  }

  const windowIcon = getWindowIcon()

  settingsWindow = new BrowserWindow({
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...(platform.isMacOS
      ? { trafficLightPosition: { x: 12, y: 18 }, transparent: true }
      : { titleBarOverlay: { height: 36 } }),
    height: 720,
    maximizable: false,
    minHeight: 392,
    minWidth: 732,
    title: t("window.settings.title"),
    titleBarStyle: "hidden",
    webPreferences: { preload: preloadPath },
    width: 900
  })

  if (is.dev) {
    settingsWindow.webContents.openDevTools({ mode: "undocked" })
  }

  settingsWindow.center()
  applyLiquidGlass(settingsWindow)
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
    settingsWindow.setTitle(t("window.settings.title"))
  }
}
