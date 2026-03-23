import { resolveLocale } from "@etyon/i18n"
import { I18nProvider } from "@etyon/i18n/react"
import { initLogger } from "@etyon/logger/renderer"
import { AppSettingsSchema } from "@etyon/rpc"
import type { AppSettings } from "@etyon/rpc"
import { QueryClientProvider } from "@tanstack/react-query"
import { startTransition, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app"
import { SettingsPage } from "./components/settings-page"
import { orpc, rpcClient } from "./lib/rpc"
import {
  applyColorSchemaPreview,
  applySettings,
  watchSystemTheme
} from "./lib/settings"
import { queryClient } from "./query-client"

import "@etyon/ui/globals.css"

initLogger((event) => {
  rpcClient.logger.emit(event)
})

window.electron.ipcRenderer.on("liquid-glass-active", () => {
  document.documentElement.dataset.liquidGlass = ""
})

const getSystemLocale = () =>
  navigator.languages.find((locale) => locale.length > 0) ?? navigator.language

const loadInitialSettings = async (): Promise<AppSettings> => {
  try {
    return await rpcClient.settings.get()
  } catch {
    return AppSettingsSchema.parse({})
  }
}

const params = new URLSearchParams(window.location.search)
const isSettingsWindow = params.get("window") === "settings"

const root = document.querySelector("#root")

const RendererRoot = ({
  initialSettings,
  isSettingsWindowMode,
  systemLocale
}: {
  initialSettings: AppSettings
  isSettingsWindowMode: boolean
  systemLocale: string
}) => {
  const [settings, setSettings] = useState(initialSettings)

  const locale = useMemo(
    () => resolveLocale(settings.locale, systemLocale),
    [settings.locale, systemLocale]
  )

  const themeRef = useRef(settings.theme)
  themeRef.current = settings.theme

  useEffect(() => {
    applySettings(settings)
    document.documentElement.lang = locale
  }, [locale, settings])

  useEffect(() => {
    const { queryKey } = orpc.settings.get.queryOptions({})

    const removeListener = window.electron.ipcRenderer.on(
      "settings-changed",
      (_, nextSettings: AppSettings) => {
        queryClient.setQueryData(queryKey, nextSettings)
        startTransition(() => {
          setSettings(nextSettings)
        })
      }
    )

    return removeListener
  }, [])

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(
      "settings-preview-color-schemas",
      (
        _,
        nextSettings: Pick<AppSettings, "darkColorSchema" | "lightColorSchema">
      ) => {
        if (!isSettingsWindowMode) {
          applyColorSchemaPreview(nextSettings)
        }
      }
    )

    return removeListener
  }, [isSettingsWindowMode])

  useEffect(
    () =>
      watchSystemTheme(
        () => themeRef.current,
        () => {
          console.log("system theme changed")
        }
      ),
    []
  )

  const content: ReactNode = isSettingsWindowMode ? (
    <SettingsPage isStandaloneWindow />
  ) : (
    <App />
  )

  return (
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
    </I18nProvider>
  )
}

const bootstrap = async () => {
  if (!root) {
    return
  }

  const initialSettings = await loadInitialSettings()
  const { queryKey } = orpc.settings.get.queryOptions({})

  applySettings(initialSettings)
  queryClient.setQueryData(queryKey, initialSettings)

  createRoot(root).render(
    <RendererRoot
      initialSettings={initialSettings}
      isSettingsWindowMode={isSettingsWindow}
      systemLocale={getSystemLocale()}
    />
  )
}

bootstrap()
