import fs from "node:fs"
import path from "node:path"

import { platform } from "@electron-toolkit/utils"
import { app, nativeImage } from "electron"
import type { NativeImage } from "electron"

const DEVELOPMENT_APP_NAME = "Etyon Dev" as const
const DEVELOPMENT_ASSET_ROOT = "resources" as const
const ICON_FILENAMES = platform.isMacOS
  ? ["icon.icns", "icon.ico"]
  : ["icon.ico", "icon.icns"]
const RELEASE_APP_NAME = "Etyon" as const
const TRAY_ICON_FILENAMES = ["tray.png"] as const

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

export const createRuntimeIcon = (): NativeImage | undefined => {
  const iconPath = resolveRuntimeIconPath()

  return createNativeImageFromPath(iconPath)
}

export const getAppDisplayName = (): string =>
  app.isPackaged ? RELEASE_APP_NAME : DEVELOPMENT_APP_NAME

export const resolveTrayIconPath = (): string | null =>
  resolveAssetPath(TRAY_ICON_FILENAMES)

export const resolveRuntimeIconPath = (): string | null =>
  resolveAssetPath(ICON_FILENAMES)
