import {
  AppSettingsSchema,
  ArchiveChatSessionInputSchema,
  ChatSessionSummarySchema,
  ChatSessionMemoryOutputSchema,
  ChatSessionMessagesInputSchema,
  ChatSessionMessagesOutputSchema,
  ChatSessionsListOutputSchema,
  CreateChatSessionInputSchema,
  EnsureProjectSnapshotInputSchema,
  FontListOutputSchema,
  ListMemoryEntriesInputSchema,
  MemoryEntriesOutputSchema,
  MemoryStatsOutputSchema,
  ListProjectSnapshotFilesInputSchema,
  ListProjectSnapshotFilesOutputSchema,
  LogEventSchema,
  OpenChatSessionInputSchema,
  PingInputSchema,
  PingOutputSchema,
  ProjectSnapshotStateSchema,
  ProviderFetchModelsInputSchema,
  ProviderFetchModelsOutputSchema,
  ArchiveProjectChatsInputSchema,
  RemoveProjectInputSchema,
  RenameProjectInputSchema,
  SetCollapsedProjectsInputSchema,
  SetChatSessionModelInputSchema,
  SetProjectPinnedInputSchema,
  SetProjectOrderInputSchema,
  SetSidebarWidthInputSchema,
  SetPinnedChatSessionInputSchema,
  ServerUrlOutputSchema,
  SidebarUiStateSchema,
  TelegramTestConnectionInputSchema,
  TelegramTestConnectionOutputSchema,
  TestProxyInputSchema,
  TestProxyOutputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import { BrowserWindow } from "electron"

import { listChatMessages } from "@/main/chat-messages"
import { getChatSessionMemory } from "@/main/chat-session-memory"
import {
  archiveChatSession,
  archiveProjectChatSessions,
  createChatSession,
  getChatSessionById,
  listChatSessions,
  openChatSession,
  removeProjectChatSessions,
  setChatSessionModel,
  setChatSessionPinned
} from "@/main/chat-sessions"
import { listSystemFonts } from "@/main/fonts"
import { getLocalConnectionToken } from "@/main/local-connection"
import { dispatch, enrichLogEvent } from "@/main/logger"
import { getMemoryStats, listMemoryEntries } from "@/main/memory"
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
  removeProjectUiState,
  setCollapsedProjectPaths,
  setProjectDisplayName,
  setProjectOrder,
  setProjectPinned,
  setSidebarWidthPx
} from "@/main/sidebar-ui-state"
import { startupSettingsEqual, syncStartupSettings } from "@/main/startup"
import { syncTelegramBridge } from "@/main/telegram/bridge"
import { testTelegramConnection } from "@/main/telegram/test-connection"

const loggerEmit = rpc.input(LogEventSchema).handler(({ context, input }) => {
  const enriched = enrichLogEvent({
    ...input,
    request_id: context.requestId ?? input.request_id,
    transport: context.transport
  })
  dispatch(enriched)
})

const broadcastSidebarState = (state: ReturnType<typeof getSidebarUiState>) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("sidebar-state-changed", state)
  }
}

const fontsList = rpc
  .output(FontListOutputSchema)
  .handler(() => listSystemFonts())

const memoryList = rpc
  .input(ListMemoryEntriesInputSchema)
  .output(MemoryEntriesOutputSchema)
  .handler(async ({ context, input }) => ({
    entries: await listMemoryEntries(context.db, input.limit)
  }))

const memoryStats = rpc
  .output(MemoryStatsOutputSchema)
  .handler(({ context }) => getMemoryStats(context.db))

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

const chatSessionsArchive = rpc
  .input(ArchiveChatSessionInputSchema)
  .output(ChatSessionSummarySchema)
  .handler(({ context, input }) =>
    archiveChatSession({
      db: context.db,
      sessionId: input.sessionId
    })
  )

const chatSessionsList = rpc
  .output(ChatSessionsListOutputSchema)
  .handler(({ context }) => listChatSessions(context.db))

const chatSessionsListMessages = rpc
  .input(ChatSessionMessagesInputSchema)
  .output(ChatSessionMessagesOutputSchema)
  .handler(async ({ context, input }) => ({
    messages: await listChatMessages({
      db: context.db,
      sessionId: input.sessionId
    }),
    sessionId: input.sessionId
  }))

const chatSessionsGetMemory = rpc
  .input(ChatSessionMessagesInputSchema)
  .output(ChatSessionMemoryOutputSchema)
  .handler(async ({ context, input }) => ({
    memory: (await getChatSessionMemory(context.db, input.sessionId)) ?? null,
    sessionId: input.sessionId
  }))

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

const projectsArchiveChats = rpc
  .input(ArchiveProjectChatsInputSchema)
  .output(ChatSessionsListOutputSchema)
  .handler(({ context, input }) =>
    archiveProjectChatSessions({
      db: context.db,
      projectPath: input.projectPath
    })
  )

const projectsRemove = rpc
  .input(RemoveProjectInputSchema)
  .output(ChatSessionsListOutputSchema)
  .handler(async ({ context, input }) => {
    const sessions = await removeProjectChatSessions({
      db: context.db,
      projectPath: input.projectPath
    })
    const sidebarState = removeProjectUiState(input.projectPath)

    broadcastSidebarState(sidebarState)

    return sessions
  })

const projectsRename = rpc
  .input(RenameProjectInputSchema)
  .output(SidebarUiStateSchema)
  .handler(({ input }) => {
    const sidebarState = setProjectDisplayName({
      displayName: input.displayName,
      projectPath: input.projectPath
    })

    broadcastSidebarState(sidebarState)

    return sidebarState
  })

const projectsSetPinned = rpc
  .input(SetProjectPinnedInputSchema)
  .output(SidebarUiStateSchema)
  .handler(({ input }) => {
    const sidebarState = setProjectPinned({
      pinned: input.pinned,
      projectPath: input.projectPath
    })

    broadcastSidebarState(sidebarState)

    return sidebarState
  })

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
    syncTelegramBridge(result)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("settings-changed", result)
    }
    return result
  })

const telegramTestConnection = rpc
  .input(TelegramTestConnectionInputSchema)
  .output(TelegramTestConnectionOutputSchema)
  .handler(({ input }) => testTelegramConnection(input.botToken))

const proxyTestRpc = rpc
  .input(TestProxyInputSchema)
  .output(TestProxyOutputSchema)
  .handler(({ input }) => testProxy(input))

const serverGetUrl = rpc.output(ServerUrlOutputSchema).handler(() => ({
  token: getLocalConnectionToken(),
  url: getServerUrl()
}))

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
      limit: input.limit,
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

    broadcastSidebarState(result)

    return result
  })

const sidebarStateSetProjectOrder = rpc
  .input(SetProjectOrderInputSchema)
  .output(SidebarUiStateSchema)
  .handler(({ input }) => {
    const result = setProjectOrder(input.projectOrder)

    broadcastSidebarState(result)

    return result
  })

const sidebarStateSetWidth = rpc
  .input(SetSidebarWidthInputSchema)
  .output(SidebarUiStateSchema)
  .handler(({ input }) => {
    const result = setSidebarWidthPx(input.sidebarWidthPx)

    broadcastSidebarState(result)

    return result
  })

export const router = {
  chatSessions: {
    archive: chatSessionsArchive,
    create: chatSessionsCreate,
    getMemory: chatSessionsGetMemory,
    list: chatSessionsList,
    listMessages: chatSessionsListMessages,
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
  memory: {
    list: memoryList,
    stats: memoryStats
  },
  ping,
  projectSnapshots: {
    ensure: projectSnapshotsEnsure,
    listFiles: projectSnapshotsListFiles
  },
  providers: {
    fetchModels: providersFetchModels
  },
  projects: {
    archiveChats: projectsArchiveChats,
    remove: projectsRemove,
    rename: projectsRename,
    setPinned: projectsSetPinned
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
    setProjectOrder: sidebarStateSetProjectOrder,
    setWidth: sidebarStateSetWidth
  },
  settings: {
    get: settingsGet,
    update: settingsUpdate
  },
  telegram: {
    testConnection: telegramTestConnection
  }
}

export type AppRouter = typeof router
