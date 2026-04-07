import {
  AppSettingsSchema,
  ChatSessionSummarySchema,
  ChatSessionsListOutputSchema,
  CreateChatSessionInputSchema,
  EnsureProjectSnapshotInputSchema,
  FontListOutputSchema,
  ListProjectSnapshotFilesInputSchema,
  ListProjectSnapshotFilesOutputSchema,
  LogEventSchema,
  OpenChatSessionInputSchema,
  PingInputSchema,
  PingOutputSchema,
  ProjectSnapshotStateSchema,
  ProviderFetchModelsInputSchema,
  ProviderFetchModelsOutputSchema,
  SetCollapsedProjectsInputSchema,
  SetChatSessionModelInputSchema,
  SetSidebarWidthInputSchema,
  SetPinnedChatSessionInputSchema,
  ServerUrlOutputSchema,
  SidebarUiStateSchema,
  TestProxyInputSchema,
  TestProxyOutputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import { BrowserWindow } from "electron"

import {
  createChatSession,
  getChatSessionById,
  listChatSessions,
  openChatSession,
  setChatSessionModel,
  setChatSessionPinned
} from "@/main/chat-sessions"
import { listSystemFonts } from "@/main/fonts"
import { dispatch, enrichLogEvent } from "@/main/logger"
import { refreshLocalizedAppShell } from "@/main/native-ui"
import {
  ensureProjectSnapshot,
  listProjectSnapshotFiles
} from "@/main/project-snapshot"
import { fetchProviderModels } from "@/main/providers/fetch-provider-models"
import { testProxy } from "@/main/proxy/test-proxy"
import { rpc } from "@/main/rpc/context"
import { getServerUrl } from "@/main/server/server-url"
import { getSettings, updateSettings } from "@/main/settings"
import {
  getSidebarUiState,
  setCollapsedProjectPaths,
  setSidebarWidthPx
} from "@/main/sidebar-ui-state"
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

const chatSessionsCreate = rpc
  .input(CreateChatSessionInputSchema)
  .output(ChatSessionSummarySchema)
  .handler(({ context, input }) =>
    createChatSession({
      currentSessionId: input.currentSessionId,
      db: context.db,
      projectPath: input.projectPath
    })
  )

const chatSessionsList = rpc
  .output(ChatSessionsListOutputSchema)
  .handler(({ context }) => listChatSessions(context.db))

const chatSessionsOpen = rpc
  .input(OpenChatSessionInputSchema)
  .output(ChatSessionSummarySchema)
  .handler(({ context, input }) =>
    openChatSession({
      db: context.db,
      sessionId: input.sessionId
    })
  )

const chatSessionsSetPinned = rpc
  .input(SetPinnedChatSessionInputSchema)
  .output(ChatSessionSummarySchema)
  .handler(({ context, input }) =>
    setChatSessionPinned({
      db: context.db,
      pinned: input.pinned,
      sessionId: input.sessionId
    })
  )

const chatSessionsSetModel = rpc
  .input(SetChatSessionModelInputSchema)
  .output(ChatSessionSummarySchema)
  .handler(({ context, input }) =>
    setChatSessionModel({
      db: context.db,
      modelId: input.modelId,
      sessionId: input.sessionId
    })
  )

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

const proxyTestRpc = rpc
  .input(TestProxyInputSchema)
  .output(TestProxyOutputSchema)
  .handler(({ input }) => testProxy(input))

const serverGetUrl = rpc
  .output(ServerUrlOutputSchema)
  .handler(() => ({ url: getServerUrl() }))

const projectSnapshotsEnsure = rpc
  .input(EnsureProjectSnapshotInputSchema)
  .output(ProjectSnapshotStateSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    return ensureProjectSnapshot(session.projectPath)
  })

const projectSnapshotsListFiles = rpc
  .input(ListProjectSnapshotFilesInputSchema)
  .output(ListProjectSnapshotFilesOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    return listProjectSnapshotFiles({
      projectPath: session.projectPath,
      query: input.query
    })
  })

const sidebarStateGet = rpc
  .output(SidebarUiStateSchema)
  .handler(() => getSidebarUiState())

const sidebarStateSetCollapsedProjects = rpc
  .input(SetCollapsedProjectsInputSchema)
  .output(SidebarUiStateSchema)
  .handler(({ input }) => {
    const result = setCollapsedProjectPaths(input.collapsedProjectPaths)

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("sidebar-state-changed", result)
    }

    return result
  })

const sidebarStateSetWidth = rpc
  .input(SetSidebarWidthInputSchema)
  .output(SidebarUiStateSchema)
  .handler(({ input }) => {
    const result = setSidebarWidthPx(input.sidebarWidthPx)

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("sidebar-state-changed", result)
    }

    return result
  })

export const router = {
  chatSessions: {
    create: chatSessionsCreate,
    list: chatSessionsList,
    open: chatSessionsOpen,
    setModel: chatSessionsSetModel,
    setPinned: chatSessionsSetPinned
  },
  fonts: {
    list: fontsList
  },
  logger: {
    emit: loggerEmit
  },
  ping,
  projectSnapshots: {
    ensure: projectSnapshotsEnsure,
    listFiles: projectSnapshotsListFiles
  },
  providers: {
    fetchModels: providersFetchModels
  },
  proxy: {
    test: proxyTestRpc
  },
  server: {
    getUrl: serverGetUrl
  },
  sidebarState: {
    get: sidebarStateGet,
    setCollapsedProjects: sidebarStateSetCollapsedProjects,
    setWidth: sidebarStateSetWidth
  },
  settings: {
    get: settingsGet,
    update: settingsUpdate
  }
}

export type AppRouter = typeof router
