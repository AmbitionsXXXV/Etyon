import fs from "node:fs"
import path from "node:path"

import { platform } from "@electron-toolkit/utils"
import type { AppIcon } from "@etyon/rpc"
import { BrowserWindow, app, nativeImage } from "electron"
import type { NativeImage } from "electron"

import { isRuntimeReleaseBuild } from "@/main/app-paths"

const DEVELOPMENT_APP_NAME = "Etyon Dev" as const
const DEVELOPMENT_ASSET_ROOT = "resources" as const
const APP_ICON_FILENAMES_BY_ICON: Record<AppIcon, readonly string[]> = {
  alt: ["icon-light.png"],
  default: ["icon-dark.png"]
}
const ICON_FILENAMES = platform.isMacOS
  ? ["icon.icns", "icon.ico"]
  : ["icon.ico", "icon.icns"]
const RELEASE_APP_NAME = "Etyon" as const

const createNativeImageFromPath = (
  assetPath: string | null
): NativeImage | undefined => {
  if (!assetPath) {
    return undefined
  }

  const icon = nativeImage.createFromPath(assetPath)

  return icon.isEmpty() ? undefined : icon
}

const getAssetSearchRoots = (): string[] =>
  app.isPackaged
    ? [
        path.join(process.resourcesPath, DEVELOPMENT_ASSET_ROOT),
        process.resourcesPath
      ]
    : [path.join(app.getAppPath(), DEVELOPMENT_ASSET_ROOT)]

const resolveAssetPath = (filenames: readonly string[]): string | null => {
  for (const rootPath of getAssetSearchRoots()) {
    for (const filename of filenames) {
      const assetPath = path.join(rootPath, filename)

      if (fs.existsSync(assetPath)) {
        return assetPath
      }
    }
  }

  return null
}

export const createRuntimeIcon = (
  appIcon: AppIcon = "default"
): NativeImage | undefined => {
  const iconPath = resolveRuntimeIconPath(appIcon)

  return createNativeImageFromPath(iconPath)
}

export const getAppDisplayName = (): string =>
  isRuntimeReleaseBuild() ? RELEASE_APP_NAME : DEVELOPMENT_APP_NAME

export const resolveRuntimeIconPath = (
  appIcon: AppIcon = "default"
): string | null =>
  resolveAssetPath(APP_ICON_FILENAMES_BY_ICON[appIcon]) ??
  resolveAssetPath(ICON_FILENAMES)

export const syncRuntimeIcon = (appIcon: AppIcon): void => {
  const icon = createRuntimeIcon(appIcon)

  if (!icon) {
    return
  }

  if (platform.isMacOS) {
    app.dock?.setIcon(icon)
    return
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.setIcon(icon)
    }
  }
}
