import { Menu, Tray, app } from "electron"
import type { NativeImage } from "electron"

import { createRuntimeIcon, getAppDisplayName } from "./app-metadata"
import { t } from "./localization"
import { getSettings } from "./settings"
import { createSettingsWindow, focusOrCreateMainWindow } from "./window"

let tray: Tray | null = null

const createTrayImage = (): NativeImage | undefined => {
  const icon = createRuntimeIcon(getSettings().appIcon)

  if (!icon) {
    return undefined
  }

  return icon.resize({ height: 16 })
}

const buildTrayMenu = () => {
  const appName = getAppDisplayName()

  return Menu.buildFromTemplate([
    {
      click: () => {
        focusOrCreateMainWindow()
      },
      label: t("tray.show")
    },
    {
      click: () => {
        createSettingsWindow()
      },
      label: t("tray.settings")
    },
    { type: "separator" as const },
    {
      click: () => {
        app.quit()
      },
      label: t("tray.quit", { appName })
    }
  ])
}

const getTrayInstance = (): Tray | null => {
  if (!tray || tray.isDestroyed()) {
    tray = null
  }

  return tray
}

const syncTray = (trayInstance: Tray) => {
  const trayIcon = createTrayImage()

  if (trayIcon) {
    trayInstance.setImage(trayIcon)
  }

  trayInstance.setContextMenu(buildTrayMenu())
  trayInstance.setToolTip(getAppDisplayName())
}

export const destroyTray = () => {
  const trayInstance = getTrayInstance()

  if (!trayInstance) {
    return
  }

  trayInstance.destroy()
  tray = null
}

export const refreshTray = () => {
  const trayInstance = getTrayInstance()

  if (!trayInstance) {
    setupTray()
    return
  }

  syncTray(trayInstance)
}

export const setupTray = () => {
  const existingTray = getTrayInstance()

  if (existingTray) {
    syncTray(existingTray)
    return existingTray
  }

  const trayIcon = createTrayImage()

  if (!trayIcon) {
    return
  }

  const nextTray = new Tray(trayIcon)

  nextTray.on("click", () => {
    focusOrCreateMainWindow()
  })

  tray = nextTray
  syncTray(nextTray)
  return nextTray
}
