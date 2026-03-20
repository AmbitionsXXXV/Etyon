import type { AppSettings } from "@etyon/rpc"

export const settingsEqual = (a: AppSettings, b: AppSettings) =>
  a.appIcon === b.appIcon &&
  a.autoStart === b.autoStart &&
  a.closeToTray === b.closeToTray &&
  a.customThemes.length === b.customThemes.length &&
  a.customThemes.every((t, i) => t.id === b.customThemes[i]?.id) &&
  a.darkColorSchema === b.darkColorSchema &&
  a.fontFamily === b.fontFamily &&
  a.fontSize === b.fontSize &&
  a.lightColorSchema === b.lightColorSchema &&
  a.locale === b.locale &&
  a.minimizeToTray === b.minimizeToTray &&
  a.startMinimizedToTray === b.startMinimizedToTray &&
  a.theme === b.theme
