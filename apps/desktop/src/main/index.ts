import fs from "node:fs"

import { optimizer, platform } from "@electron-toolkit/utils"
import type { AppSettings } from "@etyon/rpc"
import { app, BrowserWindow, ipcMain } from "electron"
import started from "electron-squirrel-startup"

import {
  expireStaleApprovals,
  recoverInterruptedAgentRuns
} from "@/main/agents/agent-event-store"
import {
  startAutomationService,
  stopAutomationService
} from "@/main/agents/automation/service"
import { configureCheckpointRetention } from "@/main/agents/checkpoints"
import {
  startRuntimeHooks,
  stopRuntimeHooks
} from "@/main/agents/hooks/lifecycle"
import { recoverInterruptedInvocations } from "@/main/agents/invocation-ledger"
import {
  disposeMcpConnections,
  syncMcpConnections
} from "@/main/agents/mcp/client-manager"
import { configureWorkspacePrivateDirectory } from "@/main/agents/minimal/workspace-core"
import {
  cancelRuntimeWorktrees,
  recoverRuntimeWorktrees
} from "@/main/agents/worktree-runtime"
import { getAppDisplayName, syncRuntimeIcon } from "@/main/app-metadata"
import { getAppConfigDir, getElectronUserDataDir } from "@/main/app-paths"
import {
  registerAttachmentProtocol,
  registerAttachmentProtocolScheme
} from "@/main/attachments"
import { registerBrowserIpcHandlers } from "@/main/browser/ipc"
import { disposeAllBrowserViews } from "@/main/browser/manager"
import { registerRendererContentSecurityPolicy } from "@/main/content-security-policy"
import { getDb } from "@/main/db"
import { ensureDatabaseReady } from "@/main/db/migrate"
import { logger } from "@/main/logger"
import { setupMenu } from "@/main/menu"
import { registerNativeIpcHandlers } from "@/main/native-ipc"
import { disposeProxyAwareFetch } from "@/main/proxy/proxy-fetch"
import { registerRpcHandler } from "@/main/rpc"
import {
  registerScreenAwarenessIpcHandlers,
  startScreenAwarenessHelper,
  stopScreenAwarenessHelper
} from "@/main/screen-awareness"
import { startServer, stopServer } from "@/main/server"
import { getSettings } from "@/main/settings"
import {
  shouldStartMainWindowHidden,
  syncStartupSettings
} from "@/main/startup"
import { stopTelegramBridge, syncTelegramBridge } from "@/main/telegram/bridge"
import { registerTerminalIpcHandlers } from "@/main/terminal/ipc"
import { disposeAllPtys } from "@/main/terminal/pty-manager"
import { destroyTray, setupTray } from "@/main/tray"
import { setupUpdates } from "@/main/updates"
import {
  createSettingsWindow,
  createWindow,
  focusOrCreateMainWindow,
  isAppQuitting,
  setAppQuitting
} from "@/main/window"

const configureElectronDataPaths = (): void => {
  const userDataDir = getElectronUserDataDir(app.getPath("appData"))

  fs.mkdirSync(userDataDir, { recursive: true })
  app.setPath("sessionData", userDataDir)
  app.setPath("userData", userDataDir)
}

configureElectronDataPaths()

if (started) {
  app.quit()
}

// Must run before `app` is ready so the renderer can load attachment images
// through the custom scheme; the request handler is registered post-ready.
registerAttachmentProtocolScheme()
registerNativeIpcHandlers()
registerTerminalIpcHandlers()
registerBrowserIpcHandlers()
registerScreenAwarenessIpcHandlers()

const handleAppReady = async (): Promise<void> => {
  // Install the renderer CSP before any window can load a document.
  registerRendererContentSecurityPolicy()

  const appDisplayName = getAppDisplayName()
  const settings = getSettings()
  configureWorkspacePrivateDirectory([
    getAppConfigDir(app.getPath("home"), "development"),
    getAppConfigDir(app.getPath("home"), "release")
  ])
  startRuntimeHooks()
  configureCheckpointRetention(settings.agents.checkpoints)

  app.setName(appDisplayName)
  syncRuntimeIcon(settings.appIcon)

  if (settings.autoStart) {
    syncStartupSettings(settings)
  }

  await ensureDatabaseReady()
  await recoverInterruptedInvocations(getDb())
  await recoverRuntimeWorktrees()

  // Close runs orphaned by a previous crash and expire stale approvals.
  try {
    const db = getDb()
    const recoveredRuns = await recoverInterruptedAgentRuns({ db })
    const expiredApprovals = await expireStaleApprovals({ db })

    if (recoveredRuns > 0 || expiredApprovals > 0) {
      logger.info("agent_runs_recovered", { expiredApprovals, recoveredRuns })
    }
  } catch (error) {
    logger.error("agent_run_recovery_failed", { error })
  }

  registerAttachmentProtocol()
  registerRpcHandler()
  await startServer()
  await startAutomationService({
    openSession: (sessionId) => {
      const window = focusOrCreateMainWindow()
      const navigate = (): void => {
        if (!window.isDestroyed()) {
          window.webContents.send("automation-open-session", sessionId)
        }
      }
      if (window.webContents.isLoadingMainFrame()) {
        window.webContents.once("did-finish-load", navigate)
      } else {
        navigate()
      }
    }
  })
  void syncMcpConnections()
  syncTelegramBridge(settings)
  setupMenu(appDisplayName)
  setupTray()
  setupUpdates()
  startScreenAwarenessHelper()

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

let shutdownStarted = false
let shutdownComplete = false
app.on("before-quit", (event) => {
  setAppQuitting(true)
  if (shutdownComplete) {
    return
  }
  event.preventDefault()
  if (shutdownStarted) {
    return
  }
  shutdownStarted = true
  void (async () => {
    try {
      await stopRuntimeHooks()
      await stopAutomationService()
      await cancelRuntimeWorktrees()
      await disposeMcpConnections()
      await disposeProxyAwareFetch()
      disposeAllPtys()
      disposeAllBrowserViews()
      stopServer()
      await stopScreenAwarenessHelper()
      stopTelegramBridge()
      destroyTray()
    } finally {
      shutdownComplete = true
      app.quit()
    }
  })()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 || platform.isMacOS) {
    focusOrCreateMainWindow()
  }
})
