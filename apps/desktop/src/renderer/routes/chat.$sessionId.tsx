import { useChat } from "@ai-sdk/react"
import { useI18n } from "@etyon/i18n/react"
import type {
  ChatMention,
  ChatUiMessage as PersistedChatUiMessage,
  ChatSessionSummary,
  GitProjectDiffOutput,
  ProjectSnapshotItem
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Resizable } from "@heroui-pro/react"
import type { PanelImperativeHandle } from "@heroui-pro/react"
import { Button, Chip } from "@heroui/react"
import {
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  FolderGitIcon,
  GitCommitIcon,
  GitCompareIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { DefaultChatTransport, UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { MessageActions } from "@/renderer/components/chat/message-actions"
import { ModelSelector } from "@/renderer/components/chat/model-selector"
import {
  PROJECT_CONTEXT_CHANGES_TAB_ID,
  PROJECT_CONTEXT_COMMIT_TAB_ID,
  PROJECT_CONTEXT_FILES_TAB_ID,
  ProjectContextPanel
} from "@/renderer/components/chat/project-context-panel"
import type { ProjectContextPanelView } from "@/renderer/components/chat/project-context-panel"
import { PromptInput } from "@/renderer/components/chat/prompt-input"
import { getChatTransport } from "@/renderer/lib/ai/transport"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  buildAiSettingsWithDefaultModel,
  buildChatModelGroups,
  resolveChatModelValue
} from "@/renderer/lib/chat/model-options"
import {
  formatProjectDiffCount,
  getProjectDiffSummary,
  parseProjectDiffFiles
} from "@/renderer/lib/chat/project-context-panel"
import {
  getMentionTokenTypeLabel,
  splitPromptTextByMentions
} from "@/renderer/lib/chat/prompt-input"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import {
  CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS,
  getChatSessionTitle,
  sortChatSessionsByLastOpenedAt
} from "@/renderer/lib/sidebar/chat-sessions"

interface ChatMessageMetadata {
  mentions?: ChatMention[]
}

type ChatUiMessage = UIMessage<ChatMessageMetadata>
type TextChatPart = Extract<ChatUiMessage["parts"][number], { type: "text" }>

const chatSessionsQueryOptions = orpc.chatSessions.list.queryOptions({})
const settingsQueryOptions = orpc.settings.get.queryOptions({})
const getChatSessionMessagesQueryOptions = (sessionId: string) =>
  orpc.chatSessions.listMessages.queryOptions({
    input: {
      sessionId
    }
  })
const MENTION_ITEM_LIMIT = 50
const NOOP_PROMPT_SUBMIT = (): Promise<void> => Promise.resolve()
const PROJECT_CONTEXT_PANEL_DEFAULT_SIZE = 32
const PROJECT_CONTEXT_PANEL_MAX_SIZE = 46
const PROJECT_CONTEXT_PANEL_MIN_SIZE = 22
const PROJECT_TREE_ITEM_LIMIT = 5000
const CHAT_LAYOUT_CLASS_NAME = "flex min-h-0 flex-1 overflow-hidden"
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
  }
] as const

const getMessageText = (message: ChatUiMessage): string =>
  message.parts
    .filter((part): part is TextChatPart => part.type === "text")
    .map((part) => part.text)
    .join("")

const toRuntimeChatMessage = (
  message: PersistedChatUiMessage
): ChatUiMessage => {
  const runtimeMessage = {
    id: message.id,
    parts: message.parts as ChatUiMessage["parts"],
    role: message.role
  }

  if (message.metadata === undefined) {
    return runtimeMessage
  }

  return {
    ...runtimeMessage,
    metadata: message.metadata as ChatMessageMetadata
  }
}

const getMentionName = (mention: ChatMention): string =>
  mention.relativePath.split("/").at(-1) ?? mention.relativePath

const InlineMentionToken = ({ mention }: { mention: ChatMention }) => (
  <span
    className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/80 px-1.5 py-1 align-baseline text-sm font-medium text-foreground ring-1 ring-border/70"
    title={mention.relativePath}
  >
    <span className="grid h-5 min-w-5 place-items-center rounded-[4px] bg-foreground/15 px-1 text-[0.62rem] leading-none font-semibold text-muted-foreground uppercase">
      {getMentionTokenTypeLabel(mention)}
    </span>
    <span className="max-w-52 truncate">{getMentionName(mention)}</span>
  </span>
)

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
    () => parseProjectDiffFiles(gitDiff?.patch ?? ""),
    [gitDiff?.patch]
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
      <p className="truncate text-sm text-muted-foreground">
        {selectedSession.projectPath}
      </p>
    </div>
    <ProjectContextTrigger
      gitDiff={gitDiff}
      gitStatus={selectedSession.gitStatus}
      isOpen={isProjectContextOpen}
      onToggle={onToggleProjectContext}
    />
  </div>
)

const ProjectContextCollapsedToolbar = ({
  changedFileCount,
  onOpenView,
  selectedView
}: {
  changedFileCount: number
  onOpenView: (view: ProjectContextPanelView) => void
  selectedView: ProjectContextPanelView
}) => {
  const { t } = useI18n()

  return (
    <aside className="flex h-full w-18 shrink-0 items-center justify-center border-l border-border/70 px-3 py-6">
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
  children,
  gitDiff,
  isDiffLoading,
  isOpen,
  isTreeLoading,
  onOpenChange,
  onViewChange,
  onRefresh,
  projectItems,
  selectedModelValue,
  selectedSession,
  selectedView,
  snapshotId
}: {
  children: ReactNode
  gitDiff?: GitProjectDiffOutput
  isDiffLoading: boolean
  isOpen: boolean
  isTreeLoading: boolean
  onOpenChange: (isOpen: boolean) => void
  onViewChange: (view: ProjectContextPanelView) => void
  onRefresh: () => void
  projectItems: ProjectSnapshotItem[]
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  selectedView: ProjectContextPanelView
  snapshotId?: string
}) => {
  const { t } = useI18n()
  const projectContextPanelRef = useRef<PanelImperativeHandle | null>(null)
  const changedFileCount = selectedSession.gitStatus?.changedFileCount ?? 0

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

  return (
    <div className={CHAT_LAYOUT_CLASS_NAME}>
      <Resizable
        className="h-full min-h-0 min-w-0 flex-1"
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
          className={cn(!isOpen && "hidden")}
          disabled={!isOpen}
          type="line"
          variant="secondary"
          withIndicator
        />
        <Resizable.Panel
          className={cn(
            "h-full min-w-0 overflow-hidden py-6 pr-6 pl-4",
            !isOpen && "hidden"
          )}
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
          <ProjectContextPanel
            gitDiff={gitDiff}
            isDiffLoading={isDiffLoading}
            isTreeLoading={isTreeLoading}
            onRefresh={onRefresh}
            onViewChange={onViewChange}
            projectItems={projectItems}
            selectedModelValue={selectedModelValue}
            selectedSession={selectedSession}
            selectedView={selectedView}
            snapshotId={snapshotId}
          />
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

  return sortChatSessionsByLastOpenedAt([
    {
      ...nextSession,
      gitStatus: nextSession.gitStatus ?? previousSession?.gitStatus
    },
    ...(sessions ?? []).filter((session) => session.id !== nextSession.id)
  ])
}

const ChatRuntime = ({
  gitDiff,
  isLoadingFileItems,
  isLoadingProjectTreeItems,
  isModelUpdating,
  isProjectContextOpen,
  isProjectDiffLoading,
  mentionItems,
  modelGroups,
  initialMessages,
  onChatFinish,
  onMentionQueryChange,
  onModelChange,
  onOpenSettings,
  onProjectContextOpenChange,
  onRefreshProjectContext,
  onToggleProjectContext,
  onProjectContextViewChange,
  projectTreeItems,
  projectContextView,
  selectedModelValue,
  selectedSession,
  sessionTitle,
  snapshotId,
  transport
}: {
  gitDiff?: GitProjectDiffOutput
  isLoadingFileItems: boolean
  isLoadingProjectTreeItems: boolean
  isProjectContextOpen: boolean
  isProjectDiffLoading: boolean
  isModelUpdating: boolean
  initialMessages: ChatUiMessage[]
  mentionItems: ProjectSnapshotItem[]
  modelGroups: ChatModelGroup[]
  onChatFinish: () => void
  onMentionQueryChange: (query: string | null) => void
  onModelChange: (value: string | null) => void
  onOpenSettings: () => void
  onProjectContextOpenChange: (isOpen: boolean) => void
  onRefreshProjectContext: () => void
  onToggleProjectContext: () => void
  onProjectContextViewChange: (view: ProjectContextPanelView) => void
  projectTreeItems: ProjectSnapshotItem[]
  projectContextView: ProjectContextPanelView
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  sessionTitle: string
  snapshotId?: string
  transport: DefaultChatTransport<ChatUiMessage>
}) => {
  const { t } = useI18n()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const { clearError, error, messages, regenerate, sendMessage, status } =
    useChat<ChatUiMessage>({
      id: selectedSession.id,
      messages: initialMessages,
      onFinish: onChatFinish,
      transport
    })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    })
  }, [messages])

  const isComposerDisabled =
    isModelUpdating || status === "streaming" || status === "submitted"
  const isRequestPending = status === "streaming" || status === "submitted"
  const latestUserMentions = useMemo(() => {
    for (const message of messages.toReversed()) {
      if (message.role === "user") {
        return message.metadata?.mentions ?? []
      }
    }

    return []
  }, [messages])

  const handleSubmit = useCallback(
    async ({
      mentions,
      text
    }: {
      mentions: ChatMention[]
      text: string
    }): Promise<void> => {
      const metadata =
        mentions.length > 0
          ? {
              mentions
            }
          : undefined

      await sendMessage(
        {
          metadata,
          text
        },
        {
          body: {
            mentions,
            model: selectedModelValue || undefined,
            sessionId: selectedSession.id
          }
        }
      )
    },
    [selectedModelValue, selectedSession.id, sendMessage]
  )

  const handleRegenerate = useCallback(() => {
    clearError()
    void regenerate({
      body: {
        mentions: latestUserMentions,
        model: selectedModelValue || undefined,
        sessionId: selectedSession.id
      }
    })
  }, [
    clearError,
    latestUserMentions,
    regenerate,
    selectedModelValue,
    selectedSession.id
  ])

  return (
    <ChatProjectContextLayout
      gitDiff={gitDiff}
      isDiffLoading={isProjectDiffLoading}
      isOpen={isProjectContextOpen}
      isTreeLoading={isLoadingProjectTreeItems}
      onOpenChange={onProjectContextOpenChange}
      onRefresh={onRefreshProjectContext}
      onViewChange={onProjectContextViewChange}
      projectItems={projectTreeItems}
      selectedModelValue={selectedModelValue}
      selectedSession={selectedSession}
      selectedView={projectContextView}
      snapshotId={snapshotId}
    >
      <div className="flex h-full min-h-0 flex-col gap-6 p-6">
        <ChatSessionHeader
          gitDiff={gitDiff}
          isProjectContextOpen={isProjectContextOpen}
          onToggleProjectContext={onToggleProjectContext}
          selectedSession={selectedSession}
          sessionTitle={sessionTitle}
        />

        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border bg-card shadow-sm">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
                  const isAssistant = message.role === "assistant"
                  const messageMentions = message.metadata?.mentions ?? []
                  const messageText = getMessageText(message)
                  const messageParts = splitPromptTextByMentions({
                    mentions: messageMentions,
                    text: messageText
                  })
                  const hasInlineMentions = messageParts.some(
                    (part) => part.type === "mention"
                  )

                  return (
                    <div
                      className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                      key={message.id}
                    >
                      <div className="max-w-[78%]">
                        <div
                          className={`rounded-3xl px-4 py-3 ${
                            isAssistant
                              ? "bg-muted/60 text-foreground"
                              : "bg-primary text-primary-foreground"
                          }`}
                        >
                          {messageMentions.length > 0 && !hasInlineMentions && (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {messageMentions.map((mention) => (
                                <Chip
                                  color={isAssistant ? "default" : "accent"}
                                  className="max-w-full"
                                  key={`${message.id}-${mention.relativePath}`}
                                  size="sm"
                                  variant={isAssistant ? "secondary" : "soft"}
                                >
                                  <Chip.Label className="truncate">
                                    {mention.relativePath}
                                  </Chip.Label>
                                </Chip>
                              ))}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap">
                            {messageParts.map((part, index) =>
                              part.type === "mention" ? (
                                <InlineMentionToken
                                  key={`${message.id}-mention-${part.mention.relativePath}-${index}`}
                                  mention={part.mention}
                                />
                              ) : (
                                <span key={`${message.id}-text-${index}`}>
                                  {part.text}
                                </span>
                              )
                            )}
                          </p>
                        </div>
                        {isAssistant && (
                          <MessageActions
                            isRegenerating={isRequestPending}
                            messageText={messageText}
                            onRegenerate={handleRegenerate}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
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
          </div>

          <div className="border-t border-border p-4">
            <PromptInput
              disabled={isComposerDisabled}
              footer={
                <div className="flex items-center gap-3">
                  <ModelSelector
                    disabled={isModelUpdating}
                    emptyActionLabel={t("chat.model.emptyAction")}
                    emptyLabel={t("chat.model.emptyDescription")}
                    groups={modelGroups}
                    onOpenSettings={onOpenSettings}
                    onValueChange={onModelChange}
                    value={selectedModelValue}
                  />
                  {snapshotId && (
                    <span className="truncate text-xs text-muted-foreground">
                      {t("chat.snapshot.ready", {
                        snapshotId
                      })}
                    </span>
                  )}
                </div>
              }
              isLoadingFileItems={isLoadingFileItems}
              mentionEmptyLabel={t("chat.mentions.empty")}
              mentionFileGroupLabel={t("chat.mentions.filesGroup")}
              mentionFolderGroupLabel={t("chat.mentions.foldersGroup")}
              mentionItems={mentionItems}
              mentionSearchPlaceholder={t("chat.mentions.searchPlaceholder")}
              onMentionQueryChange={onMentionQueryChange}
              onSubmit={handleSubmit}
              placeholder={t("chat.composer.placeholder")}
              submitLabel={t("chat.composer.send")}
            />
          </div>
        </div>
      </div>
    </ChatProjectContextLayout>
  )
}

const ChatPendingState = ({
  gitDiff,
  isLoadingFileItems,
  isLoadingProjectTreeItems,
  isProjectContextOpen,
  isProjectDiffLoading,
  modelGroups,
  onMentionQueryChange,
  onModelChange,
  onOpenSettings,
  onProjectContextOpenChange,
  onRefreshProjectContext,
  onToggleProjectContext,
  onProjectContextViewChange,
  projectTreeItems,
  projectContextView,
  selectedModelValue,
  selectedSession,
  sessionTitle,
  snapshotId
}: {
  gitDiff?: GitProjectDiffOutput
  isLoadingFileItems: boolean
  isLoadingProjectTreeItems: boolean
  isProjectContextOpen: boolean
  isProjectDiffLoading: boolean
  modelGroups: ChatModelGroup[]
  onMentionQueryChange: (query: string | null) => void
  onModelChange: (value: string | null) => void
  onOpenSettings: () => void
  onProjectContextOpenChange: (isOpen: boolean) => void
  onRefreshProjectContext: () => void
  onToggleProjectContext: () => void
  onProjectContextViewChange: (view: ProjectContextPanelView) => void
  projectTreeItems: ProjectSnapshotItem[]
  projectContextView: ProjectContextPanelView
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  sessionTitle: string
  snapshotId?: string
}) => {
  const { t } = useI18n()

  return (
    <ChatProjectContextLayout
      gitDiff={gitDiff}
      isDiffLoading={isProjectDiffLoading}
      isOpen={isProjectContextOpen}
      isTreeLoading={isLoadingProjectTreeItems}
      onOpenChange={onProjectContextOpenChange}
      onRefresh={onRefreshProjectContext}
      onViewChange={onProjectContextViewChange}
      projectItems={projectTreeItems}
      selectedModelValue={selectedModelValue}
      selectedSession={selectedSession}
      selectedView={projectContextView}
      snapshotId={snapshotId}
    >
      <div className="flex h-full min-h-0 flex-col gap-6 p-6">
        <ChatSessionHeader
          gitDiff={gitDiff}
          isProjectContextOpen={isProjectContextOpen}
          onToggleProjectContext={onToggleProjectContext}
          selectedSession={selectedSession}
          sessionTitle={sessionTitle}
        />

        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border bg-card shadow-sm">
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-5">
            <div className="max-w-md text-center">
              <h2 className="text-lg font-semibold">{t("chat.loading")}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {t("chat.placeholder.description")}
              </p>
            </div>
          </div>

          <div className="border-t border-border p-4">
            <PromptInput
              disabled
              footer={
                <div className="flex items-center gap-3">
                  <ModelSelector
                    disabled
                    emptyActionLabel={t("chat.model.emptyAction")}
                    emptyLabel={t("chat.model.emptyDescription")}
                    groups={modelGroups}
                    onOpenSettings={onOpenSettings}
                    onValueChange={onModelChange}
                    value={selectedModelValue}
                  />
                  {snapshotId && (
                    <span className="truncate text-xs text-muted-foreground">
                      {t("chat.snapshot.ready", {
                        snapshotId
                      })}
                    </span>
                  )}
                </div>
              }
              isLoadingFileItems={isLoadingFileItems}
              mentionEmptyLabel={t("chat.mentions.empty")}
              mentionFileGroupLabel={t("chat.mentions.filesGroup")}
              mentionFolderGroupLabel={t("chat.mentions.foldersGroup")}
              mentionItems={[]}
              mentionSearchPlaceholder={t("chat.mentions.searchPlaceholder")}
              onMentionQueryChange={onMentionQueryChange}
              onSubmit={NOOP_PROMPT_SUBMIT}
              placeholder={t("chat.composer.placeholder")}
              submitLabel={t("chat.composer.send")}
            />
          </div>
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
    useState<ProjectContextPanelView>(PROJECT_CONTEXT_FILES_TAB_ID)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
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
  const gitDiffQueryOptions = useMemo(
    () =>
      orpc.git.diff.queryOptions({
        input: {
          sessionId
        }
      }),
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
  const sessionExists = Boolean(session)
  const persistedMessagesQuery = useQuery({
    ...chatSessionMessagesQueryOptions,
    enabled: sessionExists
  })
  const snapshotStateQuery = useQuery({
    ...snapshotStateQueryOptions,
    enabled: sessionExists
  })
  const mentionItemsQuery = useQuery({
    ...orpc.projectSnapshots.listFiles.queryOptions({
      input: {
        limit: MENTION_ITEM_LIMIT,
        query: mentionQuery ?? "",
        sessionId
      }
    }),
    enabled: sessionExists && mentionQuery !== null
  })
  const gitDiffQuery = useQuery({
    ...gitDiffQueryOptions,
    enabled: sessionExists,
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

  const handleOpenSettings = useCallback(() => {
    navigate({ to: "/settings" })
  }, [navigate])
  const handleProjectContextOpenChange = useCallback((isOpen: boolean) => {
    setProjectContextOpen(isOpen)
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
          gitDiff={gitDiffQuery.data}
          initialMessages={persistedMessages}
          isLoadingFileItems={mentionItemsQuery.isFetching}
          isLoadingProjectTreeItems={projectTreeItemsQuery.isFetching}
          isModelUpdating={setModelMutation.isPending}
          isProjectContextOpen={isProjectContextOpen}
          isProjectDiffLoading={gitDiffQuery.isFetching}
          mentionItems={mentionItemsQuery.data?.files ?? []}
          modelGroups={modelGroups}
          onChatFinish={handleChatFinish}
          onMentionQueryChange={setMentionQuery}
          onModelChange={handleModelChange}
          onOpenSettings={handleOpenSettings}
          onProjectContextOpenChange={handleProjectContextOpenChange}
          onProjectContextViewChange={handleProjectContextViewChange}
          onRefreshProjectContext={handleRefreshProjectContext}
          onToggleProjectContext={handleToggleProjectContext}
          projectContextView={projectContextView}
          projectTreeItems={projectTreeItemsQuery.data?.files ?? []}
          selectedModelValue={selectedModelValue}
          selectedSession={session}
          sessionTitle={sessionTitle}
          snapshotId={snapshotStateQuery.data?.snapshotId}
          transport={transport}
        />
      ) : (
        <ChatPendingState
          gitDiff={gitDiffQuery.data}
          isLoadingFileItems={mentionItemsQuery.isFetching}
          isLoadingProjectTreeItems={projectTreeItemsQuery.isFetching}
          isProjectContextOpen={isProjectContextOpen}
          isProjectDiffLoading={gitDiffQuery.isFetching}
          modelGroups={modelGroups}
          onMentionQueryChange={setMentionQuery}
          onModelChange={handleModelChange}
          onOpenSettings={handleOpenSettings}
          onProjectContextOpenChange={handleProjectContextOpenChange}
          onProjectContextViewChange={handleProjectContextViewChange}
          onRefreshProjectContext={handleRefreshProjectContext}
          onToggleProjectContext={handleToggleProjectContext}
          projectContextView={projectContextView}
          projectTreeItems={projectTreeItemsQuery.data?.files ?? []}
          selectedModelValue={selectedModelValue}
          selectedSession={session}
          sessionTitle={sessionTitle}
          snapshotId={snapshotStateQuery.data?.snapshotId}
        />
      )}
    </section>
  )
}

export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatSessionPage
})
