import { initLogger } from "@etyon/logger/renderer"
import type { AppSettings } from "@etyon/rpc"
import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"

import { App } from "./app"
import { SettingsPage } from "./components/settings-page"
import { rpcClient } from "./lib/rpc"
import { applySettings } from "./lib/settings"
import { queryClient } from "./query-client"

import "@etyon/ui/globals.css"

initLogger((event) => {
  rpcClient.logger.emit(event)
})

const loadInitialSettings = async () => {
  try {
    const settings = await rpcClient.settings.get()
    applySettings(settings)
  } catch {
    // Ignore initial settings load failure
  }
}

const bootstrap = async () => {
  await loadInitialSettings()
}

bootstrap()

window.electron.ipcRenderer.on(
  "settings-changed",
  (_event: unknown, settings: AppSettings) => {
    applySettings(settings)
  }
)

const params = new URLSearchParams(window.location.search)
const isSettingsWindow = params.get("window") === "settings"

const root = document.querySelector("#root")

if (root) {
  createRoot(root).render(
    isSettingsWindow ? (
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>
    ) : (
      <App />
    )
  )
}
