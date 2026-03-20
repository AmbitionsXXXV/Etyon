import { is, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app } from "electron"

const START_MINIMIZED_TO_TRAY_ARG = "--start-minimized-to-tray" as const

export type StartupSettings = Pick<
  AppSettings,
  "autoStart" | "startMinimizedToTray"
>

const buildWindowsLoginItemArgs = (settings: StartupSettings): string[] =>
  settings.autoStart && settings.startMinimizedToTray
    ? [START_MINIMIZED_TO_TRAY_ARG]
    : []

const supportsLoginItemSettings = (): boolean =>
  platform.isMacOS || platform.isWindows

const shouldSkipStartupSync = (): boolean =>
  is.dev || !supportsLoginItemSettings()

export const startupSettingsEqual = (
  a: StartupSettings,
  b: StartupSettings
): boolean =>
  a.autoStart === b.autoStart &&
  a.startMinimizedToTray === b.startMinimizedToTray

export const shouldStartMainWindowHidden = (
  settings: StartupSettings
): boolean => {
  if (!settings.autoStart || !settings.startMinimizedToTray) {
    return false
  }

  if (platform.isMacOS) {
    return app.getLoginItemSettings().wasOpenedAtLogin
  }

  if (platform.isWindows) {
    return process.argv.includes(START_MINIMIZED_TO_TRAY_ARG)
  }

  return false
}

export const syncStartupSettings = (settings: StartupSettings) => {
  if (shouldSkipStartupSync()) {
    return
  }

  try {
    if (platform.isWindows) {
      app.setLoginItemSettings({
        args: buildWindowsLoginItemArgs(settings),
        openAtLogin: settings.autoStart
      })
      return
    }

    app.setLoginItemSettings({
      openAtLogin: settings.autoStart
    })
  } catch (error) {
    console.warn("[startup] Failed to sync login item settings.", error)
  }
}
