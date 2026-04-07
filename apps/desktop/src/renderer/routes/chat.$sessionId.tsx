import { useChat } from "@ai-sdk/react"
import { useI18n } from "@etyon/i18n/react"
import type {
  ChatMention,
  ChatSessionSummary,
  ProjectSnapshotFileItem
} from "@etyon/rpc"
import { Badge } from "@etyon/ui/components/badge"
import { Button } from "@etyon/ui/components/button"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { DefaultChatTransport, UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ModelSelector } from "@/renderer/components/chat/model-selector"
import { PromptInput } from "@/renderer/components/chat/prompt-input"
import { getChatTransport } from "@/renderer/lib/ai/transport"
import type { ChatModelGroup } from "@/renderer/lib/chat/model-options"
import {
  buildChatModelGroups,
  resolveChatModelValue
} from "@/renderer/lib/chat/model-options"
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
const NOOP_PROMPT_SUBMIT = (): Promise<void> => Promise.resolve()

const getMessageText = (message: ChatUiMessage): string =>
  message.parts
    .filter((part): part is TextChatPart => part.type === "text")
    .map((part) => part.text)
    .join("")

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
  fileItems,
  isLoadingFileItems,
  isModelUpdating,
  modelGroups,
  onMentionQueryChange,
  onModelChange,
  onOpenSettings,
  selectedModelValue,
  selectedSession,
  snapshotId,
  transport
}: {
  fileItems: ProjectSnapshotFileItem[]
  isLoadingFileItems: boolean
  isModelUpdating: boolean
  modelGroups: ChatModelGroup[]
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
  const { clearError, error, messages, sendMessage, status } =
    useChat<ChatUiMessage>({
      id: selectedSession.id,
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

  return (
    <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-[420px] flex-col rounded-3xl border border-border bg-card shadow-sm">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {messages.length === 0 ? (
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

                return (
                  <div
                    className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                    key={message.id}
                  >
                    <div
                      className={`max-w-[78%] rounded-3xl px-4 py-3 ${
                        isAssistant
                          ? "bg-muted/60 text-foreground"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {messageMentions.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {messageMentions.map((mention) => (
                            <Badge
                              className="max-w-full"
                              key={`${message.id}-${mention.relativePath}`}
                              variant={isAssistant ? "outline" : "secondary"}
                            >
                              <span className="truncate">
                                {mention.relativePath}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      )}

                      <p className="whitespace-pre-wrap">{messageText}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border p-4">
          <PromptInput
            disabled={isComposerDisabled}
            fileItems={fileItems}
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
            mentionSearchPlaceholder={t("chat.mentions.searchPlaceholder")}
            onMentionQueryChange={onMentionQueryChange}
            onSubmit={handleSubmit}
            placeholder={t("chat.composer.placeholder")}
            submitLabel={t("chat.composer.send")}
          />

          {error && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <span className="truncate">{error.message}</span>
              <Button
                onClick={clearError}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("chat.error.dismiss")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <ChatDetailsPanel
        selectedModelValue={selectedModelValue}
        selectedSession={selectedSession}
        snapshotId={snapshotId}
      />
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
    <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
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
            fileItems={[]}
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
            mentionSearchPlaceholder={t("chat.mentions.searchPlaceholder")}
            onMentionQueryChange={onMentionQueryChange}
            onSubmit={NOOP_PROMPT_SUBMIT}
            placeholder={t("chat.composer.placeholder")}
            submitLabel={t("chat.composer.send")}
          />
        </div>
      </div>

      <ChatDetailsPanel
        selectedModelValue={selectedModelValue}
        selectedSession={selectedSession}
        snapshotId={snapshotId}
      />
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
  const settingsQuery = useQuery(orpc.settings.get.queryOptions({}))
  const session = useMemo(
    () => chatSessionsQuery.data?.find((item) => item.id === sessionId),
    [chatSessionsQuery.data, sessionId]
  )
  const sessionExists = Boolean(session)
  const snapshotStateQuery = useQuery({
    ...orpc.projectSnapshots.ensure.queryOptions({
      input: {
        sessionId
      }
    }),
    enabled: sessionExists
  })
  const fileItemsQuery = useQuery({
    ...orpc.projectSnapshots.listFiles.queryOptions({
      input: {
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
    mutationFn: (modelId: string | null) =>
      rpcClient.chatSessions.setModel({
        modelId,
        sessionId
      }),
    onSuccess: (nextSession) => {
      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryOptions.queryKey,
        (sessions) =>
          upsertChatSession({
            nextSession,
            sessions
          })
      )
    }
  })

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

      queryClient.setQueryData(
        chatSessionsQueryOptions.queryKey,
        (previousSessions) =>
          sortChatSessionsByLastOpenedAt([
            openedSession,
            ...(
              (previousSessions as typeof chatSessionsQuery.data | undefined) ??
              []
            ).filter((item) => item.id !== openedSession.id)
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
  }, [
    chatSessionsQuery.data,
    chatSessionsQuery.isSuccess,
    queryClient,
    sessionExists,
    sessionId
  ])

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
          <Button className="mt-6" onClick={handleGoHome}>
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

      {transport ? (
        <ChatRuntime
          fileItems={fileItemsQuery.data?.files ?? []}
          isLoadingFileItems={fileItemsQuery.isFetching}
          isModelUpdating={setModelMutation.isPending}
          modelGroups={modelGroups}
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
          isLoadingFileItems={fileItemsQuery.isFetching}
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
