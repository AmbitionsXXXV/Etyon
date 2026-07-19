import path from "node:path"

import { is, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow } from "electron"
import type { Event } from "electron"

import { createRuntimeIcon, getAppDisplayName } from "./app-metadata"
import { applyLiquidGlass } from "./liquid-glass"
import { t } from "./localization"
import { getSettings } from "./settings"

const preloadPath = path.join(import.meta.dirname, "preload.js")

// Every window renders trusted app UI that also displays untrusted agent
// output, so all of them get the same hardened preferences. These match the
// Electron 43 defaults today; pinning them keeps a future edit from silently
// re-enabling nodeIntegration, disabling the sandbox, or turning off
// contextIsolation. The renderer CSP (see content-security-policy.ts) is the
// complementary backstop.
const HARDENED_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  preload: preloadPath,
  sandbox: true,
  webSecurity: true
} as const

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

const isAllowedTopLevelNavigationUrl = (url: string): boolean =>
  MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : url.startsWith("file://")

// srcdoc/blank loads are how the artifact preview iframe mounts; everything
// else a subframe could navigate to is remote content and gets cancelled.
const isAllowedSubframeNavigationUrl = (url: string): boolean =>
  url === "about:blank" || url === "about:srcdoc"

/**
 * Untrusted embedded content (e.g. sandboxed artifact previews) must never
 * open windows or navigate the app: window.open is denied, subframes may only
 * load srcdoc/blank documents, and top-level navigation is pinned to the
 * renderer's own origin. External links go through shell.openExternal via IPC.
 */
const hardenWindowWebContents = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-frame-navigate", (event) => {
    const isAllowed = event.isMainFrame
      ? isAllowedTopLevelNavigationUrl(event.url)
      : isAllowedSubframeNavigationUrl(event.url)

    if (!isAllowed) {
      event.preventDefault()
    }
  })
}

const loadRenderer = (
  win: BrowserWindow,
  queryParams?: Record<string, string>
) => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value)
      }
    }
    win.loadURL(url.toString())
  } else {
    const filePath = path.join(
      import.meta.dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
    )
    win.loadFile(filePath, queryParams ? { query: queryParams } : undefined)
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
    height: 953,
    width: 1740,
    minHeight: 392,
    minWidth: 732,
    title: getAppDisplayName(),
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: HARDENED_WEB_PREFERENCES
  })

  syncMainWindowReference(window)
  hardenWindowWebContents(window)
  applyLiquidGlass(window)

  if (getSettings().onboardedAt === null) {
    loadRenderer(window, { firstRun: "1" })
  } else {
    loadRenderer(window)
  }

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

export const createSettingsWindow = (tab?: string) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (tab) {
      settingsWindow.webContents.send("settings-navigate-tab", tab)
    }
    syncSettingsWindowTitle()
    settingsWindow.focus()
    return settingsWindow
  }

  const windowIcon = getWindowIcon()

  settingsWindow = new BrowserWindow({
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...(platform.isMacOS
      ? { trafficLightPosition: { x: 16, y: 18 }, transparent: true }
      : { titleBarOverlay: { height: 36 } }),
    height: 720,
    maximizable: false,
    minHeight: 480,
    minWidth: 732,
    title: t("window.settings.title"),
    titleBarStyle: "hidden",
    webPreferences: HARDENED_WEB_PREFERENCES,
    width: 900
  })

  if (is.dev) {
    settingsWindow.webContents.openDevTools({ mode: "undocked" })
  }

  hardenWindowWebContents(settingsWindow)
  settingsWindow.center()
  applyLiquidGlass(settingsWindow)

  const queryParams: Record<string, string> = { window: "settings" }

  if (tab) {
    queryParams.tab = tab
  }

  loadRenderer(settingsWindow, queryParams)

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
