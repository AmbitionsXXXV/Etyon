/* eslint-disable unicorn/prefer-module -- Electron main process requires CommonJS */
import {
  AppSettingsSchema,
  FontListOutputSchema,
  LogEventSchema,
  PingInputSchema,
  PingOutputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import { os } from "@orpc/server"
import { BrowserWindow } from "electron"

import { listSystemFonts } from "@/main/fonts"
import { dispatch, enrichLogEvent } from "@/main/logger"
import { getSettings, updateSettings } from "@/main/settings"

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
  .handler(async ({ input }) => {
    const result = await updateSettings(input)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("settings-changed", result)
    }
    return result
  })

export const router = {
  fonts: {
    list: fontsList
  },
  logger: {
    emit: loggerEmit
  },
  ping,
  settings: {
    get: settingsGet,
    update: settingsUpdate
  }
}

export type AppRouter = typeof router
