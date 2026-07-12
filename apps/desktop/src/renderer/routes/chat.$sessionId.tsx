import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "@ai-sdk/react"
import { useI18n } from "@etyon/i18n/react"
import type {
  ChatMention,
  ChatUiMessage as PersistedChatUiMessage,
  ChatSessionSummary,
  GitProjectDiffOutput,
  ModelEffortSettings,
  ProjectSnapshotItem,
  PromptTemplate,
  StreamdownAnimation
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { ChatLoader, ChatMessage, Resizable } from "@heroui-pro/react"
import type { PanelImperativeHandle } from "@heroui-pro/react"
import {
  Button,
  Chip,
  ScrollShadow,
  TextArea,
  ToggleButton,
  Tooltip
} from "@heroui/react"
import {
  ArrowDown02Icon,
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  FolderGitIcon,
  GitCommitIcon,
  GitCompareIcon,
  Image01Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  TerminalIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHotkey } from "@tanstack/react-hotkeys"
import { useDebouncedValue } from "@tanstack/react-pacer"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { DefaultChatTransport } from "ai"
import { getToolName, isToolUIPart } from "ai"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode, UIEvent } from "react"

import { AgentRunInspector } from "@/renderer/components/chat/agent-run-inspector"
import { ArtifactPanel } from "@/renderer/components/chat/artifact-panel"
import { AssistantMessageTimeline } from "@/renderer/components/chat/assistant-message-timeline"
import {
  MessageActions,
  USER_MESSAGE_ACTIONS
} from "@/renderer/components/chat/message-actions"
import { ModelSelector } from "@/renderer/components/chat/model-selector"
import { ProjectContextPanel } from "@/renderer/components/chat/project-context-panel"
import { PromptInput } from "@/renderer/components/chat/prompt-input"
import { getChatTransport } from "@/renderer/lib/ai/transport"
import {
  ARTIFACT_PANEL_VIEW_ID,
  collectPublishedArtifactRefs
} from "@/renderer/lib/chat/artifact-panel"
import type {
  ChatArtifactRef,
  ChatSidePanelView
} from "@/renderer/lib/chat/artifact-panel"
import { messageHasWorkSection } from "@/renderer/lib/chat/assistant-message-timeline"
import { shouldSendChatAutomatically } from "@/renderer/lib/chat/auto-send"
import {
  getImageModeToggleDisabled,
  resolveImageModeForModelChange
} from "@/renderer/lib/chat/image-mode"
import {
  ASSISTANT_LIVE_STATUS_LABEL_KEY,
  resolveAssistantLiveStatus
} from "@/renderer/lib/chat/live-status"
import {
  formatWorkTime,
  parseChatMessageMetadata
} from "@/renderer/lib/chat/message-metadata"
import type { ChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import { getToolInputCommand } from "@/renderer/lib/chat/message-tool-trace"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  buildAiSettingsWithDefaultModel,
  buildChatModelGroups,
  resolveChatModelValue
} from "@/renderer/lib/chat/model-options"
import {
  formatProjectDiffCount,
  getProjectDiffSummary,
  getProjectGitDiffInput,
  PROJECT_CHANGES_SCOPE_AGENT,
  isProjectContextPanelView,
  parseProjectDiffFiles,
  PROJECT_CONTEXT_CHANGES_TAB_ID,
  PROJECT_CONTEXT_COMMIT_TAB_ID,
  PROJECT_CONTEXT_FILES_TAB_ID,
  PROJECT_CONTEXT_TERMINAL_TAB_ID,
  shouldFetchProjectGitDiff
} from "@/renderer/lib/chat/project-context-panel"
import type {
  ProjectChangesScope,
  ProjectContextPanelView
} from "@/renderer/lib/chat/project-context-panel"
import {
  clearProjectPanelReveal,
  requestProjectPanelReveal,
  resolveProjectRelativePath,
  useProjectPanelRevealRequest
} from "@/renderer/lib/chat/project-panel-navigation"
import type {
  ProjectPanelRevealRequest,
  ProjectPanelRevealView
} from "@/renderer/lib/chat/project-panel-navigation"
import {
  filterPromptSkillMentionItems,
  filterPromptTemplateItems,
  getMentionDisplayName,
  getMentionTokenTypeLabel,
  getMentionTitle,
  splitPromptTextByMentions
} from "@/renderer/lib/chat/prompt-input"
import type {
  PromptMentionTrigger,
  PromptSkillMentionItem,
  QueuedPromptMessage
} from "@/renderer/lib/chat/prompt-input"
import { getChatStreamdownAnimation } from "@/renderer/lib/chat/streamdown-settings"
import {
  applySubagentApproval,
  applySubagentChunk,
  clearSubagents,
  setSubagentEnd,
  setSubagentStart
} from "@/renderer/lib/chat/subagent-stream-store"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import {
  respondToAssistantToolApproval,
  upsertCommandApprovalRule
} from "@/renderer/lib/chat/tool-ui"
import {
  clearWorkflowProgress,
  setWorkflowProgress
} from "@/renderer/lib/chat/workflow-progress-store"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import {
  CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS,
  getChatSessionTitle,
  sortChatSessionsByUpdatedAt
} from "@/renderer/lib/sidebar/chat-sessions"
import { getNextPermissionMode } from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import {
  getChatAgentModeFromAgentsEnabled,
  getChatAgentModeToggleDisabled,
  getNextChatAgentMode
} from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"
import {
  estimateChatContextUsagePercent,
  getChatContextUsageSegments
} from "@/shared/chat/context-usage"
import type { ChatContextUsageSegment } from "@/shared/chat/context-usage"
import {
  isChatRequestPhaseDataPart,
  isChatSubagentApprovalDataPart,
  isChatSubagentChunkDataPart,
  isChatSubagentEndDataPart,
  isChatSubagentStartDataPart,
  isChatWorkflowProgressDataPart
} from "@/shared/chat/stream-data"
import type {
  ChatRequestPhase,
  ChatStreamDataTypes
} from "@/shared/chat/stream-data"
import { isImageOutputModel } from "@/shared/providers/image-output"
import { DEFAULT_MODEL_EFFORT } from "@/shared/providers/model-effort"
import type {
  AnthropicEffortLevel,
  EffortProviderId,
  OpenAiEffortLevel
} from "@/shared/providers/model-effort"

const formatContextWindowLabel = (value: number | undefined): string | null => {
  if (!value) {
    return null
  }

  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`
  }

  return `${value}`
}

const isSelectedModelImageOutput = (
  modelGroups: ChatModelGroup[],
  selectedModelValue: string
): boolean => {
  const selectedOption = modelGroups
    .flatMap((group) => group.options)
    .find((option) => option.value === selectedModelValue)

  return selectedOption
    ? isImageOutputModel({
        capabilities: selectedOption.capabilities,
        id: selectedOption.id
      })
    : false
}

// Mirrors the PromptInputAgentModeControl recipe. Renders a bare button while
// disabled (no image model selected / request in flight) and wraps it in the
// explanatory tooltip only when actionable — following the conditional-tooltip
// precedent in project-context-panel.tsx.
const ComposerImageModeControl = ({
  isDisabled,
  isSelected,
  label,
  onPress,
  tooltip,
  unsupportedLabel
}: {
  isDisabled: boolean
  isSelected: boolean
  label: string
  onPress: () => void
  tooltip: string
  unsupportedLabel: string
}) => {
  const button = (
    <ToggleButton
      aria-label={isDisabled ? unsupportedLabel : tooltip}
      className={cn(
        "h-8 min-w-0 shrink-0 px-2.5 text-xs",
        isSelected && "bg-primary/15! text-primary!"
      )}
      isDisabled={isDisabled}
      isSelected={isSelected}
      onPress={onPress}
      size="sm"
    >
      <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={2} />
      <span>{label}</span>
    </ToggleButton>
  )

  if (isDisabled) {
    return button
  }

  return (
    <Tooltip>
      <Tooltip.Trigger>{button}</Tooltip.Trigger>
      <Tooltip.Content placement="top">{tooltip}</Tooltip.Content>
    </Tooltip>
  )
}

interface MentionQueryState {
  query: string
  trigger: PromptMentionTrigger
}

type ChatUiMessage = UIMessage<ChatMessageMetadata, ChatStreamDataTypes>
type ReasoningChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "reasoning" }
>
type TextChatPart = Extract<ChatUiMessage["parts"][number], { type: "text" }>
type ChatToolPart = Extract<
  ChatUiMessage["parts"][number],
  { toolCallId: string }
>

const chatSessionsQueryOptions = orpc.chatSessions.list.queryOptions({})
const settingsQueryOptions = orpc.settings.get.queryOptions({})
const getChatSessionMessagesQueryOptions = (sessionId: string) =>
  orpc.chatSessions.listMessages.queryOptions({
    input: {
      sessionId
    }
  })
const MENTION_ITEM_LIMIT = 50
const MENTION_SEARCH_DEBOUNCE_WAIT_MS = 180
const MENTION_SKILL_ITEM_LIMIT = 20
const PROMPT_TEMPLATE_ITEM_LIMIT = 20
const NOOP_AGENT_MODE_CHANGE = (mode: ChatAgentMode): void => {
  void mode
}
const NOOP_PERMISSION_MODE_CHANGE = (mode: AgentPermissionMode): void => {
  void mode
}
const NOOP_PROMPT_SUBMIT = (): Promise<void> => Promise.resolve()
const NOOP_IMAGE_MODE_TOGGLE = (): void => {
  // No-op: the image toggle is inert while the session is still loading.
}
const MESSAGE_SCROLL_BOTTOM_THRESHOLD_PX = 48
const PROJECT_CONTEXT_PANEL_DEFAULT_SIZE = 48
const PROJECT_CONTEXT_PANEL_MAX_SIZE = 100
const PROJECT_CONTEXT_PANEL_MIN_SIZE = 22
const PROJECT_TREE_ITEM_LIMIT = 5000
const CHAT_LAYOUT_CLASS_NAME = "flex h-svh min-h-0 flex-1 overflow-hidden"
const PROJECT_CONTEXT_TOOLBAR_ITEMS = [
  {
    icon: FolderGitIcon,
    labelKey: "chat.projectPanel.filesView",
    view: PROJECT_CONTEXT_FILES_TAB_ID
  },
  {
    icon: GitCompareIcon,
    labelKey: "chat.projectPanel.changesView",
    view: PROJECT_CONTEXT_CHANGES_TAB_ID
  },
  {
    icon: GitCommitIcon,
    labelKey: "chat.projectPanel.commitView",
    view: PROJECT_CONTEXT_COMMIT_TAB_ID
  },
  {
    icon: TerminalIcon,
    labelKey: "chat.projectPanel.terminalView",
    view: PROJECT_CONTEXT_TERMINAL_TAB_ID
  }
] as const

const getMessageText = (message: ChatUiMessage): string =>
  message.parts
    .filter((part): part is TextChatPart => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()

const toRuntimeChatMessage = (
  message: PersistedChatUiMessage
): ChatUiMessage => {
  const runtimeMessage = {
    id: message.id,
    parts: message.parts as ChatUiMessage["parts"],
    role: message.role
  }

  const metadata = parseChatMessageMetadata(message.metadata)

  if (metadata === undefined) {
    return runtimeMessage
  }

  return {
    ...runtimeMessage,
    metadata
  }
}

const InlineMentionToken = ({ mention }: { mention: ChatMention }) => {
  const { t } = useI18n()
  const tokenClassName =
    "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/80 px-1.5 py-1 align-baseline text-sm font-medium text-foreground ring-1 ring-border/70"
  const tokenBody = (
    <>
      <span className="grid h-5 min-w-5 place-items-center rounded-[4px] bg-foreground/15 px-1 text-[0.62rem] leading-none font-semibold text-muted-foreground uppercase">
        {getMentionTokenTypeLabel(mention)}
      </span>
      <span className="max-w-52 truncate group-hover:underline">
        {getMentionDisplayName(mention)}
      </span>
    </>
  )

  if (mention.kind === "file") {
    return (
      <button
        aria-label={t("chat.projectPanel.openFileWithPath", {
          path: mention.relativePath
        })}
        className={cn(
          tokenClassName,
          "group cursor-pointer transition-colors hover:bg-muted hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        onClick={() =>
          requestProjectPanelReveal({
            path: mention.relativePath,
            view: "file"
          })
        }
        title={getMentionTitle(mention)}
        type="button"
      >
        {tokenBody}
      </button>
    )
  }

  return (
    <span className={tokenClassName} title={getMentionTitle(mention)}>
      {tokenBody}
    </span>
  )
}

const getMessageToolParts = (message: ChatUiMessage): ChatToolPart[] =>
  message.parts.filter((part): part is ChatToolPart =>
    isToolUIPart(part as never)
  )

// A run that ends awaiting tool approval reaches "ready" mid-turn; queued
// follow-ups must not drain until the user has responded to the approval.
const hasPendingToolApproval = (
  message: ChatUiMessage | undefined
): boolean => {
  if (message?.role !== "assistant") {
    return false
  }

  return getMessageToolParts(message).some(
    (part) => part.state === "approval-requested"
  )
}

const getMessageReasoningParts = (
  message: ChatUiMessage
): ReasoningChatPart[] =>
  message.parts.filter(
    (part): part is ReasoningChatPart => part.type === "reasoning"
  )

const MessageTextContent = ({
  mentions,
  messageId,
  text
}: {
  mentions: ChatMention[]
  messageId: string
  text: string
}) => {
  if (!text.trim()) {
    return null
  }

  const messageParts = splitPromptTextByMentions({
    mentions,
    text
  })

  return (
    <p className="whitespace-pre-wrap">
      {messageParts.map((part, index) =>
        part.type === "mention" ? (
          <InlineMentionToken
            key={`${messageId}-mention-${part.mention.kind}-${part.mention.path}-${index}`}
            mention={part.mention}
          />
        ) : (
          <span key={`${messageId}-text-${index}`}>{part.text}</span>
        )
      )}
    </p>
  )
}

const ChatErrorActionBar = ({
  errorMessage,
  isRegenerating,
  onDismiss,
  onRegenerate
}: {
  errorMessage: string
  isRegenerating: boolean
  onDismiss: () => void
  onRegenerate: () => void
}) => {
  const { t } = useI18n()

  return (
    <div className="flex justify-start">
      <div className="max-w-[78%] rounded-3xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive">
        <p className="text-xs leading-5">{errorMessage}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            isDisabled={isRegenerating}
            onPress={onRegenerate}
            size="sm"
            type="button"
            variant="danger-soft"
          >
            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} />
            {t("chat.error.regenerate")}
          </Button>
          <Button
            isDisabled={isRegenerating}
            onPress={onDismiss}
            size="sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
            {t("chat.error.dismiss")}
          </Button>
        </div>
      </div>
    </div>
  )
}

const ProjectContextTrigger = ({
  gitDiff,
  gitStatus,
  isOpen,
  onToggle
}: {
  gitDiff?: GitProjectDiffOutput
  gitStatus: ChatSessionSummary["gitStatus"]
  isOpen: boolean
  onToggle: () => void
}) => {
  const { t } = useI18n()
  const diffFiles = useMemo(
    () =>
      parseProjectDiffFiles({
        fileSnapshots: gitDiff?.fileSnapshots ?? [],
        patch: gitDiff?.patch ?? ""
      }),
    [gitDiff?.fileSnapshots, gitDiff?.patch]
  )
  const diffSummary = useMemo(
    () =>
      getProjectDiffSummary({
        diffFiles,
        fallbackChangedFileCount: gitStatus?.changedFileCount ?? 0
      }),
    [diffFiles, gitStatus?.changedFileCount]
  )
  const hasDiffSummary = diffSummary.changedFileCount > 0

  return (
    <Button
      aria-label={t(
        isOpen ? "chat.projectPanel.closePanel" : "chat.projectPanel.openPanel"
      )}
      aria-pressed={isOpen}
      className="title-bar-no-drag shrink-0"
      onPress={onToggle}
      size="sm"
      type="button"
      variant={isOpen ? "secondary" : "outline"}
    >
      <HugeiconsIcon
        icon={isOpen ? PanelRightCloseIcon : PanelRightOpenIcon}
        size={15}
        strokeWidth={2}
      />
      {t("chat.projectPanel.review")}
      {hasDiffSummary ? (
        <span className="ml-1 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold tabular-nums">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            {formatProjectDiffCount(diffSummary.changedFileCount)}
          </span>
          {diffSummary.additions > 0 ? (
            <span className="text-success">
              +{formatProjectDiffCount(diffSummary.additions)}
            </span>
          ) : null}
          {diffSummary.deletions > 0 ? (
            <span className="text-danger">
              -{formatProjectDiffCount(diffSummary.deletions)}
            </span>
          ) : null}
        </span>
      ) : null}
    </Button>
  )
}

const ChatSessionHeader = ({
  gitDiff,
  isProjectContextOpen,
  onToggleProjectContext,
  selectedSession,
  sessionTitle
}: {
  gitDiff?: GitProjectDiffOutput
  isProjectContextOpen: boolean
  onToggleProjectContext: () => void
  selectedSession: ChatSessionSummary
  sessionTitle: string
}) => (
  <div className="title-bar-drag flex shrink-0 items-start justify-between gap-4">
    <div className="min-w-0 space-y-2">
      <h1 className="truncate text-2xl font-semibold">{sessionTitle}</h1>
    </div>
    <div className="title-bar-no-drag flex shrink-0 items-center gap-2">
      <ProjectContextTrigger
        gitDiff={gitDiff}
        gitStatus={selectedSession.gitStatus}
        isOpen={isProjectContextOpen}
        onToggle={onToggleProjectContext}
      />
    </div>
  </div>
)

const ProjectContextCollapsedToolbar = ({
  changedFileCount,
  onOpenView,
  selectedView
}: {
  changedFileCount: number
  onOpenView: (view: ProjectContextPanelView) => void
  selectedView: ChatSidePanelView
}) => {
  const { t } = useI18n()

  return (
    <aside className="flex h-full w-18 shrink-0 items-start justify-center px-3 py-6">
      <div className="flex flex-col items-center gap-2 rounded-full border border-border bg-card/70 p-2 shadow-sm">
        {PROJECT_CONTEXT_TOOLBAR_ITEMS.map((item) => {
          const isSelected = selectedView === item.view
          const showBadge =
            item.view === PROJECT_CONTEXT_COMMIT_TAB_ID && changedFileCount > 0

          return (
            <button
              aria-label={t(item.labelKey)}
              className={cn(
                "relative grid size-9 place-items-center rounded-full border-0 bg-transparent p-0 text-muted-foreground outline-none transition-[background-color,color] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                isSelected && "bg-primary/12 text-primary"
              )}
              key={item.view}
              onClick={() => onOpenView(item.view)}
              title={t(item.labelKey)}
              type="button"
            >
              <HugeiconsIcon icon={item.icon} size={19} strokeWidth={2} />
              {showBadge ? (
                <span className="absolute -top-1.5 -right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
                  {formatProjectDiffCount(changedFileCount)}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

const ChatProjectContextLayout = ({
  activeArtifact = null,
  children,
  gitDiff,
  gitDiffScope,
  isDiffLoading,
  isOpen,
  isTreeLoading,
  onOpenChange,
  onGitDiffScopeChange,
  onViewChange,
  onRefresh,
  projectItems,
  selectedSession,
  selectedView
}: {
  activeArtifact?: ChatArtifactRef | null
  children: ReactNode
  gitDiff?: GitProjectDiffOutput
  gitDiffScope: ProjectChangesScope
  isDiffLoading: boolean
  isOpen: boolean
  isTreeLoading: boolean
  onOpenChange: (isOpen: boolean) => void
  onGitDiffScopeChange: (scope: ProjectChangesScope) => void
  onViewChange: (view: ProjectContextPanelView) => void
  onRefresh: () => void
  projectItems: ProjectSnapshotItem[]
  selectedSession: ChatSessionSummary
  selectedView: ChatSidePanelView
}) => {
  const { t } = useI18n()
  const projectContextPanelRef = useRef<PanelImperativeHandle | null>(null)
  const changedFileCount = selectedSession.gitStatus?.changedFileCount ?? 0
  const isArtifactView =
    selectedView === ARTIFACT_PANEL_VIEW_ID && activeArtifact !== null
  const projectPanelView: ProjectContextPanelView = isProjectContextPanelView(
    selectedView
  )
    ? selectedView
    : PROJECT_CONTEXT_FILES_TAB_ID

  useEffect(() => {
    const projectContextPanel = projectContextPanelRef.current

    if (!projectContextPanel) {
      return
    }

    if (!isOpen) {
      projectContextPanel.collapse()
      return
    }

    projectContextPanel.expand()

    if (
      projectContextPanel.getSize().asPercentage <
      PROJECT_CONTEXT_PANEL_MIN_SIZE
    ) {
      projectContextPanel.resize(PROJECT_CONTEXT_PANEL_DEFAULT_SIZE)
    }
  }, [isOpen])

  const handleOpenView = useCallback(
    (view: ProjectContextPanelView) => {
      onViewChange(view)
      onOpenChange(true)
    },
    [onOpenChange, onViewChange]
  )

  const revealRequest = useProjectPanelRevealRequest()
  const [revealTarget, setRevealTarget] =
    useState<ProjectPanelRevealRequest | null>(null)
  const handledRevealIdRef = useRef<number | null>(null)

  useEffect(() => {
    setRevealTarget(null)
    handledRevealIdRef.current = null
  }, [selectedSession.id])

  // A reveal request from anywhere in the chat flow opens the panel, switches to
  // the resolved tab, and hands the resolved (project-relative) target down for
  // the sub-panels to select/scroll. Paths outside the project are ignored.
  useEffect(() => {
    if (
      !revealRequest ||
      revealRequest.requestId === handledRevealIdRef.current
    ) {
      return
    }

    handledRevealIdRef.current = revealRequest.requestId

    const relativePath = resolveProjectRelativePath({
      path: revealRequest.path,
      projectPath: selectedSession.projectPath
    })

    if (relativePath === null) {
      clearProjectPanelReveal()
      return
    }

    const changedFiles = selectedSession.gitStatus?.files
    const isChangedFile =
      changedFiles?.some(
        (file) => file.path === relativePath && file.status !== "ignored"
      ) ?? false
    // Honor a diff request only when the Changes tab can know the file; fall back
    // to the read-only viewer otherwise (e.g. an edit whose diff is not tracked).
    const resolvedView: ProjectPanelRevealView =
      revealRequest.view === "diff" &&
      (changedFiles === undefined || isChangedFile)
        ? "diff"
        : "file"

    onViewChange(
      resolvedView === "diff"
        ? PROJECT_CONTEXT_CHANGES_TAB_ID
        : PROJECT_CONTEXT_FILES_TAB_ID
    )
    onOpenChange(true)
    setRevealTarget({
      path: relativePath,
      requestId: revealRequest.requestId,
      view: resolvedView,
      ...(revealRequest.line === undefined ? {} : { line: revealRequest.line })
    })
    clearProjectPanelReveal()
  }, [
    onOpenChange,
    onViewChange,
    revealRequest,
    selectedSession.gitStatus,
    selectedSession.projectPath
  ])

  return (
    <div className={CHAT_LAYOUT_CLASS_NAME}>
      <Resizable
        className="h-svh min-h-0 min-w-0 flex-1 overflow-hidden"
        orientation="horizontal"
      >
        <Resizable.Panel
          className="min-w-0 overflow-hidden"
          defaultSize={100}
          id="chat-main"
        >
          {children}
        </Resizable.Panel>
        <Resizable.Handle
          aria-label={t("chat.projectPanel.resizeHandle")}
          className={cn("self-stretch", !isOpen && "hidden")}
          disabled={!isOpen}
          type="line"
          variant="secondary"
          withIndicator
        />
        <Resizable.Panel
          className={cn("min-w-0 overflow-hidden h-svh", !isOpen && "hidden")}
          collapsedSize={0}
          collapsible
          defaultSize={0}
          handleRef={projectContextPanelRef}
          id="project-context"
          maxSize={PROJECT_CONTEXT_PANEL_MAX_SIZE}
          minSize={PROJECT_CONTEXT_PANEL_MIN_SIZE}
          onCollapse={() => onOpenChange(false)}
          onExpand={() => onOpenChange(true)}
        >
          {isArtifactView && activeArtifact ? (
            <ArtifactPanel
              artifact={activeArtifact}
              key={activeArtifact.toolCallId}
              onClose={() => onOpenChange(false)}
              sessionId={selectedSession.id}
            />
          ) : (
            <ProjectContextPanel
              gitDiff={gitDiff}
              gitDiffScope={gitDiffScope}
              isDiffLoading={isDiffLoading}
              isTreeLoading={isTreeLoading}
              onGitDiffScopeChange={onGitDiffScopeChange}
              onRefresh={onRefresh}
              onViewChange={onViewChange}
              projectItems={projectItems}
              revealTarget={revealTarget}
              selectedSession={selectedSession}
              selectedView={projectPanelView}
            />
          )}
        </Resizable.Panel>
      </Resizable>
      {isOpen ? null : (
        <ProjectContextCollapsedToolbar
          changedFileCount={changedFileCount}
          onOpenView={handleOpenView}
          selectedView={selectedView}
        />
      )}
    </div>
  )
}

const upsertChatSession = ({
  nextSession,
  sessions
}: {
  nextSession: ChatSessionSummary
  sessions: ChatSessionSummary[] | undefined
}): ChatSessionSummary[] => {
  const previousSession = sessions?.find(
    (session) => session.id === nextSession.id
  )

  return sortChatSessionsByUpdatedAt([
    {
      ...nextSession,
      gitStatus: nextSession.gitStatus ?? previousSession?.gitStatus
    },
    ...(sessions ?? []).filter((session) => session.id !== nextSession.id)
  ])
}

const useChatMentionSuggestions = ({
  selectedSession,
  sessionExists,
  sessionId
}: {
  selectedSession: ChatSessionSummary | undefined
  sessionExists: boolean
  sessionId: string
}) => {
  const [mentionQueryState, setMentionQueryState] =
    useState<MentionQueryState | null>(null)
  const [promptTemplateQuery, setPromptTemplateQuery] = useState<string | null>(
    null
  )
  const [debouncedMentionQueryState] = useDebouncedValue(mentionQueryState, {
    key: "chat-mention-suggestions",
    leading: true,
    trailing: true,
    wait: MENTION_SEARCH_DEBOUNCE_WAIT_MS
  })
  const [debouncedPromptTemplateQuery] = useDebouncedValue(
    promptTemplateQuery,
    {
      key: "chat-prompt-template-suggestions",
      leading: true,
      trailing: true,
      wait: MENTION_SEARCH_DEBOUNCE_WAIT_MS
    }
  )
  const mentionTrigger = mentionQueryState?.trigger ?? null
  const mentionQuery =
    debouncedMentionQueryState?.trigger === mentionTrigger
      ? debouncedMentionQueryState.query
      : ""
  const mentionItemsQuery = useQuery({
    ...orpc.projectSnapshots.listFiles.queryOptions({
      input: {
        limit: MENTION_ITEM_LIMIT,
        query: mentionQuery,
        sessionId
      }
    }),
    enabled: sessionExists && mentionTrigger === "project",
    placeholderData: (previousData) => previousData
  })
  const mentionSkillsQuery = useQuery({
    ...orpc.skills.list.queryOptions({}),
    enabled:
      sessionExists &&
      (mentionTrigger === "project" || mentionTrigger === "skill")
  })
  const promptTemplatesQuery = useQuery({
    ...orpc.skills.listPromptTemplates.queryOptions({}),
    enabled: sessionExists && promptTemplateQuery !== null,
    placeholderData: (previousData) => previousData
  })
  const mentionSkillItems = useMemo(
    () =>
      filterPromptSkillMentionItems({
        limit: MENTION_SKILL_ITEM_LIMIT,
        projectPath: selectedSession?.projectPath ?? "",
        query: mentionQuery,
        searchMode: mentionTrigger === "project" ? "title" : "full",
        skills: mentionSkillsQuery.data?.skills ?? []
      }),
    [
      mentionQuery,
      mentionTrigger,
      mentionSkillsQuery.data?.skills,
      selectedSession?.projectPath
    ]
  )
  const promptTemplateItems = useMemo(
    () =>
      filterPromptTemplateItems({
        limit: PROMPT_TEMPLATE_ITEM_LIMIT,
        query: debouncedPromptTemplateQuery ?? "",
        templates: promptTemplatesQuery.data?.templates ?? []
      }),
    [debouncedPromptTemplateQuery, promptTemplatesQuery.data?.templates]
  )
  const handleMentionQueryChange = useCallback(
    (query: string | null, trigger: PromptMentionTrigger | null) => {
      setMentionQueryState(
        query === null || trigger === null
          ? null
          : {
              query,
              trigger
            }
      )
    },
    []
  )
  const handlePromptTemplateQueryChange = useCallback(
    (query: string | null) => {
      setPromptTemplateQuery(query)
    },
    []
  )

  return {
    handleMentionQueryChange,
    handlePromptTemplateQueryChange,
    isLoadingFileItems:
      mentionItemsQuery.isFetching ||
      (mentionTrigger === "project" && mentionSkillsQuery.isFetching),
    isLoadingPromptTemplateItems: promptTemplatesQuery.isFetching,
    isLoadingSkillItems: mentionSkillsQuery.isFetching,
    mentionItems: mentionItemsQuery.data?.files ?? [],
    mentionSkillItems,
    promptTemplateItems
  }
}

const MessageMentionChips = ({
  isAssistant,
  mentions,
  messageId
}: {
  isAssistant: boolean
  mentions: ChatMention[]
  messageId: string
}) => {
  const { t } = useI18n()

  if (mentions.length === 0) {
    return null
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {mentions.map((mention) => {
        const chip = (
          <Chip
            className={cn(
              "max-w-full",
              mention.kind === "file" && "group-hover:underline"
            )}
            color={isAssistant ? "default" : "accent"}
            size="sm"
            variant={isAssistant ? "secondary" : "soft"}
          >
            <Chip.Label className="truncate">
              {getMentionDisplayName(mention)}
            </Chip.Label>
          </Chip>
        )
        const chipKey = `${messageId}-${mention.kind}-${mention.path}`

        if (mention.kind === "file") {
          return (
            <button
              aria-label={t("chat.projectPanel.openFileWithPath", {
                path: mention.relativePath
              })}
              className="group max-w-full cursor-pointer rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              key={chipKey}
              onClick={() =>
                requestProjectPanelReveal({
                  path: mention.relativePath,
                  view: "file"
                })
              }
              title={getMentionTitle(mention)}
              type="button"
            >
              {chip}
            </button>
          )
        }

        return <span key={chipKey}>{chip}</span>
      })}
    </div>
  )
}

const MessageSegmentContent = ({
  mentions,
  messageId,
  text
}: {
  mentions: ChatMention[]
  messageId: string
  text: string
}) => (
  <MessageTextContent mentions={mentions} messageId={messageId} text={text} />
)

const hasRenderableAssistantContent = (message: ChatUiMessage | undefined) =>
  message?.role === "assistant" &&
  (getMessageText(message) !== "" ||
    getMessageReasoningParts(message).length > 0 ||
    getMessageToolParts(message).length > 0)

const AssistantWorkTime = ({
  liveStartedAt,
  workTimeMs
}: {
  liveStartedAt?: number
  workTimeMs?: number
}) => {
  const { t } = useI18n()
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | undefined>()

  useEffect(() => {
    if (workTimeMs !== undefined) {
      setLiveElapsedMs(undefined)
      return
    }

    if (liveStartedAt === undefined) {
      setLiveElapsedMs(undefined)
      return
    }

    const updateElapsed = () => {
      setLiveElapsedMs(Math.max(0, Date.now() - liveStartedAt))
    }

    updateElapsed()
    const intervalId = window.setInterval(updateElapsed, 200)

    return () => window.clearInterval(intervalId)
  }, [liveStartedAt, workTimeMs])

  const durationMs =
    workTimeMs ?? liveElapsedMs ?? (liveStartedAt === undefined ? undefined : 0)

  if (durationMs === undefined) {
    return null
  }

  return (
    <p className="mb-2 text-[0.6875rem] text-muted-foreground">
      {t("chat.workTime.label", {
        duration: formatWorkTime(durationMs)
      })}
    </p>
  )
}

const AssistantLiveStatus = ({
  latestMessage,
  requestPhase,
  requestStartedAt,
  status
}: {
  latestMessage?: ChatUiMessage
  requestPhase?: ChatRequestPhase | null
  requestStartedAt?: number
  status: "streaming" | "submitted"
}) => {
  const { t } = useI18n()
  const liveStatus = resolveAssistantLiveStatus({
    latestMessage,
    requestPhase,
    status
  })

  return (
    <ChatMessage.Assistant className="group/message flex justify-start outline-none">
      <ChatMessage.Bubble className="w-full max-w-3xl bg-transparent px-1 py-2 shadow-none">
        <ChatMessage.Body className="pr-0">
          <ChatMessage.Content className="flex flex-col gap-1 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground/80">
              <ChatLoader.Dots
                className="text-muted-foreground"
                label={t(ASSISTANT_LIVE_STATUS_LABEL_KEY[liveStatus])}
                size="sm"
              />
              <span className="shimmer">
                {t(ASSISTANT_LIVE_STATUS_LABEL_KEY[liveStatus])}
              </span>
            </span>
            <AssistantWorkTime liveStartedAt={requestStartedAt} />
          </ChatMessage.Content>
        </ChatMessage.Body>
      </ChatMessage.Bubble>
    </ChatMessage.Assistant>
  )
}

const EditingMessageBubble = ({
  editingMessageText,
  isRequestPending,
  onCancelEditMessage,
  onEditingMessageTextChange,
  onSubmitEditedMessage,
  message
}: {
  editingMessageText: string
  isRequestPending: boolean
  message: ChatUiMessage
  onCancelEditMessage: () => void
  onEditingMessageTextChange: (value: string) => void
  onSubmitEditedMessage: (message: ChatUiMessage) => void
}) => {
  const { t } = useI18n()

  return (
    <div className="rounded-3xl border border-border bg-card/80 p-3 shadow-sm">
      <TextArea
        aria-label={t("chat.messageActions.edit")}
        className="min-h-24 min-w-0 text-sm"
        fullWidth
        onChange={(event) => onEditingMessageTextChange(event.target.value)}
        rows={3}
        value={editingMessageText}
        variant="secondary"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          onPress={onCancelEditMessage}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("chat.messageActions.cancelEdit")}
        </Button>
        <Button
          isDisabled={isRequestPending || editingMessageText.trim() === ""}
          onPress={() => onSubmitEditedMessage(message)}
          size="sm"
          type="button"
        >
          {t("chat.messageActions.saveEdit")}
        </Button>
      </div>
    </div>
  )
}

const ChatMessageBubble = ({
  isAssistant,
  isLatestAssistantMessage,
  isRequestPending,
  liveWorkTimeStartedAt,
  message,
  onApprovalResponse,
  onOpenArtifact,
  sessionId,
  streamdownAnimation
}: {
  isAssistant: boolean
  isLatestAssistantMessage: boolean
  isRequestPending: boolean
  liveWorkTimeStartedAt?: number
  message: ChatUiMessage
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  sessionId: string
  streamdownAnimation: StreamdownAnimation
}) => {
  const metadata = parseChatMessageMetadata(message.metadata)
  const mentions = metadata?.mentions ?? []
  const messageText = getMessageText(message)
  const hasInlineMentions =
    !isAssistant &&
    splitPromptTextByMentions({
      mentions,
      text: messageText
    }).some((part) => part.type === "mention")

  if (isAssistant) {
    const isRunActive = isLatestAssistantMessage && isRequestPending
    // The work section header carries the duration for runs with a timeline;
    // only plain-text replies keep the standalone work-time line.
    const hasWorkSection = messageHasWorkSection(message)

    return (
      <ChatMessage.Bubble className="w-full min-w-0 bg-transparent px-1 py-1 shadow-none">
        <ChatMessage.Body className="pr-0">
          <ChatMessage.Content className="text-sm leading-6 text-foreground">
            {hasWorkSection ? null : (
              <AssistantWorkTime
                liveStartedAt={isRunActive ? liveWorkTimeStartedAt : undefined}
                workTimeMs={metadata?.workTimeMs}
              />
            )}

            {mentions.length > 0 && !hasInlineMentions ? (
              <MessageMentionChips
                isAssistant
                mentions={mentions}
                messageId={message.id}
              />
            ) : null}

            <AssistantMessageTimeline
              isApprovalActionDisabled={isRequestPending}
              isRunActive={isRunActive}
              isStreamdownAnimating={isRunActive}
              liveWorkTimeStartedAt={liveWorkTimeStartedAt}
              message={message}
              onApprovalResponse={onApprovalResponse}
              onOpenArtifact={onOpenArtifact}
              sessionId={sessionId}
              streamdownAnimation={streamdownAnimation}
            />
          </ChatMessage.Content>
        </ChatMessage.Body>
      </ChatMessage.Bubble>
    )
  }

  return (
    <ChatMessage.Bubble className="rounded-3xl bg-primary px-4 py-3 text-primary-foreground">
      <ChatMessage.Body className="pr-0">
        <ChatMessage.Content>
          {mentions.length > 0 && !hasInlineMentions ? (
            <MessageMentionChips
              isAssistant={isAssistant}
              mentions={mentions}
              messageId={message.id}
            />
          ) : null}

          <MessageSegmentContent
            mentions={mentions}
            messageId={message.id}
            text={messageText}
          />
        </ChatMessage.Content>
      </ChatMessage.Body>
    </ChatMessage.Bubble>
  )
}

const ChatMessageItem = memo(
  ({
    editingMessageId,
    editingMessageText,
    isLatestAssistantMessage,
    isRequestPending,
    liveWorkTimeStartedAt,
    message,
    onApprovalResponse,
    onCancelEditMessage,
    onEditingMessageTextChange,
    onOpenArtifact,
    onRegenerate,
    onStartEditMessage,
    onSubmitEditedMessage,
    sessionId,
    streamdownAnimation
  }: {
    editingMessageId: string | null
    editingMessageText: string
    isLatestAssistantMessage: boolean
    isRequestPending: boolean
    liveWorkTimeStartedAt?: number
    message: ChatUiMessage
    onApprovalResponse: (
      part: ChatToolPart,
      approved: boolean,
      options?: AssistantToolApprovalResponseOptions
    ) => void
    onCancelEditMessage: () => void
    onEditingMessageTextChange: (value: string) => void
    onOpenArtifact?: (artifact: ChatArtifactRef) => void
    onRegenerate: (messageId?: string) => void
    onStartEditMessage: (message: ChatUiMessage) => void
    onSubmitEditedMessage: (message: ChatUiMessage) => void
    sessionId: string
    streamdownAnimation: StreamdownAnimation
  }) => {
    const isAssistant = message.role === "assistant"
    const isUser = message.role === "user"
    const isEditingMessage = isUser && editingMessageId === message.id
    const messageText = getMessageText(message)
    const MessageRoot = isAssistant ? ChatMessage.Assistant : ChatMessage.User

    return (
      <MessageRoot
        className={cn(
          "group/message flex outline-none",
          isAssistant ? "justify-start" : "justify-end"
        )}
      >
        <div
          className={cn(
            "min-w-0",
            isAssistant ? "w-full max-w-3xl" : "max-w-[78%]"
          )}
        >
          {isEditingMessage ? (
            <EditingMessageBubble
              editingMessageText={editingMessageText}
              isRequestPending={isRequestPending}
              message={message}
              onCancelEditMessage={onCancelEditMessage}
              onEditingMessageTextChange={onEditingMessageTextChange}
              onSubmitEditedMessage={onSubmitEditedMessage}
            />
          ) : (
            <ChatMessageBubble
              isAssistant={isAssistant}
              isLatestAssistantMessage={isLatestAssistantMessage}
              isRequestPending={isRequestPending}
              liveWorkTimeStartedAt={liveWorkTimeStartedAt}
              message={message}
              onApprovalResponse={onApprovalResponse}
              onOpenArtifact={onOpenArtifact}
              sessionId={sessionId}
              streamdownAnimation={streamdownAnimation}
            />
          )}

          {isAssistant ? (
            <div className="flex items-center gap-1">
              <MessageActions
                align="start"
                isRegenerating={isRequestPending}
                messageText={messageText}
                onRegenerate={() => onRegenerate(message.id)}
              />
              <AgentRunInspector message={message} />
            </div>
          ) : null}
          {isUser ? (
            <MessageActions
              actions={USER_MESSAGE_ACTIONS}
              align="end"
              isRegenerating={isRequestPending}
              messageText={messageText}
              onEdit={() => onStartEditMessage(message)}
              onRegenerate={() => onRegenerate(message.id)}
            />
          ) : null}
        </div>
      </MessageRoot>
    )
  }
)
ChatMessageItem.displayName = "ChatMessageItem"

const ChatRuntime = ({
  activeArtifact,
  agentsEnabled,
  defaultPermissionMode,
  gitDiff,
  gitDiffScope,
  isLoadingFileItems,
  isLoadingPromptTemplateItems,
  isLoadingProjectTreeItems,
  isLoadingSkillItems,
  autoCompact,
  isProjectContextOpen,
  isProjectDiffLoading,
  mentionItems,
  mentionSkillItems,
  modelEffort,
  modelGroups,
  initialMessages,
  onChatFinish,
  onEffortChange,
  onGitDiffScopeChange,
  onMentionQueryChange,
  onModelChange,
  onOpenArtifact,
  onOpenSettings,
  onPromptTemplateQueryChange,
  onProjectContextOpenChange,
  onRefreshProjectContext,
  onSyncPersistedMessagesAfterFinish,
  onToggleProjectContext,
  onProjectContextViewChange,
  projectTreeItems,
  projectContextView,
  promptTemplateItems,
  selectedModelValue,
  selectedSession,
  sessionTitle,
  streamdownAnimation,
  transport
}: {
  activeArtifact: ChatArtifactRef | null
  agentsEnabled: boolean
  autoCompact?: { enabled: boolean; threshold: number }
  defaultPermissionMode: AgentPermissionMode
  gitDiff?: GitProjectDiffOutput
  gitDiffScope: ProjectChangesScope
  isLoadingFileItems: boolean
  isLoadingPromptTemplateItems: boolean
  isLoadingProjectTreeItems: boolean
  isLoadingSkillItems: boolean
  isProjectContextOpen: boolean
  isProjectDiffLoading: boolean
  initialMessages: ChatUiMessage[]
  mentionItems: ProjectSnapshotItem[]
  mentionSkillItems: PromptSkillMentionItem[]
  modelEffort: ModelEffortSettings
  modelGroups: ChatModelGroup[]
  onChatFinish: () => void
  onEffortChange: (
    provider: EffortProviderId,
    level: AnthropicEffortLevel | OpenAiEffortLevel
  ) => void
  onGitDiffScopeChange: (scope: ProjectChangesScope) => void
  onMentionQueryChange: (
    query: string | null,
    trigger: PromptMentionTrigger | null
  ) => void
  onModelChange: (value: string | null) => void
  onOpenArtifact: (artifact: ChatArtifactRef) => void
  onOpenSettings: () => void
  onPromptTemplateQueryChange: (query: string | null) => void
  onProjectContextOpenChange: (isOpen: boolean) => void
  onRefreshProjectContext: () => void
  onSyncPersistedMessagesAfterFinish: () => Promise<ChatUiMessage[]>
  onToggleProjectContext: () => void
  onProjectContextViewChange: (view: ProjectContextPanelView) => void
  projectTreeItems: ProjectSnapshotItem[]
  projectContextView: ChatSidePanelView
  promptTemplateItems: PromptTemplate[]
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  sessionTitle: string
  streamdownAnimation: StreamdownAnimation
  transport: DefaultChatTransport<ChatUiMessage>
}) => {
  const { t } = useI18n()
  const effortLevelLabels = useMemo(
    () => ({
      high: t("chat.model.effort.high"),
      low: t("chat.model.effort.low"),
      max: t("chat.model.effort.max"),
      medium: t("chat.model.effort.medium"),
      none: t("chat.model.effort.none"),
      xhigh: t("chat.model.effort.xhigh")
    }),
    [t]
  )
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingMessageText, setEditingMessageText] = useState("")
  const [requestPhase, setRequestPhase] = useState<ChatRequestPhase | null>(
    null
  )
  const [requestStartedAt, setRequestStartedAt] = useState<number | undefined>()
  const [agentMode, setAgentMode] = useState<ChatAgentMode>(() =>
    getChatAgentModeFromAgentsEnabled(agentsEnabled)
  )
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(
    defaultPermissionMode
  )
  const isSelectedModelImageCapable = useMemo(
    () => isSelectedModelImageOutput(modelGroups, selectedModelValue),
    [modelGroups, selectedModelValue]
  )
  const [isImageMode, setIsImageMode] = useState(isSelectedModelImageCapable)
  const previousImageCapableRef = useRef(isSelectedModelImageCapable)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<QueuedPromptMessage[]>(
    []
  )
  const queuedMessagesRef = useRef(queuedMessages)
  const {
    addToolApprovalResponse,
    clearError,
    error,
    messages,
    regenerate,
    sendMessage,
    setMessages,
    stop,
    status
  } = useChat<ChatUiMessage>({
    id: selectedSession.id,
    messages: initialMessages,
    onData: (dataPart) => {
      if (isChatRequestPhaseDataPart(dataPart)) {
        setRequestPhase(dataPart.data.phase)
      } else if (isChatWorkflowProgressDataPart(dataPart)) {
        setWorkflowProgress(dataPart.id, dataPart.data)
      } else if (isChatSubagentStartDataPart(dataPart)) {
        setSubagentStart(dataPart.data)
      } else if (isChatSubagentChunkDataPart(dataPart)) {
        applySubagentChunk(dataPart.data.childRunId, dataPart.data.chunk)
      } else if (isChatSubagentApprovalDataPart(dataPart)) {
        applySubagentApproval(dataPart.data)
      } else if (isChatSubagentEndDataPart(dataPart)) {
        setSubagentEnd(dataPart.data)
      }
    },
    onFinish: () => {
      setRequestPhase(null)
      clearWorkflowProgress()
      clearSubagents()

      if (agentMode === "agent") {
        void (async () => {
          try {
            setMessages(await onSyncPersistedMessagesAfterFinish())
          } catch {
            // Keep the live messages if persisted repair cannot be loaded.
          }
        })()
      }

      onChatFinish()
    },
    sendAutomaticallyWhen: shouldSendChatAutomatically,
    transport
  })

  useEffect(() => {
    setAgentMode(getChatAgentModeFromAgentsEnabled(agentsEnabled))
  }, [agentsEnabled, selectedSession.id])

  // Adopt the configured default when settings resolve after mount, and drop
  // any per-session escalation (e.g. bypass), queued follow-ups, and message
  // edits when switching sessions.
  useEffect(() => {
    setPermissionMode(defaultPermissionMode)
    setQueuedMessages([])
    setEditingMessageId(null)
    setEditingMessageText("")
  }, [defaultPermissionMode, selectedSession.id])

  // Re-derive the image toggle whenever the selected model changes: a newly
  // capable model defaults ON, a non-capable model forces OFF, and an unchanged
  // capability preserves the user's choice.
  useEffect(() => {
    setIsImageMode((previous) =>
      resolveImageModeForModelChange({
        isCapable: isSelectedModelImageCapable,
        previous,
        wasCapable: previousImageCapableRef.current
      })
    )
    previousImageCapableRef.current = isSelectedModelImageCapable
  }, [isSelectedModelImageCapable])

  // Auto-open the preview panel when a new artifact is published during a
  // turn. The first pass per session marks history as seen so reloading or
  // switching sessions never reopens old artifacts. (Generated images render
  // inline in the message, not here.)
  const seenArtifactsRef = useRef<{
    seenToolCallIds: Set<string>
    sessionId: string
  } | null>(null)

  useEffect(() => {
    const published = collectPublishedArtifactRefs(messages)
    const tracker = seenArtifactsRef.current

    if (!tracker || tracker.sessionId !== selectedSession.id) {
      seenArtifactsRef.current = {
        seenToolCallIds: new Set(
          published.map((artifact) => artifact.toolCallId)
        ),
        sessionId: selectedSession.id
      }
      return
    }

    let latestNewArtifact: ChatArtifactRef | null = null

    for (const artifact of published) {
      if (!tracker.seenToolCallIds.has(artifact.toolCallId)) {
        tracker.seenToolCallIds.add(artifact.toolCallId)
        latestNewArtifact = artifact
      }
    }

    if (latestNewArtifact) {
      onOpenArtifact(latestNewArtifact)
    }
  }, [messages, onOpenArtifact, selectedSession.id])

  const buildChatRequestOptions = useCallback(
    (mentions: ChatMention[], mode: ChatAgentMode = agentMode) => ({
      body: {
        agentMode: mode,
        imageMode: isImageMode || undefined,
        mentions,
        model: selectedModelValue || undefined,
        permissionMode,
        sessionId: selectedSession.id
      }
    }),
    [
      agentMode,
      isImageMode,
      permissionMode,
      selectedModelValue,
      selectedSession.id
    ]
  )

  const updateScrollToBottomVisibility = useCallback(
    (scrollElement: HTMLDivElement | null) => {
      if (!scrollElement) {
        setShowScrollToBottom(false)
        return
      }

      const distanceFromBottom =
        scrollElement.scrollHeight -
        scrollElement.scrollTop -
        scrollElement.clientHeight
      const canScroll =
        scrollElement.scrollHeight >
        scrollElement.clientHeight + MESSAGE_SCROLL_BOTTOM_THRESHOLD_PX

      setShowScrollToBottom(
        canScroll && distanceFromBottom > MESSAGE_SCROLL_BOTTOM_THRESHOLD_PX
      )
    },
    []
  )

  const isNearBottomRef = useRef(true)

  const handleMessagesScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight
      isNearBottomRef.current =
        distanceFromBottom <= MESSAGE_SCROLL_BOTTOM_THRESHOLD_PX
      updateScrollToBottomVisibility(el)
    },
    [updateScrollToBottomVisibility]
  )

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scrollElement = messagesScrollRef.current
    if (!scrollElement) {
      return
    }
    scrollElement.scrollTo({
      behavior,
      top: scrollElement.scrollHeight
    })
  }, [])

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
    setShowScrollToBottom(false)
  }, [scrollToBottom])

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom("instant")
    }
    updateScrollToBottomVisibility(messagesScrollRef.current)
  }, [messages, scrollToBottom, updateScrollToBottomVisibility])

  useEffect(() => {
    if (!editingMessageId) {
      return
    }

    const isEditingExistingUserMessage = messages.some(
      (message) => message.id === editingMessageId && message.role === "user"
    )

    if (!isEditingExistingUserMessage) {
      setEditingMessageId(null)
      setEditingMessageText("")
    }
  }, [editingMessageId, messages])

  const isRequestPending = status === "streaming" || status === "submitted"
  const isAgentModeToggleDisabled = getChatAgentModeToggleDisabled({
    isRequestPending
  })
  const handleAgentModeChange = useCallback(
    (nextMode: ChatAgentMode) => {
      if (isAgentModeToggleDisabled) {
        return
      }

      setAgentMode(nextMode)
    },
    [isAgentModeToggleDisabled]
  )
  const handleAgentModeToggle = useCallback(() => {
    if (isAgentModeToggleDisabled) {
      return
    }

    setAgentMode(getNextChatAgentMode)
  }, [isAgentModeToggleDisabled])
  // Mirrors PromptInputPermissionModeControl's interactivity: the permission pill
  // is hidden (and thus non-interactive) only in chat mode, where no tools run.
  const handlePermissionModeCycle = useCallback(() => {
    if (agentMode === "chat") {
      return
    }

    setPermissionMode(getNextPermissionMode)
  }, [agentMode])
  const isImageModeToggleDisabled = getImageModeToggleDisabled({
    isCapable: isSelectedModelImageCapable,
    isRequestPending
  })
  const handleImageModeToggle = useCallback(() => {
    if (isImageModeToggleDisabled) {
      return
    }

    setIsImageMode((previous) => !previous)
  }, [isImageModeToggleDisabled])

  // Mod+J reveals the terminal tab (opening the project panel if closed), and
  // toggles it closed when the terminal is already the visible tab — a VS Code-
  // style terminal toggle. The terminal focuses itself once it becomes visible.
  const handleToggleTerminal = useCallback(() => {
    if (
      isProjectContextOpen &&
      projectContextView === PROJECT_CONTEXT_TERMINAL_TAB_ID
    ) {
      onToggleProjectContext()
      return
    }

    onProjectContextViewChange(PROJECT_CONTEXT_TERMINAL_TAB_ID)
    onProjectContextOpenChange(true)
  }, [
    isProjectContextOpen,
    onProjectContextOpenChange,
    onProjectContextViewChange,
    onToggleProjectContext,
    projectContextView
  ])

  useHotkey("Shift+Tab", handlePermissionModeCycle, {
    enabled: agentMode !== "chat",
    ignoreInputs: false
  })
  useHotkey("Mod+Shift+Tab", handleAgentModeToggle, {
    enabled: !isAgentModeToggleDisabled,
    ignoreInputs: false
  })
  useHotkey("Mod+J", handleToggleTerminal, {
    ignoreInputs: false
  })

  const latestMessage = messages.at(-1)
  const latestAssistantMessageId = useMemo(
    () => messages.findLast((message) => message.role === "assistant")?.id,
    [messages]
  )
  const shouldShowAssistantLiveStatus =
    isRequestPending && !hasRenderableAssistantContent(latestMessage)
  const isAwaitingToolApproval = useMemo(
    () => hasPendingToolApproval(latestMessage),
    [latestMessage]
  )
  // The turn is fully settled only when nothing else is in flight: not pending,
  // no error, not awaiting an approval, and the SDK is not about to auto-resend
  // a tool result. Queued follow-ups drain on the edge into this state.
  const isQueueDrainReady =
    !isRequestPending &&
    !error &&
    !isAwaitingToolApproval &&
    !shouldSendChatAutomatically({ messages })

  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      setRequestStartedAt((currentValue) => currentValue ?? Date.now())
      return
    }

    setRequestPhase(null)
    setRequestStartedAt(undefined)
  }, [status])
  const latestUserMentions = useMemo(() => {
    for (const message of messages.toReversed()) {
      if (message.role === "user") {
        return message.metadata?.mentions ?? []
      }
    }

    return []
  }, [messages])

  const contextUsagePercent = useMemo(
    () => estimateChatContextUsagePercent(messages),
    [messages]
  )
  const contextUsageSegments = useMemo(
    () => getChatContextUsageSegments(messages),
    [messages]
  )

  // Best-effort: persist an exact-command allowlist entry so the main-process
  // needsApproval gate skips this command next time. A failed write must never
  // block the approval itself, so it is fire-and-forget with a swallowed error.
  const rememberCommandApproval = useCallback(
    async (part: ChatToolPart) => {
      const command = getToolInputCommand(part.input).trim()

      if (!command) {
        return
      }

      const rule = {
        command,
        createdAt: new Date().toISOString(),
        projectPath: selectedSession.projectPath,
        toolName: getToolName(part as never)
      }

      try {
        const settings = await rpcClient.settings.get()

        await rpcClient.settings.update({
          agents: {
            ...settings.agents,
            approvals: {
              ...settings.agents.approvals,
              commandAllowlist: upsertCommandApprovalRule(
                settings.agents.approvals.commandAllowlist,
                rule
              )
            }
          }
        })
      } catch {
        // Swallow: remembering is a convenience, not a precondition to approve.
      }
    },
    [selectedSession.projectPath]
  )

  const handleToolApprovalResponse = useCallback(
    (
      part: ChatToolPart,
      approved: boolean,
      options?: AssistantToolApprovalResponseOptions
    ) => {
      respondToAssistantToolApproval({
        addToolApprovalResponse,
        approved,
        buildChatRequestOptions,
        latestUserMentions,
        onRememberCommand:
          approved && options?.rememberCommand
            ? () => {
                void rememberCommandApproval(part)
              }
            : undefined,
        part: part as never
      })
    },
    [
      addToolApprovalResponse,
      buildChatRequestOptions,
      latestUserMentions,
      rememberCommandApproval
    ]
  )

  const sendPromptMessage = useCallback(
    ({ mentions, text }: { mentions: ChatMention[]; text: string }): void => {
      void sendMessage(
        {
          metadata: mentions.length > 0 ? { mentions } : undefined,
          text
        },
        buildChatRequestOptions(mentions)
      )
    },
    [buildChatRequestOptions, sendMessage]
  )

  const handleSubmit = useCallback(
    ({
      mentions,
      text
    }: {
      mentions: ChatMention[]
      text: string
    }): Promise<void> => {
      // While a run is in flight — or parked on a pending tool approval, which
      // reports status "ready" — hold the message in the queue instead of
      // sending; it drains automatically once the turn fully settles.
      if (isRequestPending || isAwaitingToolApproval) {
        setQueuedMessages((currentMessages) => [
          ...currentMessages,
          { id: crypto.randomUUID(), mentions, text }
        ])

        return Promise.resolve()
      }

      sendPromptMessage({ mentions, text })

      return Promise.resolve()
    },
    [isAwaitingToolApproval, isRequestPending, sendPromptMessage]
  )

  const handleQueuedMessagesReorder = useCallback(
    (nextMessages: QueuedPromptMessage[]) => {
      setQueuedMessages(nextMessages)
    },
    []
  )

  const handleRemoveQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((currentMessages) =>
      currentMessages.filter((message) => message.id !== id)
    )
  }, [])

  // Keep a ref of the queue so the drain effect can read the latest items
  // without re-running on every queue mutation.
  useEffect(() => {
    queuedMessagesRef.current = queuedMessages
  }, [queuedMessages])

  const wasQueueDrainReadyRef = useRef(isQueueDrainReady)
  useEffect(() => {
    const wasReady = wasQueueDrainReadyRef.current
    wasQueueDrainReadyRef.current = isQueueDrainReady

    // Drain on the rising edge into the settled state, one message per turn, so
    // each queued follow-up runs as its own request.
    if (wasReady || !isQueueDrainReady) {
      return
    }

    const [nextMessage, ...remainingMessages] = queuedMessagesRef.current

    if (!nextMessage) {
      return
    }

    setQueuedMessages(remainingMessages)
    sendPromptMessage(nextMessage)
  }, [isQueueDrainReady, sendPromptMessage])

  const getMessageRegenerateMentions = useCallback(
    (messageId?: string): ChatMention[] => {
      if (!messageId) {
        return latestUserMentions
      }

      const messageIndex = messages.findIndex(
        (message) => message.id === messageId
      )

      if (messageIndex === -1) {
        return latestUserMentions
      }

      for (let index = messageIndex; index >= 0; index -= 1) {
        const candidateMessage = messages[index]

        if (candidateMessage?.role === "user") {
          return candidateMessage.metadata?.mentions ?? []
        }
      }

      return []
    },
    [latestUserMentions, messages]
  )

  const handleRegenerate = useCallback(
    (messageId?: string) => {
      clearError()
      setEditingMessageId(null)
      setEditingMessageText("")
      void regenerate({
        messageId,
        ...buildChatRequestOptions(getMessageRegenerateMentions(messageId))
      })
    },
    [
      buildChatRequestOptions,
      clearError,
      getMessageRegenerateMentions,
      regenerate
    ]
  )
  const handleStartEditMessage = useCallback((message: ChatUiMessage) => {
    setEditingMessageId(message.id)
    setEditingMessageText(getMessageText(message))
  }, [])

  const handleCancelEditMessage = useCallback(() => {
    setEditingMessageId(null)
    setEditingMessageText("")
  }, [])

  const handleStop = useCallback(() => {
    // Stopping halts the turn and discards queued follow-ups so they don't
    // auto-send after the interrupt.
    setQueuedMessages([])
    void stop()
  }, [stop])

  const handleSubmitEditedMessage = useCallback(
    (message: ChatUiMessage) => {
      const normalizedText = editingMessageText.trim()

      if (message.role !== "user" || !normalizedText || isRequestPending) {
        return
      }

      clearError()
      setEditingMessageId(null)
      setEditingMessageText("")
      void sendMessage(
        {
          messageId: message.id,
          metadata: message.metadata,
          text: normalizedText
        },
        buildChatRequestOptions(message.metadata?.mentions ?? [])
      )
    },
    [
      buildChatRequestOptions,
      clearError,
      editingMessageText,
      isRequestPending,
      sendMessage
    ]
  )

  const selectedModelContextWindow = modelGroups
    .flatMap((group) => group.options)
    .find((option) => option.value === selectedModelValue)
    ?.capabilities?.contextWindow
  const contextWindowLabel = formatContextWindowLabel(
    selectedModelContextWindow
  )
  const contextUsageSegmentLabel: Record<
    ChatContextUsageSegment["key"],
    string
  > = {
    assistant: t("chat.composer.contextUsageAssistantMessages"),
    user: t("chat.composer.contextUsageUserMessages")
  }
  const contextUsageTotalCharacters = contextUsageSegments.reduce(
    (sum, segment) => sum + segment.characters,
    0
  )
  const contextUsage = {
    ariaLabel: t("chat.composer.contextUsageAriaLabel", {
      percent: contextUsagePercent
    }),
    hintLabel: t("chat.composer.contextUsageHint"),
    percent: contextUsagePercent,
    remainingLabel: t("chat.composer.contextUsageRemaining"),
    segments: contextUsageSegments.map((segment) => ({
      key: segment.key,
      label: contextUsageSegmentLabel[segment.key],
      percent:
        contextUsageTotalCharacters > 0
          ? (segment.characters / contextUsageTotalCharacters) *
            contextUsagePercent
          : 0,
      valueLabel: formatContextWindowLabel(segment.characters) ?? "0"
    })),
    summaryLabel: t("chat.composer.contextUsageUsed", {
      percent: contextUsagePercent
    }),
    threshold: autoCompact?.enabled ? autoCompact.threshold : undefined,
    thresholdFootnote: autoCompact?.enabled
      ? t("chat.composer.contextUsageAutoCompact", {
          threshold: autoCompact.threshold
        })
      : undefined,
    title: t("chat.composer.contextUsageTitle"),
    windowFootnote: contextWindowLabel
      ? t("chat.composer.contextUsageModelWindow", {
          window: contextWindowLabel
        })
      : undefined
  }

  return (
    <ChatProjectContextLayout
      activeArtifact={activeArtifact}
      gitDiff={gitDiff}
      gitDiffScope={gitDiffScope}
      isDiffLoading={isProjectDiffLoading}
      isOpen={isProjectContextOpen}
      isTreeLoading={isLoadingProjectTreeItems}
      onOpenChange={onProjectContextOpenChange}
      onGitDiffScopeChange={onGitDiffScopeChange}
      onRefresh={onRefreshProjectContext}
      onViewChange={onProjectContextViewChange}
      projectItems={projectTreeItems}
      selectedSession={selectedSession}
      selectedView={projectContextView}
    >
      <div className="flex h-svh min-h-0 flex-col gap-6 overflow-hidden p-6">
        <ChatSessionHeader
          gitDiff={gitDiff}
          isProjectContextOpen={isProjectContextOpen}
          onToggleProjectContext={onToggleProjectContext}
          selectedSession={selectedSession}
          sessionTitle={sessionTitle}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
            <ScrollShadow
              className="h-full py-5 pr-2.5"
              onScroll={handleMessagesScroll}
              ref={messagesScrollRef}
            >
              {messages.length === 0 && !error ? (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-md text-center">
                    <h2 className="text-lg font-semibold">
                      {t("chat.placeholder.title")}
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {t("chat.placeholder.description")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => {
                    const isEmptyLatestAssistant =
                      shouldShowAssistantLiveStatus &&
                      message.id === latestMessage?.id &&
                      message.role === "assistant"
                    if (isEmptyLatestAssistant) {
                      return null
                    }

                    return (
                      <ChatMessageItem
                        editingMessageId={editingMessageId}
                        editingMessageText={editingMessageText}
                        isLatestAssistantMessage={
                          message.role === "assistant" &&
                          message.id === latestAssistantMessageId
                        }
                        isRequestPending={isRequestPending}
                        key={message.id}
                        liveWorkTimeStartedAt={requestStartedAt}
                        message={message}
                        onApprovalResponse={handleToolApprovalResponse}
                        onCancelEditMessage={handleCancelEditMessage}
                        onEditingMessageTextChange={setEditingMessageText}
                        onOpenArtifact={onOpenArtifact}
                        onRegenerate={handleRegenerate}
                        onStartEditMessage={handleStartEditMessage}
                        onSubmitEditedMessage={handleSubmitEditedMessage}
                        sessionId={selectedSession.id}
                        streamdownAnimation={streamdownAnimation}
                      />
                    )
                  })}
                  {shouldShowAssistantLiveStatus ? (
                    <AssistantLiveStatus
                      latestMessage={latestMessage}
                      requestPhase={requestPhase}
                      requestStartedAt={requestStartedAt}
                      status={
                        status === "streaming" ? "streaming" : "submitted"
                      }
                    />
                  ) : null}
                  {error && (
                    <ChatErrorActionBar
                      errorMessage={error.message}
                      isRegenerating={isRequestPending}
                      onDismiss={clearError}
                      onRegenerate={handleRegenerate}
                    />
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollShadow>

            {showScrollToBottom ? (
              <Button
                aria-label={t("chat.messageScroll.toBottom")}
                className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-md"
                isIconOnly
                onPress={handleScrollToBottom}
                size="sm"
                type="button"
                variant="secondary"
              >
                <HugeiconsIcon
                  icon={ArrowDown02Icon}
                  size={16}
                  strokeWidth={2}
                />
              </Button>
            ) : null}
          </div>

          <PromptInput
            agentMode={agentMode}
            agentModeAgentLabel={t("chat.composer.agentModeAgent")}
            agentModeChatLabel={t("chat.composer.agentModeChat")}
            agentModePlanLabel={t("chat.composer.agentModePlan")}
            agentModeToggleLabel={t("chat.composer.agentModeToggle")}
            commandPaletteEmptyLabel={t("chat.mentions.commandPaletteEmpty")}
            commandPaletteGroupLabel={t("chat.mentions.commandPaletteGroup")}
            commandPaletteImagenDescription={t(
              "chat.mentions.commandImagenDescription"
            )}
            commandPaletteImagenLabel={t("chat.mentions.commandImagenLabel")}
            commandPalettePlanDescription={t(
              "chat.mentions.commandPlanDescription"
            )}
            commandPalettePlanLabel={t("chat.mentions.commandPlanLabel")}
            commandPalettePromptDescription={t(
              "chat.mentions.commandPromptDescription"
            )}
            commandPalettePromptLabel={t("chat.mentions.commandPromptLabel")}
            commandPaletteSkillDescription={t(
              "chat.mentions.commandSkillDescription"
            )}
            commandPaletteSkillLabel={t("chat.mentions.commandSkillLabel")}
            commandPaletteWorkflowDescription={t(
              "chat.mentions.commandWorkflowDescription"
            )}
            commandPaletteWorkflowLabel={t(
              "chat.mentions.commandWorkflowLabel"
            )}
            footer={
              <div className="flex items-center gap-3">
                <ModelSelector
                  effortLabel={t("chat.model.effortLabel")}
                  effortLevelLabels={effortLevelLabels}
                  emptyActionLabel={t("chat.model.emptyAction")}
                  emptyLabel={t("chat.model.emptyDescription")}
                  groups={modelGroups}
                  modelEffort={modelEffort}
                  onEffortChange={onEffortChange}
                  onOpenSettings={onOpenSettings}
                  onValueChange={onModelChange}
                  searchEmptyLabel={t("chat.model.searchEmpty")}
                  searchPlaceholder={t("chat.model.searchPlaceholder")}
                  value={selectedModelValue}
                />
                <ComposerImageModeControl
                  isDisabled={isImageModeToggleDisabled}
                  isSelected={isImageMode}
                  label={t("chat.imageMode.label")}
                  onPress={handleImageModeToggle}
                  tooltip={t("chat.imageMode.tooltip")}
                  unsupportedLabel={t("chat.imageMode.unsupported")}
                />
              </div>
            }
            isAgentModeToggleDisabled={isAgentModeToggleDisabled}
            isLoadingFileItems={isLoadingFileItems}
            isLoadingPromptTemplateItems={isLoadingPromptTemplateItems}
            isLoadingSkillItems={isLoadingSkillItems}
            mentionEmptyLabel={t("chat.mentions.empty")}
            mentionFileGroupLabel={t("chat.mentions.filesGroup")}
            mentionFolderGroupLabel={t("chat.mentions.foldersGroup")}
            mentionGlobalSkillSourceLabel={t("chat.mentions.globalSkillSource")}
            mentionItems={mentionItems}
            mentionSkillEmptyLabel={t("chat.mentions.skillsEmpty")}
            mentionSkillGroupLabel={t("chat.mentions.skillsGroup")}
            mentionSkillItems={mentionSkillItems}
            mentionSkillSearchPlaceholder={t(
              "chat.mentions.skillsSearchPlaceholder"
            )}
            contextUsage={contextUsage}
            isOutputActive={isRequestPending}
            onAgentModeChange={handleAgentModeChange}
            onMentionQueryChange={onMentionQueryChange}
            onPermissionModeChange={setPermissionMode}
            onPromptTemplateQueryChange={onPromptTemplateQueryChange}
            onQueuedMessagesReorder={handleQueuedMessagesReorder}
            onRemoveQueuedMessage={handleRemoveQueuedMessage}
            onStop={handleStop}
            onSubmit={handleSubmit}
            permissionMode={permissionMode}
            permissionModeAcceptEditsLabel={t(
              "chat.promptInput.permissionMode.acceptEdits"
            )}
            permissionModeBypassLabel={t(
              "chat.promptInput.permissionMode.bypass"
            )}
            permissionModeDefaultLabel={t(
              "chat.promptInput.permissionMode.default"
            )}
            permissionModeToggleLabel={t(
              "chat.promptInput.permissionMode.title"
            )}
            placeholder={t("chat.composer.placeholder")}
            promptTemplateEmptyLabel={t("chat.mentions.promptTemplatesEmpty")}
            promptTemplateGroupLabel={t("chat.mentions.promptTemplatesGroup")}
            promptTemplateItems={promptTemplateItems}
            queuedMessages={queuedMessages}
            queuedMessagesLabel={t("chat.composer.queuedMessages")}
            queueEditLabel={t("chat.composer.queueEdit")}
            queueRemoveLabel={t("chat.composer.queueRemove")}
            queueReorderLabel={t("chat.composer.queueReorder")}
            status={status}
            stopLabel={t("chat.composer.stop")}
            submitLabel={t("chat.composer.send")}
          />
        </div>
      </div>
    </ChatProjectContextLayout>
  )
}

const ChatPendingState = ({
  gitDiff,
  gitDiffScope,
  isLoadingFileItems,
  isLoadingPromptTemplateItems,
  isLoadingProjectTreeItems,
  isLoadingSkillItems,
  isProjectContextOpen,
  isProjectDiffLoading,
  modelEffort,
  modelGroups,
  onEffortChange,
  onGitDiffScopeChange,
  onMentionQueryChange,
  onModelChange,
  onOpenSettings,
  onPromptTemplateQueryChange,
  onProjectContextOpenChange,
  onRefreshProjectContext,
  onToggleProjectContext,
  onProjectContextViewChange,
  projectTreeItems,
  projectContextView,
  promptTemplateItems,
  selectedModelValue,
  selectedSession,
  sessionTitle
}: {
  gitDiff?: GitProjectDiffOutput
  gitDiffScope: ProjectChangesScope
  isLoadingFileItems: boolean
  isLoadingPromptTemplateItems: boolean
  isLoadingProjectTreeItems: boolean
  isLoadingSkillItems: boolean
  isProjectContextOpen: boolean
  isProjectDiffLoading: boolean
  modelEffort: ModelEffortSettings
  modelGroups: ChatModelGroup[]
  onEffortChange: (
    provider: EffortProviderId,
    level: AnthropicEffortLevel | OpenAiEffortLevel
  ) => void
  onGitDiffScopeChange: (scope: ProjectChangesScope) => void
  onMentionQueryChange: (
    query: string | null,
    trigger: PromptMentionTrigger | null
  ) => void
  onModelChange: (value: string | null) => void
  onOpenSettings: () => void
  onPromptTemplateQueryChange: (query: string | null) => void
  onProjectContextOpenChange: (isOpen: boolean) => void
  onRefreshProjectContext: () => void
  onToggleProjectContext: () => void
  onProjectContextViewChange: (view: ProjectContextPanelView) => void
  projectTreeItems: ProjectSnapshotItem[]
  projectContextView: ChatSidePanelView
  promptTemplateItems: PromptTemplate[]
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  sessionTitle: string
}) => {
  const { t } = useI18n()
  const effortLevelLabels = useMemo(
    () => ({
      high: t("chat.model.effort.high"),
      low: t("chat.model.effort.low"),
      max: t("chat.model.effort.max"),
      medium: t("chat.model.effort.medium"),
      none: t("chat.model.effort.none"),
      xhigh: t("chat.model.effort.xhigh")
    }),
    [t]
  )

  return (
    <ChatProjectContextLayout
      gitDiff={gitDiff}
      gitDiffScope={gitDiffScope}
      isDiffLoading={isProjectDiffLoading}
      isOpen={isProjectContextOpen}
      isTreeLoading={isLoadingProjectTreeItems}
      onOpenChange={onProjectContextOpenChange}
      onGitDiffScopeChange={onGitDiffScopeChange}
      onRefresh={onRefreshProjectContext}
      onViewChange={onProjectContextViewChange}
      projectItems={projectTreeItems}
      selectedSession={selectedSession}
      selectedView={projectContextView}
    >
      <div className="flex h-svh min-h-0 flex-col gap-6 overflow-hidden p-6">
        <ChatSessionHeader
          gitDiff={gitDiff}
          isProjectContextOpen={isProjectContextOpen}
          onToggleProjectContext={onToggleProjectContext}
          selectedSession={selectedSession}
          sessionTitle={sessionTitle}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ScrollShadow className="flex min-h-0 flex-1 items-center justify-center py-5">
            <div className="max-w-md text-center">
              <h2 className="text-lg font-semibold">{t("chat.loading")}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {t("chat.placeholder.description")}
              </p>
            </div>
          </ScrollShadow>

          <PromptInput
            agentMode="chat"
            agentModeAgentLabel={t("chat.composer.agentModeAgent")}
            agentModeChatLabel={t("chat.composer.agentModeChat")}
            agentModePlanLabel={t("chat.composer.agentModePlan")}
            agentModeToggleLabel={t("chat.composer.agentModeToggle")}
            commandPaletteEmptyLabel={t("chat.mentions.commandPaletteEmpty")}
            commandPaletteGroupLabel={t("chat.mentions.commandPaletteGroup")}
            commandPaletteImagenDescription={t(
              "chat.mentions.commandImagenDescription"
            )}
            commandPaletteImagenLabel={t("chat.mentions.commandImagenLabel")}
            commandPalettePlanDescription={t(
              "chat.mentions.commandPlanDescription"
            )}
            commandPalettePlanLabel={t("chat.mentions.commandPlanLabel")}
            commandPalettePromptDescription={t(
              "chat.mentions.commandPromptDescription"
            )}
            commandPalettePromptLabel={t("chat.mentions.commandPromptLabel")}
            commandPaletteSkillDescription={t(
              "chat.mentions.commandSkillDescription"
            )}
            commandPaletteSkillLabel={t("chat.mentions.commandSkillLabel")}
            commandPaletteWorkflowDescription={t(
              "chat.mentions.commandWorkflowDescription"
            )}
            commandPaletteWorkflowLabel={t(
              "chat.mentions.commandWorkflowLabel"
            )}
            disabled
            footer={
              <div className="flex items-center gap-3">
                <ModelSelector
                  disabled
                  effortLabel={t("chat.model.effortLabel")}
                  effortLevelLabels={effortLevelLabels}
                  emptyActionLabel={t("chat.model.emptyAction")}
                  emptyLabel={t("chat.model.emptyDescription")}
                  groups={modelGroups}
                  modelEffort={modelEffort}
                  onEffortChange={onEffortChange}
                  onOpenSettings={onOpenSettings}
                  onValueChange={onModelChange}
                  searchEmptyLabel={t("chat.model.searchEmpty")}
                  searchPlaceholder={t("chat.model.searchPlaceholder")}
                  value={selectedModelValue}
                />
                <ComposerImageModeControl
                  isDisabled
                  isSelected={false}
                  label={t("chat.imageMode.label")}
                  onPress={NOOP_IMAGE_MODE_TOGGLE}
                  tooltip={t("chat.imageMode.tooltip")}
                  unsupportedLabel={t("chat.imageMode.unsupported")}
                />
              </div>
            }
            isLoadingFileItems={isLoadingFileItems}
            isLoadingPromptTemplateItems={isLoadingPromptTemplateItems}
            isLoadingSkillItems={isLoadingSkillItems}
            mentionEmptyLabel={t("chat.mentions.empty")}
            mentionFileGroupLabel={t("chat.mentions.filesGroup")}
            mentionFolderGroupLabel={t("chat.mentions.foldersGroup")}
            mentionGlobalSkillSourceLabel={t("chat.mentions.globalSkillSource")}
            mentionItems={[]}
            mentionSkillEmptyLabel={t("chat.mentions.skillsEmpty")}
            mentionSkillGroupLabel={t("chat.mentions.skillsGroup")}
            mentionSkillItems={[]}
            mentionSkillSearchPlaceholder={t(
              "chat.mentions.skillsSearchPlaceholder"
            )}
            onAgentModeChange={NOOP_AGENT_MODE_CHANGE}
            onMentionQueryChange={onMentionQueryChange}
            onPermissionModeChange={NOOP_PERMISSION_MODE_CHANGE}
            onPromptTemplateQueryChange={onPromptTemplateQueryChange}
            onSubmit={NOOP_PROMPT_SUBMIT}
            permissionMode="default"
            permissionModeAcceptEditsLabel={t(
              "chat.promptInput.permissionMode.acceptEdits"
            )}
            permissionModeBypassLabel={t(
              "chat.promptInput.permissionMode.bypass"
            )}
            permissionModeDefaultLabel={t(
              "chat.promptInput.permissionMode.default"
            )}
            permissionModeToggleLabel={t(
              "chat.promptInput.permissionMode.title"
            )}
            placeholder={t("chat.composer.placeholder")}
            promptTemplateEmptyLabel={t("chat.mentions.promptTemplatesEmpty")}
            promptTemplateGroupLabel={t("chat.mentions.promptTemplatesGroup")}
            promptTemplateItems={promptTemplateItems}
            stopLabel={t("chat.composer.stop")}
            submitLabel={t("chat.composer.send")}
          />
        </div>
      </div>
    </ChatProjectContextLayout>
  )
}

const ChatSessionPage = () => {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sessionId } = Route.useParams()
  const [isProjectContextOpen, setProjectContextOpen] = useState(false)
  const [projectContextView, setProjectContextView] =
    useState<ChatSidePanelView>(PROJECT_CONTEXT_FILES_TAB_ID)
  const [gitDiffScope, setGitDiffScope] = useState<ProjectChangesScope>(
    PROJECT_CHANGES_SCOPE_AGENT
  )
  const [activeArtifact, setActiveArtifact] = useState<ChatArtifactRef | null>(
    null
  )
  const [transport, setTransport] =
    useState<DefaultChatTransport<ChatUiMessage> | null>(null)
  const chatSessionsQuery = useQuery({
    ...chatSessionsQueryOptions,
    refetchInterval: CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
  })
  const chatSessionMessagesQueryOptions = useMemo(
    () => getChatSessionMessagesQueryOptions(sessionId),
    [sessionId]
  )
  const projectTreeItemsQueryOptions = useMemo(
    () =>
      orpc.projectSnapshots.listFiles.queryOptions({
        input: {
          limit: PROJECT_TREE_ITEM_LIMIT,
          query: "",
          sessionId
        }
      }),
    [sessionId]
  )
  const snapshotStateQueryOptions = useMemo(
    () =>
      orpc.projectSnapshots.ensure.queryOptions({
        input: {
          sessionId
        }
      }),
    [sessionId]
  )
  const settingsQuery = useQuery(settingsQueryOptions)
  const session = useMemo(
    () => chatSessionsQuery.data?.find((item) => item.id === sessionId),
    [chatSessionsQuery.data, sessionId]
  )
  const agentEditedPaths = useMemo(
    () => session?.agentEditedPaths ?? [],
    [session]
  )
  const gitDiffQueryOptions = useMemo(
    () =>
      orpc.git.diff.queryOptions({
        input: getProjectGitDiffInput({
          agentEditedPaths,
          scope: gitDiffScope,
          sessionId
        })
      }),
    [agentEditedPaths, gitDiffScope, sessionId]
  )
  const sessionExists = Boolean(session)
  const persistedMessagesQuery = useQuery({
    ...chatSessionMessagesQueryOptions,
    enabled: sessionExists
  })
  const _snapshotStateQuery = useQuery({
    ...snapshotStateQueryOptions,
    enabled: sessionExists
  })
  const {
    handleMentionQueryChange,
    handlePromptTemplateQueryChange,
    isLoadingFileItems,
    isLoadingPromptTemplateItems,
    isLoadingSkillItems,
    mentionItems,
    mentionSkillItems,
    promptTemplateItems
  } = useChatMentionSuggestions({
    selectedSession: session,
    sessionExists,
    sessionId
  })
  const gitDiffQuery = useQuery({
    ...gitDiffQueryOptions,
    enabled:
      sessionExists &&
      shouldFetchProjectGitDiff({ agentEditedPaths, scope: gitDiffScope }),
    refetchInterval: CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
  })
  const projectTreeItemsQuery = useQuery({
    ...projectTreeItemsQueryOptions,
    enabled: sessionExists
  })
  const modelGroups = useMemo(
    () =>
      settingsQuery.data ? buildChatModelGroups(settingsQuery.data.ai) : [],
    [settingsQuery.data]
  )
  const selectedModelValue = useMemo(
    () =>
      settingsQuery.data && session
        ? resolveChatModelValue({
            defaultModel: settingsQuery.data.ai.defaultModel,
            groups: modelGroups,
            sessionModelId: session.modelId
          })
        : "",
    [modelGroups, session, settingsQuery.data]
  )
  const modelEffort = settingsQuery.data?.ai.modelEffort ?? DEFAULT_MODEL_EFFORT
  // Optimistic model switch: the selector stays enabled during the persistence
  // window, so rapid re-switches are last-write-wins over local IPC (which
  // serializes in practice). No ordering guards needed.
  const setModelMutation = useMutation({
    mutationFn: async (modelId: string | null) => {
      const nextSession = await rpcClient.chatSessions.setModel({
        modelId,
        sessionId
      })
      const shouldPersistDefaultModel =
        Boolean(modelId) && settingsQuery.data?.ai.defaultModel !== modelId
      const nextSettings =
        modelId && shouldPersistDefaultModel && settingsQuery.data
          ? await rpcClient.settings.update({
              ai: buildAiSettingsWithDefaultModel(
                settingsQuery.data.ai,
                modelId
              )
            })
          : null

      return {
        nextSession,
        nextSettings
      }
    },
    onMutate: async (modelId) => {
      // The sessions list refetches on an interval; cancel in-flight reads so a
      // refetch of pre-commit DB state can't clobber the optimistic value.
      await queryClient.cancelQueries({
        queryKey: chatSessionsQueryOptions.queryKey
      })
      await queryClient.cancelQueries({
        queryKey: settingsQueryOptions.queryKey
      })

      const previousSessions = queryClient.getQueryData<
        ChatSessionSummary[] | undefined
      >(chatSessionsQueryOptions.queryKey)
      const previousSettings = queryClient.getQueryData(
        settingsQueryOptions.queryKey
      )

      if (session) {
        queryClient.setQueryData(
          chatSessionsQueryOptions.queryKey,
          upsertChatSession({
            nextSession: { ...session, modelId },
            sessions: previousSessions
          })
        )
      }

      const shouldPersistDefaultModel =
        Boolean(modelId) && previousSettings?.ai.defaultModel !== modelId

      if (modelId && shouldPersistDefaultModel && previousSettings) {
        queryClient.setQueryData(settingsQueryOptions.queryKey, {
          ...previousSettings,
          ai: buildAiSettingsWithDefaultModel(previousSettings.ai, modelId)
        })
      }

      return { previousSessions, previousSettings }
    },
    onError: (_error, _modelId, context) => {
      if (!context) {
        return
      }

      queryClient.setQueryData(
        chatSessionsQueryOptions.queryKey,
        context.previousSessions
      )
      queryClient.setQueryData(
        settingsQueryOptions.queryKey,
        context.previousSettings
      )
    },
    onSuccess: ({ nextSession, nextSettings }) => {
      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryOptions.queryKey,
        (sessions) =>
          upsertChatSession({
            nextSession,
            sessions
          })
      )

      if (nextSettings) {
        queryClient.setQueryData(settingsQueryOptions.queryKey, nextSettings)
      }
    }
  })
  const setEffortMutation = useMutation({
    mutationFn: async (next: ModelEffortSettings) => {
      if (!settingsQuery.data) {
        return null
      }

      const nextSettings = await rpcClient.settings.update({
        ai: { ...settingsQuery.data.ai, modelEffort: next }
      })

      return nextSettings
    },
    onSuccess: (nextSettings) => {
      if (nextSettings) {
        queryClient.setQueryData(settingsQueryOptions.queryKey, nextSettings)
      }
    }
  })
  const persistedMessages = useMemo(
    () =>
      (persistedMessagesQuery.data?.messages ?? []).map(toRuntimeChatMessage),
    [persistedMessagesQuery.data?.messages]
  )

  useEffect(() => {
    let disposed = false

    const prepareTransport = async (): Promise<void> => {
      const nextTransport = await getChatTransport<ChatUiMessage>()

      if (!disposed) {
        setTransport(nextTransport)
      }
    }

    prepareTransport()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    let disposed = false

    const syncLastOpenedAt = async (): Promise<void> => {
      if (!chatSessionsQuery.isSuccess || !sessionExists) {
        return
      }

      const openedSession = await rpcClient.chatSessions.open({ sessionId })

      if (disposed) {
        return
      }

      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryOptions.queryKey,
        (previousSessions) =>
          upsertChatSession({
            nextSession: openedSession,
            sessions: previousSessions
          })
      )
    }

    const syncLastOpenedAtSafely = async (): Promise<void> => {
      try {
        await syncLastOpenedAt()
      } catch {
        // Ignore stale open failures and let the route fall back to its empty state.
      }
    }

    syncLastOpenedAtSafely()

    return () => {
      disposed = true
    }
  }, [chatSessionsQuery.isSuccess, queryClient, sessionExists, sessionId])

  const handleChatFinish = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: chatSessionsQueryOptions.queryKey
    })
    void queryClient.invalidateQueries({
      queryKey: chatSessionMessagesQueryOptions.queryKey
    })
  }, [chatSessionMessagesQueryOptions.queryKey, queryClient])

  const handleModelChange = useCallback(
    (nextValue: string | null) => {
      setModelMutation.mutate(nextValue)
    },
    [setModelMutation]
  )
  const handleEffortChange = useCallback(
    (
      provider: EffortProviderId,
      level: AnthropicEffortLevel | OpenAiEffortLevel
    ) => {
      setEffortMutation.mutate({ ...modelEffort, [provider]: level })
    },
    [modelEffort, setEffortMutation]
  )

  const handleOpenSettings = useCallback(() => {
    navigate({ to: "/settings" })
  }, [navigate])
  const handleProjectContextOpenChange = useCallback((isOpen: boolean) => {
    setProjectContextOpen(isOpen)
  }, [])
  const handleGitDiffScopeChange = useCallback((scope: ProjectChangesScope) => {
    setGitDiffScope(scope)
  }, [])
  const handleRefreshProjectContext = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: chatSessionsQueryOptions.queryKey
    })
    void queryClient.invalidateQueries({
      queryKey: gitDiffQueryOptions.queryKey
    })
    void queryClient.invalidateQueries({
      queryKey: projectTreeItemsQueryOptions.queryKey
    })
    void queryClient.invalidateQueries({
      queryKey: snapshotStateQueryOptions.queryKey
    })
  }, [
    gitDiffQueryOptions.queryKey,
    projectTreeItemsQueryOptions.queryKey,
    queryClient,
    snapshotStateQueryOptions.queryKey
  ])
  const handleToggleProjectContext = useCallback(() => {
    setProjectContextOpen((currentValue) => !currentValue)
  }, [])
  const handleProjectContextViewChange = useCallback(
    (view: ProjectContextPanelView) => {
      setProjectContextView(view)
    },
    []
  )
  const handleOpenArtifact = useCallback((artifact: ChatArtifactRef) => {
    setActiveArtifact(artifact)
    setProjectContextView(ARTIFACT_PANEL_VIEW_ID)
    setProjectContextOpen(true)
  }, [])

  // Artifact paths are project-relative, so a session switch drops the active
  // artifact instead of resolving the old path inside the new project.
  useEffect(() => {
    setActiveArtifact(null)
    setProjectContextView((view) =>
      view === ARTIFACT_PANEL_VIEW_ID ? PROJECT_CONTEXT_FILES_TAB_ID : view
    )
  }, [sessionId])

  const handleGoHome = useCallback(() => {
    navigate({ to: "/" })
  }, [navigate])

  if (chatSessionsQuery.isPending) {
    return (
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{t("chat.loading")}</p>
        </div>
      </section>
    )
  }

  if (!session) {
    return (
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">{t("chat.missing.title")}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("chat.missing.description")}
          </p>
          <Button className="mt-6" onPress={handleGoHome}>
            {t("chat.missing.action")}
          </Button>
        </div>
      </section>
    )
  }

  const sessionTitle = getChatSessionTitle({
    fallbackTitle: t("home.actions.newChat"),
    session
  })

  return (
    <section className="flex min-h-0 flex-1 overflow-hidden">
      {transport && persistedMessagesQuery.isSuccess ? (
        <ChatRuntime
          activeArtifact={activeArtifact}
          agentsEnabled={settingsQuery.data?.agents.enabled ?? false}
          autoCompact={settingsQuery.data?.chat.autoCompact}
          defaultPermissionMode={
            settingsQuery.data?.agents.defaultPermissionMode ?? "default"
          }
          gitDiff={gitDiffQuery.data}
          gitDiffScope={gitDiffScope}
          initialMessages={persistedMessages}
          isLoadingFileItems={isLoadingFileItems}
          isLoadingPromptTemplateItems={isLoadingPromptTemplateItems}
          isLoadingProjectTreeItems={projectTreeItemsQuery.isFetching}
          isLoadingSkillItems={isLoadingSkillItems}
          isProjectContextOpen={isProjectContextOpen}
          isProjectDiffLoading={gitDiffQuery.isFetching}
          mentionItems={mentionItems}
          mentionSkillItems={mentionSkillItems}
          modelEffort={modelEffort}
          modelGroups={modelGroups}
          onChatFinish={handleChatFinish}
          onEffortChange={handleEffortChange}
          onGitDiffScopeChange={handleGitDiffScopeChange}
          onMentionQueryChange={handleMentionQueryChange}
          onModelChange={handleModelChange}
          onOpenArtifact={handleOpenArtifact}
          onOpenSettings={handleOpenSettings}
          onPromptTemplateQueryChange={handlePromptTemplateQueryChange}
          onProjectContextOpenChange={handleProjectContextOpenChange}
          onProjectContextViewChange={handleProjectContextViewChange}
          onRefreshProjectContext={handleRefreshProjectContext}
          onSyncPersistedMessagesAfterFinish={async () => {
            // The post-turn repair must read the just-persisted transcript;
            // the global 60s staleTime would otherwise hand back the pre-turn
            // cache and wipe the latest exchange from the live messages.
            const result = await queryClient.fetchQuery({
              ...chatSessionMessagesQueryOptions,
              staleTime: 0
            })

            return result.messages.map(toRuntimeChatMessage)
          }}
          onToggleProjectContext={handleToggleProjectContext}
          projectContextView={projectContextView}
          projectTreeItems={projectTreeItemsQuery.data?.files ?? []}
          promptTemplateItems={promptTemplateItems}
          selectedModelValue={selectedModelValue}
          selectedSession={session}
          sessionTitle={sessionTitle}
          streamdownAnimation={getChatStreamdownAnimation(
            settingsQuery.data?.chat
          )}
          transport={transport}
        />
      ) : (
        <ChatPendingState
          gitDiff={gitDiffQuery.data}
          gitDiffScope={gitDiffScope}
          isLoadingFileItems={isLoadingFileItems}
          isLoadingPromptTemplateItems={isLoadingPromptTemplateItems}
          isLoadingProjectTreeItems={projectTreeItemsQuery.isFetching}
          isLoadingSkillItems={isLoadingSkillItems}
          isProjectContextOpen={isProjectContextOpen}
          isProjectDiffLoading={gitDiffQuery.isFetching}
          modelEffort={modelEffort}
          modelGroups={modelGroups}
          onEffortChange={handleEffortChange}
          onGitDiffScopeChange={handleGitDiffScopeChange}
          onMentionQueryChange={handleMentionQueryChange}
          onModelChange={handleModelChange}
          onOpenSettings={handleOpenSettings}
          onPromptTemplateQueryChange={handlePromptTemplateQueryChange}
          onProjectContextOpenChange={handleProjectContextOpenChange}
          onProjectContextViewChange={handleProjectContextViewChange}
          onRefreshProjectContext={handleRefreshProjectContext}
          onToggleProjectContext={handleToggleProjectContext}
          projectContextView={projectContextView}
          projectTreeItems={projectTreeItemsQuery.data?.files ?? []}
          promptTemplateItems={promptTemplateItems}
          selectedModelValue={selectedModelValue}
          selectedSession={session}
          sessionTitle={sessionTitle}
        />
      )}
    </section>
  )
}

export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatSessionPage
})
