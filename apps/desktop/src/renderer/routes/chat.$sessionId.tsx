import { useChat } from "@ai-sdk/react"
import { useI18n } from "@etyon/i18n/react"
import type {
  ChatMention,
  ChatUiMessage as PersistedChatUiMessage,
  ChatSessionSummary,
  ProjectSnapshotItem
} from "@etyon/rpc"
import { Button, Chip } from "@heroui/react"
import {
  ArrowReloadHorizontalIcon,
  Cancel01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { DefaultChatTransport, UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { MessageActions } from "@/renderer/components/chat/message-actions"
import { ModelSelector } from "@/renderer/components/chat/model-selector"
import { PromptInput } from "@/renderer/components/chat/prompt-input"
import { getChatTransport } from "@/renderer/lib/ai/transport"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  buildAiSettingsWithDefaultModel,
  buildChatModelGroups,
  resolveChatModelValue
} from "@/renderer/lib/chat/model-options"
import {
  getMentionTokenTypeLabel,
  splitPromptTextByMentions
} from "@/renderer/lib/chat/prompt-input"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import {
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
const isChatSessionDetailsEnabled =
  import.meta.env.VITE_ENABLE_CHAT_SESSION_DETAILS === "true" ||
  import.meta.env.VITE_ENABLE_CHAT_SESSION_DETAILS === "1"
const CHAT_LAYOUT_CLASS_NAME = isChatSessionDetailsEnabled
  ? "grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]"
  : "grid min-h-0 flex-1 grid-cols-1 gap-6"
const MENTION_ITEM_LIMIT = 50
const NOOP_PROMPT_SUBMIT = (): Promise<void> => Promise.resolve()

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

const upsertChatSession = ({
  nextSession,
  sessions
}: {
  nextSession: ChatSessionSummary
  sessions: ChatSessionSummary[] | undefined
}): ChatSessionSummary[] =>
  sortChatSessionsByLastOpenedAt([
    nextSession,
    ...(sessions ?? []).filter((session) => session.id !== nextSession.id)
  ])

const ChatDetailsPanel = ({
  selectedModelValue,
  selectedSession,
  snapshotId
}: {
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  snapshotId?: string
}) => {
  const { t } = useI18n()

  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">{t("chat.details.title")}</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">
              {t("chat.details.project")}
            </dt>
            <dd className="mt-1 break-all">{selectedSession.projectPath}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("chat.details.sessionId")}
            </dt>
            <dd className="mt-1 break-all">{selectedSession.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("chat.details.model")}</dt>
            <dd className="mt-1 break-all">
              {selectedModelValue || t("chat.model.emptyDescription")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("chat.details.snapshot")}
            </dt>
            <dd className="mt-1 break-all">
              {snapshotId ?? t("chat.snapshot.loading")}
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  )
}

const ChatRuntime = ({
  isLoadingFileItems,
  isModelUpdating,
  mentionItems,
  modelGroups,
  initialMessages,
  onChatFinish,
  onMentionQueryChange,
  onModelChange,
  onOpenSettings,
  selectedModelValue,
  selectedSession,
  snapshotId,
  transport
}: {
  isLoadingFileItems: boolean
  isModelUpdating: boolean
  initialMessages: ChatUiMessage[]
  mentionItems: ProjectSnapshotItem[]
  modelGroups: ChatModelGroup[]
  onChatFinish: () => void
  onMentionQueryChange: (query: string | null) => void
  onModelChange: (value: string | null) => void
  onOpenSettings: () => void
  selectedModelValue: string
  selectedSession: ChatSessionSummary
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
    <div className={CHAT_LAYOUT_CLASS_NAME}>
      <div className="flex min-h-[420px] flex-col rounded-3xl border border-border bg-card shadow-sm">
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
                {isChatSessionDetailsEnabled && snapshotId && (
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

      {isChatSessionDetailsEnabled && (
        <ChatDetailsPanel
          selectedModelValue={selectedModelValue}
          selectedSession={selectedSession}
          snapshotId={snapshotId}
        />
      )}
    </div>
  )
}

const ChatPendingState = ({
  isLoadingFileItems,
  modelGroups,
  onMentionQueryChange,
  onModelChange,
  onOpenSettings,
  selectedModelValue,
  selectedSession,
  snapshotId
}: {
  isLoadingFileItems: boolean
  modelGroups: ChatModelGroup[]
  onMentionQueryChange: (query: string | null) => void
  onModelChange: (value: string | null) => void
  onOpenSettings: () => void
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  snapshotId?: string
}) => {
  const { t } = useI18n()

  return (
    <div className={CHAT_LAYOUT_CLASS_NAME}>
      <div className="flex min-h-[420px] flex-col rounded-3xl border border-border bg-card shadow-sm">
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
                {isChatSessionDetailsEnabled && snapshotId && (
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

      {isChatSessionDetailsEnabled && (
        <ChatDetailsPanel
          selectedModelValue={selectedModelValue}
          selectedSession={selectedSession}
          snapshotId={snapshotId}
        />
      )}
    </div>
  )
}

const ChatSessionPage = () => {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sessionId } = Route.useParams()
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [transport, setTransport] =
    useState<DefaultChatTransport<ChatUiMessage> | null>(null)
  const chatSessionsQuery = useQuery(chatSessionsQueryOptions)
  const chatSessionMessagesQueryOptions = useMemo(
    () => getChatSessionMessagesQueryOptions(sessionId),
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
    ...orpc.projectSnapshots.ensure.queryOptions({
      input: {
        sessionId
      }
    }),
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
          sortChatSessionsByLastOpenedAt([
            openedSession,
            ...(previousSessions ?? []).filter(
              (item) => item.id !== openedSession.id
            )
          ])
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
    <section className="flex flex-1 flex-col gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">
          {sessionTitle}
        </h1>
        <p className="text-sm text-muted-foreground">{session.projectPath}</p>
      </div>

      {transport && persistedMessagesQuery.isSuccess ? (
        <ChatRuntime
          initialMessages={persistedMessages}
          isLoadingFileItems={mentionItemsQuery.isFetching}
          isModelUpdating={setModelMutation.isPending}
          mentionItems={mentionItemsQuery.data?.files ?? []}
          modelGroups={modelGroups}
          onChatFinish={handleChatFinish}
          onMentionQueryChange={setMentionQuery}
          onModelChange={handleModelChange}
          onOpenSettings={handleOpenSettings}
          selectedModelValue={selectedModelValue}
          selectedSession={session}
          snapshotId={snapshotStateQuery.data?.snapshotId}
          transport={transport}
        />
      ) : (
        <ChatPendingState
          isLoadingFileItems={mentionItemsQuery.isFetching}
          modelGroups={modelGroups}
          onMentionQueryChange={setMentionQuery}
          onModelChange={handleModelChange}
          onOpenSettings={handleOpenSettings}
          selectedModelValue={selectedModelValue}
          selectedSession={session}
          snapshotId={snapshotStateQuery.data?.snapshotId}
        />
      )}
    </section>
  )
}

export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatSessionPage
})
