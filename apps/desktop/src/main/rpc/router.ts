import path from "node:path"

import {
  AdvanceAgentRunGraphInputSchema,
  AdvanceAgentRunGraphOutputSchema,
  AgentSessionSnapshotOutputSchema,
  AgentRunsOutputSchema,
  AppendAgentSessionCompactionSummaryInputSchema,
  InspectAgentRunInputSchema,
  InspectAgentRunOutputSchema,
  InspectAgentSessionInputSchema,
  InstantiateAgentRunGraphTemplateInputSchema,
  InstantiateAgentRunGraphTemplateOutputSchema,
  ListAgentRunsInputSchema,
  ListAgentRunGraphTemplatesOutputSchema,
  ListAgentUiStreamSnapshotsInputSchema,
  ListPendingAgentApprovalsInputSchema,
  ListQueuedAgentMessagesInputSchema,
  ListRecoverableAgentRunsInputSchema,
  MoveAgentSessionLeafInputSchema,
  PendingAgentApprovalsOutputSchema,
  PreviewAgentRunGraphTemplateInputSchema,
  PreviewAgentRunGraphTemplateOutputSchema,
  QueuedAgentMessagesOutputSchema,
  QueueAgentMessageInputSchema,
  QueueAgentMessageOutputSchema,
  ReadAgentArtifactInputSchema,
  ReadAgentArtifactOutputSchema,
  RememberAgentCommandApprovalInputSchema,
  RememberAgentCommandApprovalOutputSchema,
  RecoverableAgentRunsOutputSchema,
  RemoveQueuedAgentMessageInputSchema,
  ReorderQueuedAgentMessagesInputSchema,
  RespondAgentRunGraphApprovalInputSchema,
  RespondAgentRunGraphApprovalOutputSchema,
  RetryAgentRunGraphNodeInputSchema,
  RetryAgentRunGraphNodeOutputSchema,
  RunAgentRunGraphUntilIdleInputSchema,
  RunAgentRunGraphUntilIdleOutputSchema,
  SkipAgentRunGraphNodeInputSchema,
  SkipAgentRunGraphNodeOutputSchema,
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
  EnsureProjectSnapshotInputSchema,
  ExecuteAgentRunGraphNodeInputSchema,
  ExecuteAgentRunGraphNodeOutputSchema,
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
  StartAgentRunGraphNextStageInputSchema,
  StartAgentRunGraphNextStageOutputSchema,
  StopActiveAgentRunInputSchema,
  StopActiveAgentRunOutputSchema,
  AgentUiStreamSnapshotsOutputSchema,
  UpdateAgentRunGraphRetryPolicyInputSchema,
  UpdateAgentRunGraphRetryPolicyOutputSchema,
  SkillsListOutputSchema,
  PromptTemplatesListOutputSchema,
  TelegramTestConnectionInputSchema,
  TelegramTestConnectionOutputSchema,
  TestProxyInputSchema,
  TestProxyOutputSchema,
  RtkTokenSavingsOutputSchema,
  UpdateQueuedAgentMessageInputSchema,
  UpdateSettingsSchema
} from "@etyon/rpc"
import type { AgentCommandApprovalRule } from "@etyon/rpc"
import { BrowserWindow } from "electron"

import { stopActiveAgentRun } from "@/main/agents/active-agent-runs"
import { readAgentArtifactTextContent } from "@/main/agents/agent-artifacts"
import {
  getActiveAgentRunForSession,
  getAgentArtifact,
  getAgentRun,
  getLatestCompletedAgentRunForSession,
  listAgentArtifacts,
  listAgentEvents,
  listAgentRuns,
  listAgentToolCalls,
  listPendingAgentApprovals,
  listRecoverableAgentRuns
} from "@/main/agents/agent-event-store"
import type { AgentEvent, AgentRun } from "@/main/agents/agent-event-store"
import { createAgentKernel } from "@/main/agents/agent-kernel"
import type { AgentRunGraphUntilIdleResult } from "@/main/agents/agent-kernel"
import type { AgentRunGraphTemplate } from "@/main/agents/agent-run-graph-templates"
import {
  appendAgentSessionCompactionSummaryEvent,
  appendAgentSessionMoveEvent,
  appendAgentSessionQueuedMessageRemoveEvent,
  appendAgentSessionQueuedMessageUpdateEvent,
  appendAgentSessionQueuedMessagesReorderEvent,
  buildAgentSessionTreeFromEvents,
  createAgentSessionQueuedMessageWriter,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"
import {
  isAgentCommandApprovalRuleCovered,
  isAgentCommandApprovalToolCovered
} from "@/main/agents/permission-engine"
import { listChatMessagesWithAgentProjectionRepair } from "@/main/chat-messages"
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
import type { AppDatabase } from "@/main/db"
import { listSystemFonts } from "@/main/fonts"
import { getGitProjectDiff } from "@/main/git-project-status"
import { getLocalConnectionToken } from "@/main/local-connection"
import { dispatch, enrichLogEvent } from "@/main/logger"
import { getMemoryStats, listMemoryEntries } from "@/main/memory"
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
  readProjectFile
} from "@/main/project-snapshot"
import { fetchProviderModels } from "@/main/providers/fetch-provider-models"
import { testProxy } from "@/main/proxy/test-proxy"
import { rpc } from "@/main/rpc/context"
import { getRtkTokenSavings } from "@/main/rtk-token-savings"
import { resolveModel } from "@/main/server/lib/providers"
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

const toAgentRunTraceRunOutput = (run: AgentRun) => ({
  chatSessionId: run.chatSessionId,
  errorMessage: run.errorMessage,
  finishedAt: run.finishedAt,
  id: run.id,
  modelId: run.modelId,
  parentRunId: run.parentRunId,
  profileId: run.profileId,
  startedAt: run.startedAt,
  status: run.status
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toAgentUiStreamSnapshotOutput = (event: AgentEvent) => {
  if (
    event.type !== "agent_ui_stream_snapshot_created" ||
    !isRecord(event.payload) ||
    !Array.isArray(event.payload.parts)
  ) {
    return null
  }

  return {
    createdAt: event.createdAt,
    eventId: event.id,
    parts: event.payload.parts,
    runId: event.runId,
    sequence: event.sequence
  }
}

const toAgentRunGraphUntilIdleOutput = (
  result: AgentRunGraphUntilIdleResult
) => ({
  childRuns: result.childRuns.map(toAgentRunTraceRunOutput),
  executedNodeIds: result.executedNodeIds,
  iterations: result.iterations,
  plan: result.plan,
  run: toAgentRunTraceRunOutput(result.rootRun),
  settledNodeIds: result.settledNodeIds,
  stage: result.stage,
  startedNodeIds: result.startedNodeIds,
  startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput),
  stopReason: result.stopReason
})

const agentsInspectRun = rpc
  .input(InspectAgentRunInputSchema)
  .output(InspectAgentRunOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getAgentRun({
      chatSessionId: input.sessionId,
      db: context.db,
      runId: input.runId
    })

    if (!run) {
      throw new Error(`Agent run not found: ${input.runId}`)
    }

    const [artifacts, events, toolCalls] = await Promise.all([
      listAgentArtifacts({
        db: context.db,
        runId: input.runId
      }),
      listAgentEvents({
        db: context.db,
        runId: input.runId
      }),
      listAgentToolCalls({
        db: context.db,
        runId: input.runId
      })
    ])

    return {
      artifacts,
      events,
      run: toAgentRunTraceRunOutput(run),
      toolCalls
    }
  })

const agentsReadArtifact = rpc
  .input(ReadAgentArtifactInputSchema)
  .output(ReadAgentArtifactOutputSchema)
  .handler(async ({ context, input }) => {
    const artifact = await getAgentArtifact({
      artifactId: input.artifactId,
      chatSessionId: input.sessionId,
      db: context.db
    })

    if (!artifact) {
      throw new Error(`Agent artifact not found: ${input.artifactId}`)
    }

    const content = await readAgentArtifactTextContent({
      artifact,
      maxChars: input.maxChars
    })

    return {
      artifact,
      ...content
    }
  })

const agentsListPendingApprovals = rpc
  .input(ListPendingAgentApprovalsInputSchema)
  .output(PendingAgentApprovalsOutputSchema)
  .handler(async ({ context, input }) => ({
    approvals: await listPendingAgentApprovals({
      chatSessionId: input.sessionId,
      db: context.db
    })
  }))

const agentsListRuns = rpc
  .input(ListAgentRunsInputSchema)
  .output(AgentRunsOutputSchema)
  .handler(async ({ context, input }) => {
    const runs = await listAgentRuns({
      chatSessionId: input.sessionId,
      db: context.db,
      limit: input.limit
    })

    return {
      runs: runs.map(toAgentRunTraceRunOutput)
    }
  })

const agentsListRecoverableRuns = rpc
  .input(ListRecoverableAgentRunsInputSchema)
  .output(RecoverableAgentRunsOutputSchema)
  .handler(async ({ context, input }) => {
    const runs = await listRecoverableAgentRuns({
      chatSessionId: input.sessionId,
      db: context.db
    })

    return {
      runs: runs.map(toAgentRunTraceRunOutput)
    }
  })

const agentsListUiStreamSnapshots = rpc
  .input(ListAgentUiStreamSnapshotsInputSchema)
  .output(AgentUiStreamSnapshotsOutputSchema)
  .handler(async ({ context, input }) => {
    const afterSequence = input.afterSequence ?? 0
    const run = input.runId
      ? await getAgentRun({
          chatSessionId: input.sessionId,
          db: context.db,
          runId: input.runId
        })
      : await getActiveAgentRunForSession({
          chatSessionId: input.sessionId,
          db: context.db
        })

    if (!run) {
      if (input.runId) {
        throw new Error(`Agent run not found: ${input.runId}`)
      }

      return {
        nextSequence: afterSequence,
        run: null,
        snapshots: []
      }
    }

    const events = await listAgentEvents({
      db: context.db,
      runId: run.id
    })
    const latestSequence = events.at(-1)?.sequence ?? 0
    const snapshots = events
      .filter((event) => event.sequence > afterSequence)
      .flatMap((event) => {
        const snapshot = toAgentUiStreamSnapshotOutput(event)

        return snapshot ? [snapshot] : []
      })

    return {
      nextSequence: Math.max(afterSequence, latestSequence),
      run: toAgentRunTraceRunOutput(run),
      snapshots
    }
  })

const agentsStopActiveRun = rpc
  .input(StopActiveAgentRunInputSchema)
  .output(StopActiveAgentRunOutputSchema)
  .handler(({ input }) => ({
    stopped: stopActiveAgentRun(input.sessionId)
  }))

const REMEMBERABLE_AGENT_COMMAND_APPROVAL_TOOLS = new Set([
  "bash",
  "rtkCommand",
  "runCheck"
])

const getRememberableAgentCommandApproval = ({
  input,
  toolName
}: {
  input: unknown
  toolName: string
}): { command: string; cwd?: string } | null => {
  if (!REMEMBERABLE_AGENT_COMMAND_APPROVAL_TOOLS.has(toolName)) {
    return null
  }

  if (!isRecord(input) || typeof input.command !== "string") {
    return null
  }

  const command = input.command.trim()

  if (!command) {
    return null
  }

  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : ""

  return {
    command,
    ...(cwd ? { cwd } : {})
  }
}

const resolveAgentCommandApprovalCwd = ({
  cwd,
  projectPath
}: {
  cwd?: string
  projectPath: string
}) => path.resolve(path.resolve(projectPath), cwd?.trim() ?? "")

const isSameAgentCommandApprovalRule = ({
  command,
  cwd,
  projectPath,
  rule,
  toolName
}: {
  command: string
  cwd?: string
  projectPath: string
  rule: AgentCommandApprovalRule
  toolName: string
}) =>
  isAgentCommandApprovalRuleCovered({
    command,
    ruleCommand: rule.command,
    toolName
  }) &&
  isAgentCommandApprovalToolCovered({
    ruleToolName: rule.toolName,
    toolName
  }) &&
  path.resolve(rule.projectPath) === path.resolve(projectPath) &&
  resolveAgentCommandApprovalCwd({
    cwd: rule.cwd,
    projectPath: rule.projectPath
  }) ===
    resolveAgentCommandApprovalCwd({
      cwd,
      projectPath
    })

const agentsRememberCommandApproval = rpc
  .input(RememberAgentCommandApprovalInputSchema)
  .output(RememberAgentCommandApprovalOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    const commandApproval = getRememberableAgentCommandApproval({
      input: input.input,
      toolName: input.toolName
    })

    if (!commandApproval) {
      return {
        remembered: false
      }
    }

    const settings = getSettings()
    const { commandAllowlist } = settings.agents.approvals
    const exists = commandAllowlist.some((rule) =>
      isSameAgentCommandApprovalRule({
        command: commandApproval.command,
        cwd: commandApproval.cwd,
        projectPath: session.projectPath,
        rule,
        toolName: input.toolName
      })
    )

    if (exists) {
      return {
        remembered: true
      }
    }

    applySettingsUpdate({
      agents: {
        ...settings.agents,
        approvals: {
          ...settings.agents.approvals,
          commandAllowlist: [
            ...commandAllowlist,
            {
              command: commandApproval.command,
              createdAt: new Date().toISOString(),
              ...(commandApproval.cwd ? { cwd: commandApproval.cwd } : {}),
              projectPath: session.projectPath,
              toolName: input.toolName
            }
          ]
        }
      }
    })

    return {
      remembered: true
    }
  })

const getAgentQueueRunForSession = async ({
  db,
  sessionId
}: {
  db: AppDatabase
  sessionId: string
}) =>
  (await getActiveAgentRunForSession({
    chatSessionId: sessionId,
    db
  })) ??
  (await getLatestCompletedAgentRunForSession({
    chatSessionId: sessionId,
    db
  }))

const getAgentSessionRunForSession = async ({
  db,
  runId,
  sessionId
}: {
  db: AppDatabase
  runId?: string
  sessionId: string
}) => {
  const session = await getChatSessionById(db, sessionId)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  if (runId) {
    const run = await getAgentRun({
      chatSessionId: sessionId,
      db,
      runId
    })

    if (!run) {
      throw new Error(`Agent run not found: ${runId}`)
    }

    return run
  }

  return getAgentQueueRunForSession({
    db,
    sessionId
  })
}

const getRequiredAgentSessionRun = async ({
  db,
  runId,
  sessionId
}: {
  db: AppDatabase
  runId?: string
  sessionId: string
}) => {
  const run = await getAgentSessionRunForSession({
    db,
    runId,
    sessionId
  })

  if (!run) {
    throw new Error(`Agent session run not found: ${sessionId}`)
  }

  return run
}

const createEmptyAgentSessionSnapshot = () => ({
  context: [],
  entries: [],
  events: [],
  run: null
})

const getAgentSessionSnapshotForRun = async ({
  db,
  run
}: {
  db: AppDatabase
  run: AgentRun
}) => {
  const events = await listAgentEvents({
    db,
    runId: run.id
  })
  const sessionTree = buildAgentSessionTreeFromEvents(events)

  return {
    context: sessionTree.buildContext(),
    entries: sessionTree.listEntries(),
    events,
    run: toAgentRunTraceRunOutput(run)
  }
}

const ensureAgentSessionEntryExists = ({
  entryId,
  snapshot
}: {
  entryId: null | string
  snapshot: Awaited<ReturnType<typeof getAgentSessionSnapshotForRun>>
}): void => {
  if (entryId === null) {
    return
  }

  const hasEntry = snapshot.entries.some((entry) => entry.id === entryId)

  if (!hasEntry) {
    throw new Error(`Agent session entry not found: ${entryId}`)
  }
}

const agentsInspectSession = rpc
  .input(InspectAgentSessionInputSchema)
  .output(AgentSessionSnapshotOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getAgentSessionRunForSession({
      db: context.db,
      runId: input.runId,
      sessionId: input.sessionId
    })

    if (!run) {
      return createEmptyAgentSessionSnapshot()
    }

    return getAgentSessionSnapshotForRun({
      db: context.db,
      run
    })
  })

const agentsMoveSessionLeaf = rpc
  .input(MoveAgentSessionLeafInputSchema)
  .output(AgentSessionSnapshotOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getRequiredAgentSessionRun({
      db: context.db,
      runId: input.runId,
      sessionId: input.sessionId
    })
    const snapshot = await getAgentSessionSnapshotForRun({
      db: context.db,
      run
    })

    ensureAgentSessionEntryExists({
      entryId: input.entryId,
      snapshot
    })
    await appendAgentSessionMoveEvent({
      ...(input.branchSummary ? { branchSummary: input.branchSummary } : {}),
      entryId: input.entryId,
      run
    })

    return getAgentSessionSnapshotForRun({
      db: context.db,
      run
    })
  })

const agentsAppendSessionCompactionSummary = rpc
  .input(AppendAgentSessionCompactionSummaryInputSchema)
  .output(AgentSessionSnapshotOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getRequiredAgentSessionRun({
      db: context.db,
      runId: input.runId,
      sessionId: input.sessionId
    })

    await appendAgentSessionCompactionSummaryEvent({
      run,
      summary: input.summary
    })

    return getAgentSessionSnapshotForRun({
      db: context.db,
      run
    })
  })

const listQueuedMessagesForRun = async ({
  db,
  runId
}: {
  db: AppDatabase
  runId: string
}) => {
  const events = await listAgentEvents({
    db,
    runId
  })

  return listPendingAgentSessionQueuedMessages(events)
}

const toQueuedMessageOutput = (
  chatSessionId: string,
  message: Awaited<ReturnType<typeof listQueuedMessagesForRun>>[number]
) => ({
  chatSessionId,
  content: message.message,
  createdAt: message.createdAt,
  id: message.id,
  queue: message.queue,
  runId: message.runId
})

const agentsListQueuedMessages = rpc
  .input(ListQueuedAgentMessagesInputSchema)
  .output(QueuedAgentMessagesOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getAgentQueueRunForSession({
      db: context.db,
      sessionId: input.sessionId
    })

    if (!run) {
      return {
        messages: []
      }
    }

    const messages = await listQueuedMessagesForRun({
      db: context.db,
      runId: run.id
    })

    return {
      messages: messages.map((message) =>
        toQueuedMessageOutput(run.chatSessionId, message)
      )
    }
  })

const toAgentRunGraphTemplateOutput = (template: AgentRunGraphTemplate) => ({
  description: template.description,
  id: template.id,
  name: template.name,
  nodes: template.nodes.map((node) => ({
    dependsOn: [...node.dependsOn],
    id: node.id,
    label: node.label,
    outputContract: node.outputContract,
    ...(node.parallelGroup ? { parallelGroup: node.parallelGroup } : {}),
    profileId: node.profileId,
    role: node.role,
    toolScope: node.toolScope
  }))
})

const agentsListRunGraphTemplates = rpc
  .output(ListAgentRunGraphTemplatesOutputSchema)
  .handler(() => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })

    return {
      templates: kernel
        .listRunGraphTemplates()
        .map(toAgentRunGraphTemplateOutput)
    }
  })

const agentsPreviewRunGraphTemplate = rpc
  .input(PreviewAgentRunGraphTemplateInputSchema)
  .output(PreviewAgentRunGraphTemplateOutputSchema)
  .handler(({ input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })

    return {
      plan: kernel.previewRunGraphTemplate(input.templateId)
    }
  })

const agentsInstantiateRunGraphTemplate = rpc
  .input(InstantiateAgentRunGraphTemplateInputSchema)
  .output(InstantiateAgentRunGraphTemplateOutputSchema)
  .handler(async ({ context, input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })
    const instance = await kernel.instantiateRunGraphTemplate({
      chatSessionId: input.sessionId,
      db: context.db,
      modelId: input.modelId ?? null,
      task: input.task,
      templateId: input.templateId
    })

    return {
      plan: instance.plan,
      run: toAgentRunTraceRunOutput(instance.rootRun)
    }
  })

const agentsStartRunGraphNextStage = rpc
  .input(StartAgentRunGraphNextStageInputSchema)
  .output(StartAgentRunGraphNextStageOutputSchema)
  .handler(async ({ context, input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })
    const result = await kernel.startNextRunGraphStage({
      chatSessionId: input.sessionId,
      db: context.db,
      rootRunId: input.runId
    })

    return {
      plan: result.plan,
      run: toAgentRunTraceRunOutput(result.rootRun),
      stage: result.stage,
      startedNodeIds: result.startedNodeIds,
      startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput)
    }
  })

const agentsAdvanceRunGraph = rpc
  .input(AdvanceAgentRunGraphInputSchema)
  .output(AdvanceAgentRunGraphOutputSchema)
  .handler(async ({ context, input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })
    const result = await kernel.advanceRunGraph({
      chatSessionId: input.sessionId,
      db: context.db,
      rootRunId: input.runId
    })

    return {
      plan: result.plan,
      run: toAgentRunTraceRunOutput(result.rootRun),
      settledNodeIds: result.settledNodeIds,
      stage: result.stage,
      startedNodeIds: result.startedNodeIds,
      startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput)
    }
  })

const agentsExecuteRunGraphNode = rpc
  .input(ExecuteAgentRunGraphNodeInputSchema)
  .output(ExecuteAgentRunGraphNodeOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    const rootRun = await getAgentRun({
      chatSessionId: input.sessionId,
      db: context.db,
      runId: input.runId
    })

    if (!rootRun) {
      throw new Error(`Agent run not found: ${input.runId}`)
    }

    const settings = getSettings()
    const kernel = createAgentKernel({
      settings: settings.agents
    })
    const result = await kernel.executeRunGraphNodeWithAiSdk({
      chatSessionId: input.sessionId,
      db: context.db,
      memorySettings: settings.memory,
      model: resolveModel(rootRun.modelId ?? session.modelId ?? undefined),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      projectPath: session.projectPath,
      resolveModel,
      rootRunId: rootRun.id
    })

    return {
      childRun: toAgentRunTraceRunOutput(result.childRun),
      nodeId: result.nodeId,
      plan: result.plan,
      run: toAgentRunTraceRunOutput(result.rootRun),
      settledNodeIds: result.settledNodeIds,
      stage: result.stage,
      startedNodeIds: result.startedNodeIds,
      startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput),
      stopReason: result.stopReason,
      turns: result.turns
    }
  })

const agentsRunGraphUntilIdle = rpc
  .input(RunAgentRunGraphUntilIdleInputSchema)
  .output(RunAgentRunGraphUntilIdleOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    const rootRun = await getAgentRun({
      chatSessionId: input.sessionId,
      db: context.db,
      runId: input.runId
    })

    if (!rootRun) {
      throw new Error(`Agent run not found: ${input.runId}`)
    }

    const settings = getSettings()
    const kernel = createAgentKernel({
      settings: settings.agents
    })
    const result = await kernel.runGraphUntilIdleWithAiSdk({
      chatSessionId: input.sessionId,
      db: context.db,
      maxIterations: input.maxIterations,
      memorySettings: settings.memory,
      model: resolveModel(rootRun.modelId ?? session.modelId ?? undefined),
      projectPath: session.projectPath,
      resolveModel,
      rootRunId: rootRun.id
    })

    return toAgentRunGraphUntilIdleOutput(result)
  })

const agentsRetryRunGraphNode = rpc
  .input(RetryAgentRunGraphNodeInputSchema)
  .output(RetryAgentRunGraphNodeOutputSchema)
  .handler(async ({ context, input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })
    const result = await kernel.retryRunGraphNode({
      chatSessionId: input.sessionId,
      db: context.db,
      nodeId: input.nodeId,
      rootRunId: input.runId
    })

    return {
      plan: result.plan,
      retriedNodeId: result.retriedNodeId,
      run: toAgentRunTraceRunOutput(result.rootRun),
      stage: result.stage,
      startedNodeIds: result.startedNodeIds,
      startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput)
    }
  })

const agentsSkipRunGraphNode = rpc
  .input(SkipAgentRunGraphNodeInputSchema)
  .output(SkipAgentRunGraphNodeOutputSchema)
  .handler(async ({ context, input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })
    const result = await kernel.skipRunGraphNode({
      chatSessionId: input.sessionId,
      db: context.db,
      nodeId: input.nodeId,
      reason: input.reason,
      rootRunId: input.runId
    })

    return {
      plan: result.plan,
      run: toAgentRunTraceRunOutput(result.rootRun),
      skippedNodeId: result.skippedNodeId,
      stage: result.stage,
      startedNodeIds: result.startedNodeIds,
      startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput)
    }
  })

const agentsUpdateRunGraphRetryPolicy = rpc
  .input(UpdateAgentRunGraphRetryPolicyInputSchema)
  .output(UpdateAgentRunGraphRetryPolicyOutputSchema)
  .handler(async ({ context, input }) => {
    const kernel = createAgentKernel({
      settings: getSettings().agents
    })
    const result = await kernel.updateRunGraphRetryPolicy({
      chatSessionId: input.sessionId,
      db: context.db,
      retryPolicy: input.retryPolicy,
      rootRunId: input.runId
    })

    return {
      plan: result.plan,
      retryPolicy: result.retryPolicy,
      run: toAgentRunTraceRunOutput(result.rootRun)
    }
  })

const agentsRespondToRunGraphApproval = rpc
  .input(RespondAgentRunGraphApprovalInputSchema)
  .output(RespondAgentRunGraphApprovalOutputSchema)
  .handler(async ({ context, input }) => {
    const session = await getChatSessionById(context.db, input.sessionId)

    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`)
    }

    const rootRun = await getAgentRun({
      chatSessionId: input.sessionId,
      db: context.db,
      runId: input.rootRunId
    })

    if (!rootRun) {
      throw new Error(`Agent run not found: ${input.rootRunId}`)
    }

    const settings = getSettings()
    const kernel = createAgentKernel({
      settings: settings.agents
    })
    const result = await kernel.resumeRunGraphNodeApprovalWithAiSdk({
      approvalId: input.approvalId,
      approved: input.approved,
      chatSessionId: input.sessionId,
      db: context.db,
      memorySettings: settings.memory,
      model: resolveModel(rootRun.modelId ?? session.modelId ?? undefined),
      projectPath: session.projectPath,
      ...(input.reason ? { reason: input.reason } : {}),
      resolveModel,
      rootRunId: rootRun.id,
      toolCallId: input.toolCallId
    })
    const continuedGraph =
      input.continueUntilIdle && result.stopReason !== "suspended"
        ? await kernel.runGraphUntilIdleWithAiSdk({
            chatSessionId: input.sessionId,
            db: context.db,
            memorySettings: settings.memory,
            model: resolveModel(
              rootRun.modelId ?? session.modelId ?? undefined
            ),
            projectPath: session.projectPath,
            resolveModel,
            rootRunId: rootRun.id
          })
        : null

    await listChatMessagesWithAgentProjectionRepair({
      db: context.db,
      sessionId: input.sessionId
    })

    return {
      childRun: toAgentRunTraceRunOutput(result.childRun),
      ...(continuedGraph
        ? { continuedGraph: toAgentRunGraphUntilIdleOutput(continuedGraph) }
        : {}),
      nodeId: result.nodeId,
      plan: result.plan,
      run: toAgentRunTraceRunOutput(result.rootRun),
      settledNodeIds: result.settledNodeIds,
      stage: result.stage,
      startedNodeIds: result.startedNodeIds,
      startedRuns: result.startedRuns.map(toAgentRunTraceRunOutput),
      stopReason: result.stopReason,
      turns: result.turns
    }
  })

const agentsQueueMessage = rpc
  .input(QueueAgentMessageInputSchema)
  .output(QueueAgentMessageOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getActiveAgentRunForSession({
      chatSessionId: input.sessionId,
      db: context.db
    })

    if (!run) {
      throw new Error(
        `Active agent run not found for chat session: ${input.sessionId}`
      )
    }

    const message = await createAgentSessionQueuedMessageWriter({ run })({
      content: input.content,
      queue: input.queue
    })

    return {
      message: {
        chatSessionId: run.chatSessionId,
        content: message.message,
        createdAt: message.createdAt,
        id: message.id,
        queue: message.queue,
        runId: message.runId
      }
    }
  })

const agentsUpdateQueuedMessage = rpc
  .input(UpdateQueuedAgentMessageInputSchema)
  .output(QueuedAgentMessagesOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getAgentQueueRunForSession({
      db: context.db,
      sessionId: input.sessionId
    })

    if (!run) {
      throw new Error(
        `Agent queue run not found for chat session: ${input.sessionId}`
      )
    }

    await appendAgentSessionQueuedMessageUpdateEvent({
      id: input.id,
      ...(input.content ? { message: input.content } : {}),
      ...(input.queue ? { queue: input.queue } : {}),
      run
    })

    const messages = await listQueuedMessagesForRun({
      db: context.db,
      runId: run.id
    })

    return {
      messages: messages.map((message) =>
        toQueuedMessageOutput(run.chatSessionId, message)
      )
    }
  })

const agentsRemoveQueuedMessage = rpc
  .input(RemoveQueuedAgentMessageInputSchema)
  .output(QueuedAgentMessagesOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getAgentQueueRunForSession({
      db: context.db,
      sessionId: input.sessionId
    })

    if (!run) {
      throw new Error(
        `Agent queue run not found for chat session: ${input.sessionId}`
      )
    }

    await appendAgentSessionQueuedMessageRemoveEvent({
      id: input.id,
      run
    })

    const messages = await listQueuedMessagesForRun({
      db: context.db,
      runId: run.id
    })

    return {
      messages: messages.map((message) =>
        toQueuedMessageOutput(run.chatSessionId, message)
      )
    }
  })

const agentsReorderQueuedMessages = rpc
  .input(ReorderQueuedAgentMessagesInputSchema)
  .output(QueuedAgentMessagesOutputSchema)
  .handler(async ({ context, input }) => {
    const run = await getAgentQueueRunForSession({
      db: context.db,
      sessionId: input.sessionId
    })

    if (!run) {
      throw new Error(
        `Agent queue run not found for chat session: ${input.sessionId}`
      )
    }

    await appendAgentSessionQueuedMessagesReorderEvent({
      ids: input.ids,
      run
    })

    const messages = await listQueuedMessagesForRun({
      db: context.db,
      runId: run.id
    })

    return {
      messages: messages.map((message) =>
        toQueuedMessageOutput(run.chatSessionId, message)
      )
    }
  })

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
  .handler(async ({ context, input }) => ({
    entries: await listMemoryEntries(context.db, input.limit)
  }))

const memoryStats = rpc
  .output(MemoryStatsOutputSchema)
  .handler(({ context }) => getMemoryStats(context.db))

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
    messages: await listChatMessagesWithAgentProjectionRepair({
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
  agents: {
    advanceRunGraph: agentsAdvanceRunGraph,
    appendSessionCompactionSummary: agentsAppendSessionCompactionSummary,
    executeRunGraphNode: agentsExecuteRunGraphNode,
    inspectRun: agentsInspectRun,
    inspectSession: agentsInspectSession,
    instantiateRunGraphTemplate: agentsInstantiateRunGraphTemplate,
    listPendingApprovals: agentsListPendingApprovals,
    listQueuedMessages: agentsListQueuedMessages,
    listRecoverableRuns: agentsListRecoverableRuns,
    listRuns: agentsListRuns,
    listRunGraphTemplates: agentsListRunGraphTemplates,
    listUiStreamSnapshots: agentsListUiStreamSnapshots,
    moveSessionLeaf: agentsMoveSessionLeaf,
    previewRunGraphTemplate: agentsPreviewRunGraphTemplate,
    queueMessage: agentsQueueMessage,
    readArtifact: agentsReadArtifact,
    rememberCommandApproval: agentsRememberCommandApproval,
    removeQueuedMessage: agentsRemoveQueuedMessage,
    reorderQueuedMessages: agentsReorderQueuedMessages,
    respondToRunGraphApproval: agentsRespondToRunGraphApproval,
    retryRunGraphNode: agentsRetryRunGraphNode,
    runGraphUntilIdle: agentsRunGraphUntilIdle,
    skipRunGraphNode: agentsSkipRunGraphNode,
    startRunGraphNextStage: agentsStartRunGraphNextStage,
    stopActiveRun: agentsStopActiveRun,
    updateRunGraphRetryPolicy: agentsUpdateRunGraphRetryPolicy,
    updateQueuedMessage: agentsUpdateQueuedMessage
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
  tokenSavings: {
    get: tokenSavingsGet
  }
}

export type AppRouter = typeof router
