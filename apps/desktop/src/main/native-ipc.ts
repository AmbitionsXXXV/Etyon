import fs from "node:fs"

import type { OpenDialogOptions } from "electron"
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"

const OPEN_EXTERNAL_URL_CHANNEL = "open-external-url"
const OPEN_PROJECT_IN_FILE_MANAGER_CHANNEL = "open-project-in-file-manager"
const PICK_PROJECT_DIRECTORY_CHANNEL = "pick-project-directory"

const registerProjectDirectoryPicker = (): void => {
  ipcMain.removeHandler(PICK_PROJECT_DIRECTORY_CHANNEL)
  ipcMain.handle(PICK_PROJECT_DIRECTORY_CHANNEL, async (event) => {
    const dialogProperties: OpenDialogOptions["properties"] = [
      "createDirectory",
      "openDirectory"
    ]
    const dialogOptions: OpenDialogOptions = {
      defaultPath: app.getPath("home"),
      properties: dialogProperties
    }
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    return result.canceled ? undefined : result.filePaths[0]
  })
}

const registerOpenProjectInFileManager = (): void => {
  ipcMain.removeHandler(OPEN_PROJECT_IN_FILE_MANAGER_CHANNEL)
  ipcMain.handle(
    OPEN_PROJECT_IN_FILE_MANAGER_CHANNEL,
    async (_event, projectPath: unknown) => {
      if (typeof projectPath !== "string" || projectPath.trim().length === 0) {
        throw new Error("Project path is required")
      }

      const normalizedProjectPath = projectPath.trim()

      if (!fs.existsSync(normalizedProjectPath)) {
        throw new Error(`Project path does not exist: ${normalizedProjectPath}`)
      }

      const errorMessage = await shell.openPath(normalizedProjectPath)

      if (errorMessage) {
        throw new Error(errorMessage)
      }

      return true
    }
  )
}

const registerOpenExternalUrl = (): void => {
  ipcMain.removeHandler(OPEN_EXTERNAL_URL_CHANNEL)
  ipcMain.handle(OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: unknown) => {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("URL is required")
    }

    const trimmedUrl = url.trim()

    if (
      !trimmedUrl.startsWith("https://") &&
      !trimmedUrl.startsWith("http://")
    ) {
      throw new Error(`Only http(s) URLs are allowed: ${trimmedUrl}`)
    }

    await shell.openExternal(trimmedUrl)
    return true
  })
}

export const registerNativeIpcHandlers = (): void => {
  registerOpenExternalUrl()
  registerOpenProjectInFileManager()
  registerProjectDirectoryPicker()
}
