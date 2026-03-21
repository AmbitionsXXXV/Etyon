import {
  AppSettingsSchema,
  FontListOutputSchema,
  LogEventSchema,
  PingInputSchema,
  PingOutputSchema,
  ServerUrlOutputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import { os } from "@orpc/server"
import { BrowserWindow } from "electron"

import { listSystemFonts } from "@/main/fonts"
import { dispatch, enrichLogEvent } from "@/main/logger"
import { refreshLocalizedAppShell } from "@/main/native-ui"
import { getServerUrl } from "@/main/server"
import { getSettings, updateSettings } from "@/main/settings"
import { startupSettingsEqual, syncStartupSettings } from "@/main/startup"

const loggerEmit = os.input(LogEventSchema).handler(({ input }) => {
  const enriched = enrichLogEvent(input)
  dispatch(enriched)
})

const fontsList = os
  .output(FontListOutputSchema)
  .handler(() => listSystemFonts())

const ping = os
  .input(PingInputSchema)
  .output(PingOutputSchema)
  .handler(({ input }) => ({
    echo: input.message,
    pid: process.pid,
    timestamp: new Date().toISOString()
  }))

const settingsGet = os.output(AppSettingsSchema).handler(() => getSettings())

const settingsUpdate = os
  .input(UpdateSettingsSchema)
  .output(AppSettingsSchema)
  .handler(({ input }) => {
    const previousSettings = getSettings()
    const result = updateSettings(input)

    if (!startupSettingsEqual(previousSettings, result)) {
      syncStartupSettings(result)
    }

    refreshLocalizedAppShell()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("settings-changed", result)
    }
    return result
  })

const serverGetUrl = os
  .output(ServerUrlOutputSchema)
  .handler(() => ({ url: getServerUrl() }))

export const router = {
  fonts: {
    list: fontsList
  },
  logger: {
    emit: loggerEmit
  },
  ping,
  server: {
    getUrl: serverGetUrl
  },
  settings: {
    get: settingsGet,
    update: settingsUpdate
  }
}

export type AppRouter = typeof router
