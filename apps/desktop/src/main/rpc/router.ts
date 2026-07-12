import {
  AgentRunsOutputSchema,
  InspectAgentRunInputSchema,
  InspectAgentRunOutputSchema,
  ListAgentRunsInputSchema,
  ListPendingAgentApprovalsInputSchema,
  PendingAgentApprovalsOutputSchema,
  AppSettingsSchema,
  ArchiveChatSessionInputSchema,
  ChatSessionSummarySchema,
  ChatSessionMemoryOutputSchema,
  ChatSessionMessagesInputSchema,
  ChatSessionMessagesOutputSchema,
  ChatSessionsListOutputSchema,
  CreateChatSessionInputSchema,
  CursorAuthPollLoginInputSchema,
  CursorAuthPollLoginOutputSchema,
  CursorAuthStartLoginOutputSchema,
  CursorAuthStatusOutputSchema,
  CursorModelsOutputSchema,
  DeleteMemoryEntryInputSchema,
  DeleteMemoryEntryOutputSchema,
  EnsureProjectSnapshotInputSchema,
  FontListOutputSchema,
  GitProjectDiffInputSchema,
  GitProjectDiffOutputSchema,
  InstallMemoryEmbeddingModelInputSchema,
  ListMemoryEntriesInputSchema,
  MemoryEmbeddingModelsOutputSchema,
  MemoryEntriesOutputSchema,
  MemoryStatsOutputSchema,
  ListProjectSnapshotFilesInputSchema,
  ListProjectSnapshotFilesOutputSchema,
  ReadAgentArtifactInputSchema,
  ReadAgentArtifactOutputSchema,
  RespondToChildApprovalInputSchema,
  RespondToChildApprovalOutputSchema,
  ReadProjectBinaryFileInputSchema,
  ReadProjectBinaryFileOutputSchema,
  ReadProjectFileInputSchema,
  ReadProjectFileOutputSchema,
  LogEventSchema,
  OpenChatSessionInputSchema,
  PingInputSchema,
  PingOutputSchema,
  PluginsListOutputSchema,
  PluginsSetEnabledInputSchema,
  PluginsSetEnabledOutputSchema,
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
  SkillsListOutputSchema,
  PromptTemplatesListOutputSchema,
  TelegramTestConnectionInputSchema,
  TelegramTestConnectionOutputSchema,
  TerminalDisposeInputSchema,
  TerminalEnsureInputSchema,
  TerminalEnsureOutputSchema,
  TerminalMutationOutputSchema,
  TerminalResizeInputSchema,
  TestProxyInputSchema,
  TestProxyOutputSchema,
  RtkTokenSavingsOutputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import { BrowserWindow } from "electron"

import {
  inspectAgentRun,
  listAgentRuns,
  listPendingAgentApprovals,
  readAgentArtifact
} from "@/main/agents/agent-run-inspection"
import { respondToChildApproval } from "@/main/agents/child-approval"
import type { RememberableChildCommand } from "@/main/agents/child-approval"
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
import {
  fetchCursorModels,
  getCursorAuthStatus,
  logoutCursorAuth,
  pollCursorAuthLogin,
  startCursorAuthLogin
} from "@/main/cursor-auth/service"
import { listSystemFonts } from "@/main/fonts"
import { getGitProjectDiff } from "@/main/git-project-status"
import { getLocalConnectionToken } from "@/main/local-connection"
import { dispatch, enrichLogEvent } from "@/main/logger"
import {
  deleteMemoryEntry,
  getMemoryStats,
  listMemoryEntries
} from "@/main/memory"
import {
  installMemoryEmbeddingModel,
  listMemoryEmbeddingModels
} from "@/main/memory/embedding-models"
import { refreshLocalizedAppShell } from "@/main/native-ui"
import {
  listBuiltInPlugins,
  setBuiltInPluginEnabledState
} from "@/main/plugins/registry"
import {
  ensureProjectSnapshot,
  listProjectSnapshotFiles,
  readProjectBinaryFile,
  readProjectFile
} from "@/main/project-snapshot"
import { fetchProviderModels } from "@/main/providers/fetch-provider-models"
import { testProxy } from "@/main/proxy/test-proxy"
import { rpc } from "@/main/rpc/context"
import { getRtkTokenSavings } from "@/main/rtk-token-savings"
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
import { listSkillPromptTemplates, listSkills } from "@/main/skills"
import { startupSettingsEqual, syncStartupSettings } from "@/main/startup"
import { syncTelegramBridge } from "@/main/telegram/bridge"
import { testTelegramConnection } from "@/main/telegram/test-connection"
import {
  disposePty,
  ensurePtySession,
  resizePty
} from "@/main/terminal/pty-manager"

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

const applySettingsUpdate = (
  input: Parameters<typeof updateSettings>[0]
): ReturnType<typeof updateSettings> => {
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
}

// Persists a remembered bash command for a delegated child, deduped by
// (toolName, projectPath, command) so a re-remember resets the TTL. Mirrors the
// renderer's parent-flow remember and broadcasts settings-changed via
// applySettingsUpdate so the settings UI stays in sync. The dangerous-command
// guard already ran in respondToChildApproval, which only returns a command here
// when it is safe to remember.
const rememberChildBashCommand = ({
  command,
  projectPath
}: RememberableChildCommand): void => {
  const settings = getSettings()
  const rule = {
    command,
    createdAt: new Date().toISOString(),
    projectPath,
    toolName: "bash"
  }
  const commandAllowlist = [
    ...settings.agents.approvals.commandAllowlist.filter(
      (entry) =>
        entry.toolName !== rule.toolName ||
        entry.projectPath !== rule.projectPath ||
        entry.command !== rule.command
    ),
    rule
  ]

  applySettingsUpdate({
    agents: {
      ...settings.agents,
      approvals: {
        ...settings.agents.approvals,
        commandAllowlist
      }
    }
  })
}

const fontsList = rpc
  .output(FontListOutputSchema)
  .handler(() => listSystemFonts())

const cursorAuthFetchModels = rpc
  .output(CursorModelsOutputSchema)
  .handler(() => fetchCursorModels())

const cursorAuthLogout = rpc
  .output(CursorAuthStatusOutputSchema)
  .handler(() => logoutCursorAuth())

const cursorAuthPollLogin = rpc
  .input(CursorAuthPollLoginInputSchema)
  .output(CursorAuthPollLoginOutputSchema)
  .handler(({ input }) => pollCursorAuthLogin(input))

const cursorAuthStartLogin = rpc
  .output(CursorAuthStartLoginOutputSchema)
  .handler(() => startCursorAuthLogin())

const cursorAuthStatus = rpc
  .output(CursorAuthStatusOutputSchema)
  .handler(() => getCursorAuthStatus())

const gitProjectDiff = rpc
  .input(GitProjectDiffInputSchema)
  .output(GitProjectDiffOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    return getGitProjectDiff(session.projectPath, {
      paths: input.paths
    })
  })

const memoryList = rpc
  .input(ListMemoryEntriesInputSchema)
  .output(MemoryEntriesOutputSchema)
  .handler(({ context, input }) =>
    listMemoryEntries(context.db, {
      limit: input.limit,
      offset: input.offset,
      query: input.query
    })
  )

const memoryStats = rpc
  .output(MemoryStatsOutputSchema)
  .handler(({ context }) => getMemoryStats(context.db))

const memoryDelete = rpc
  .input(DeleteMemoryEntryInputSchema)
  .output(DeleteMemoryEntryOutputSchema)
  .handler(async ({ context, input }) => ({
    deleted: await deleteMemoryEntry(context.db, input.id)
  }))

const memoryEmbeddingModelsList = rpc
  .output(MemoryEmbeddingModelsOutputSchema)
  .handler(() => listMemoryEmbeddingModels())

const memoryEmbeddingModelsInstall = rpc
  .input(InstallMemoryEmbeddingModelInputSchema)
  .output(MemoryEmbeddingModelsOutputSchema)
  .handler(({ input }) => installMemoryEmbeddingModel(input.modelId))

const skillsList = rpc
  .output(SkillsListOutputSchema)
  .handler(async ({ context }) => {
    const sessions = await listChatSessions(context.db)

    return {
      skills: listSkills({
        projectPaths: sessions.map((session) => session.projectPath)
      })
    }
  })

const skillsListPromptTemplates = rpc
  .output(PromptTemplatesListOutputSchema)
  .handler(async ({ context }) => {
    const sessions = await listChatSessions(context.db)

    return {
      templates: listSkillPromptTemplates({
        projectPaths: sessions.map((session) => session.projectPath)
      })
    }
  })

const tokenSavingsGet = rpc
  .output(RtkTokenSavingsOutputSchema)
  .handler(() => getRtkTokenSavings())

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

const pluginsList = rpc
  .output(PluginsListOutputSchema)
  .handler(() => ({ plugins: listBuiltInPlugins() }))

const pluginsSetEnabled = rpc
  .input(PluginsSetEnabledInputSchema)
  .output(PluginsSetEnabledOutputSchema)
  .handler(({ input }) => ({
    plugins: setBuiltInPluginEnabledState(input.pluginId, input.enabled)
  }))

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
  .handler(({ input }) => applySettingsUpdate(input))

const telegramTestConnection = rpc
  .input(TelegramTestConnectionInputSchema)
  .output(TelegramTestConnectionOutputSchema)
  .handler(({ input }) => testTelegramConnection(input.botToken))

const terminalDispose = rpc
  .input(TerminalDisposeInputSchema)
  .output(TerminalMutationOutputSchema)
  .handler(({ input }) => {
    disposePty(input.sessionId)
    return { ok: true as const }
  })

const terminalEnsure = rpc
  .input(TerminalEnsureInputSchema)
  .output(TerminalEnsureOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    return ensurePtySession({
      cols: input.cols,
      cwd: session.projectPath,
      rows: input.rows,
      sessionId: input.sessionId
    })
  })

const terminalResize = rpc
  .input(TerminalResizeInputSchema)
  .output(TerminalMutationOutputSchema)
  .handler(({ input }) => {
    resizePty(input.sessionId, input.cols, input.rows)
    return { ok: true as const }
  })

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

const projectSnapshotsReadFile = rpc
  .input(ReadProjectFileInputSchema)
  .output(ReadProjectFileOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    return readProjectFile({
      filePath: input.filePath,
      projectPath: session.projectPath
    })
  })

const projectSnapshotsReadBinaryFile = rpc
  .input(ReadProjectBinaryFileInputSchema)
  .output(ReadProjectBinaryFileOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    return readProjectBinaryFile({
      filePath: input.filePath,
      projectPath: session.projectPath
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

const agentsInspectRun = rpc
  .input(InspectAgentRunInputSchema)
  .output(InspectAgentRunOutputSchema)
  .handler(async ({ context, input }) => {
    const result = await inspectAgentRun({
      db: context.db,
      runId: input.runId
    })

    if (!result) {
      throw new Error(`Agent run not found: ${input.runId}`)
    }

    return result
  })

const agentsListRuns = rpc
  .input(ListAgentRunsInputSchema)
  .output(AgentRunsOutputSchema)
  .handler(({ context, input }) =>
    listAgentRuns({
      db: context.db,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.parentRunId === undefined
        ? {}
        : { parentRunId: input.parentRunId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
    })
  )

const agentsListPendingApprovals = rpc
  .input(ListPendingAgentApprovalsInputSchema)
  .output(PendingAgentApprovalsOutputSchema)
  .handler(({ context, input }) =>
    listPendingAgentApprovals({
      db: context.db,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
    })
  )

const agentsReadArtifact = rpc
  .input(ReadAgentArtifactInputSchema)
  .output(ReadAgentArtifactOutputSchema)
  .handler(async ({ context, input }) => {
    const result = await readAgentArtifact({
      artifactId: input.artifactId,
      db: context.db,
      ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
    })

    if (!result) {
      throw new Error(`Agent artifact not found: ${input.artifactId}`)
    }

    return result
  })

const agentsRespondToApproval = rpc
  .input(RespondToChildApprovalInputSchema)
  .output(RespondToChildApprovalOutputSchema)
  .handler(async ({ context, input }) => {
    const result = await respondToChildApproval({
      approved: input.approved,
      approvalId: input.approvalId,
      db: context.db,
      rememberCommand: input.rememberCommand ?? false
    })

    if (result.rememberableCommand) {
      rememberChildBashCommand(result.rememberableCommand)
    }

    return result.ok
      ? { ok: true }
      : { ok: false, reason: "not-pending" as const }
  })

export const router = {
  agents: {
    inspectRun: agentsInspectRun,
    listPendingApprovals: agentsListPendingApprovals,
    listRuns: agentsListRuns,
    readArtifact: agentsReadArtifact,
    respondToApproval: agentsRespondToApproval
  },
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
  cursorAuth: {
    fetchModels: cursorAuthFetchModels,
    logout: cursorAuthLogout,
    pollLogin: cursorAuthPollLogin,
    startLogin: cursorAuthStartLogin,
    status: cursorAuthStatus
  },
  fonts: {
    list: fontsList
  },
  git: {
    diff: gitProjectDiff
  },
  logger: {
    emit: loggerEmit
  },
  memory: {
    delete: memoryDelete,
    embeddingModels: {
      install: memoryEmbeddingModelsInstall,
      list: memoryEmbeddingModelsList
    },
    list: memoryList,
    stats: memoryStats
  },
  ping,
  plugins: {
    list: pluginsList,
    setEnabled: pluginsSetEnabled
  },
  projectSnapshots: {
    ensure: projectSnapshotsEnsure,
    listFiles: projectSnapshotsListFiles,
    readBinaryFile: projectSnapshotsReadBinaryFile,
    readFile: projectSnapshotsReadFile
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
  skills: {
    list: skillsList,
    listPromptTemplates: skillsListPromptTemplates
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
  },
  terminal: {
    dispose: terminalDispose,
    ensure: terminalEnsure,
    resize: terminalResize
  },
  tokenSavings: {
    get: tokenSavingsGet
  }
}

export type AppRouter = typeof router
