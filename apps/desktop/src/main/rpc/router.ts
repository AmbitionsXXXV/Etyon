import {
  AppSettingsSchema,
  FontListOutputSchema,
  LogEventSchema,
  PingInputSchema,
  PingOutputSchema,
  ProviderFetchModelsInputSchema,
  ProviderFetchModelsOutputSchema,
  ServerUrlOutputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import { BrowserWindow } from "electron"

import { listSystemFonts } from "@/main/fonts"
import { dispatch, enrichLogEvent } from "@/main/logger"
import { refreshLocalizedAppShell } from "@/main/native-ui"
import { fetchProviderModels } from "@/main/providers/fetch-provider-models"
import { rpc } from "@/main/rpc/context"
import { getServerUrl } from "@/main/server/server-url"
import { getSettings, updateSettings } from "@/main/settings"
import { startupSettingsEqual, syncStartupSettings } from "@/main/startup"

const loggerEmit = rpc.input(LogEventSchema).handler(({ context, input }) => {
  const enriched = enrichLogEvent({
    ...input,
    request_id: context.requestId ?? input.request_id,
    transport: context.transport
  })
  dispatch(enriched)
})

const fontsList = rpc
  .output(FontListOutputSchema)
  .handler(() => listSystemFonts())

const ping = rpc
  .input(PingInputSchema)
  .output(PingOutputSchema)
  .handler(({ input }) => ({
    echo: input.message,
    pid: process.pid,
    timestamp: new Date().toISOString()
  }))

const providersFetchModels = rpc
  .input(ProviderFetchModelsInputSchema)
  .output(ProviderFetchModelsOutputSchema)
  .handler(({ input }) => fetchProviderModels(input))

const settingsGet = rpc.output(AppSettingsSchema).handler(() => getSettings())

const settingsUpdate = rpc
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

const serverGetUrl = rpc
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
  providers: {
    fetchModels: providersFetchModels
  },
  server: {
    getUrl: serverGetUrl
  },
  settings: {
    get: settingsGet,
    update: settingsUpdate
  }
}

export type AppRouter = typeof router
