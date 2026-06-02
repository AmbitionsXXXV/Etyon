import { optimizer, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow, ipcMain } from "electron"
import started from "electron-squirrel-startup"

import { recoverInterruptedAgentRuns } from "@/main/agents/agent-event-store"
import { cleanupAgentSessionRuntimes } from "@/main/agents/agent-session-runtime"
import { cleanupAgentWorkspaceResources } from "@/main/agents/agent-workspace"
import { createRuntimeIcon, getAppDisplayName } from "@/main/app-metadata"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { logger } from "@/main/logger"
import { setupMenu } from "@/main/menu"
import { registerNativeIpcHandlers } from "@/main/native-ipc"
import { registerRpcHandler } from "@/main/rpc"
import { startServer, stopServer } from "@/main/server"
import { getSettings } from "@/main/settings"
import {
  shouldStartMainWindowHidden,
  syncStartupSettings
} from "@/main/startup"
import { stopTelegramBridge, syncTelegramBridge } from "@/main/telegram/bridge"
import { destroyTray, setupTray } from "@/main/tray"
import {
  createSettingsWindow,
  createWindow,
  focusOrCreateMainWindow,
  isAppQuitting,
  setAppQuitting
} from "@/main/window"

if (started) {
  app.quit()
}

registerNativeIpcHandlers()

const handleAppReady = async (): Promise<void> => {
  const appDisplayName = getAppDisplayName()
  const appIcon = createRuntimeIcon()

  app.setName(appDisplayName)

  if (platform.isMacOS && appIcon) {
    app.dock?.setIcon(appIcon)
  }

  const settings = getSettings()

  if (settings.autoStart) {
    syncStartupSettings(settings)
  }

  await ensureDatabaseReady()

  const recoveredRuns = await recoverInterruptedAgentRuns({
    approvalTtlMs: settings.agents.approvals.approvalTtlMs,
    db: getDb()
  })

  if (
    recoveredRuns.failedRunIds.length > 0 ||
    recoveredRuns.suspendedRunIds.length > 0
  ) {
    logger.info("agent_run_recovery_completed", {
      expiredApprovalRunCount: recoveredRuns.expiredApprovalRunIds.length,
      failedRunCount: recoveredRuns.failedRunIds.length,
      suspendedRunCount: recoveredRuns.suspendedRunIds.length
    })
  }

  registerRpcHandler()
  await startServer()
  syncTelegramBridge(settings)
  setupMenu(appDisplayName)
  setupTray()

  ipcMain.on("open-settings", (_event, tab?: string) => {
    createSettingsWindow(tab)
  })

  ipcMain.on(
    "settings-preview-color-schemas",
    (
      event,
      preview: Pick<AppSettings, "darkColorSchema" | "lightColorSchema">
    ) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents.id !== event.sender.id) {
          win.webContents.send("settings-preview-color-schemas", preview)
        }
      }
    }
  )

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (!shouldStartMainWindowHidden(settings)) {
    createWindow()
  }
}

const cleanupAgentRuntimeResourcesForQuit = async (): Promise<void> => {
  const results = await Promise.allSettled([
    cleanupAgentSessionRuntimes(),
    cleanupAgentWorkspaceResources()
  ])
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )

  if (failure) {
    logger.error("agent_runtime_cleanup_failed", { error: failure.reason })
  }
}

app.on("ready", async () => {
  try {
    await handleAppReady()
  } catch (error: unknown) {
    logger.error("app_ready_failed", { error })
    app.quit()
  }
})

app.on("window-all-closed", () => {
  if (isAppQuitting()) {
    destroyTray()
  }
})

app.on("before-quit", () => {
  setAppQuitting(true)
  void cleanupAgentRuntimeResourcesForQuit()
  stopServer()
  stopTelegramBridge()
  destroyTray()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 || platform.isMacOS) {
    focusOrCreateMainWindow()
  }
})
