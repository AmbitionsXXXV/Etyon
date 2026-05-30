import { useI18n } from "@etyon/i18n/react"
import { Button } from "@heroui/react"
import { NoteEditIcon, WorkflowSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"

import { AgentWorkbenchPanel } from "@/renderer/components/chat/agent-workbench-panel"
import { orpc } from "@/renderer/lib/rpc"
import {
  CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS,
  getChatSessionTitle
} from "@/renderer/lib/sidebar/chat-sessions"

const chatSessionsQueryOptions = orpc.chatSessions.list.queryOptions({})
const settingsQueryOptions = orpc.settings.get.queryOptions({})

const AgentWorkbenchRoutePage = () => {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { sessionId } = Route.useParams()
  const chatSessionsQuery = useQuery({
    ...chatSessionsQueryOptions,
    refetchInterval: CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
  })
  const settingsQuery = useQuery(settingsQueryOptions)
  const gitDiffQueryOptions = useMemo(
    () =>
      orpc.git.diff.queryOptions({
        input: {
          sessionId
        }
      }),
    [sessionId]
  )
  const session = useMemo(
    () => chatSessionsQuery.data?.find((item) => item.id === sessionId),
    [chatSessionsQuery.data, sessionId]
  )
  const gitDiffQuery = useQuery({
    ...gitDiffQueryOptions,
    enabled: Boolean(session),
    refetchInterval: CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
  })
  const sessionTitle = session
    ? getChatSessionTitle({
        fallbackTitle: t("home.actions.newChat"),
        session
      })
    : t("chat.missing.title")

  const handleBackToChat = () => {
    navigate({
      params: {
        sessionId
      },
      to: "/chat/$sessionId"
    })
  }

  const handleGoHome = () => {
    navigate({ to: "/" })
  }

  if (!session && !chatSessionsQuery.isFetching) {
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

  return (
    <section className="flex h-svh min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      <header className="title-bar-drag flex shrink-0 items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <HugeiconsIcon
            className="mt-1 shrink-0 text-muted-foreground"
            icon={WorkflowSquare02Icon}
            size={22}
            strokeWidth={2}
          />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">
              {t("chat.workbench.title")}
            </h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {sessionTitle}
            </p>
          </div>
        </div>
        <Button
          className="title-bar-no-drag shrink-0"
          onPress={handleBackToChat}
          size="sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon icon={NoteEditIcon} size={15} strokeWidth={2} />
          {t("chat.workbench.backToChat")}
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        <AgentWorkbenchPanel
          gitDiff={gitDiffQuery.data}
          isProjectDiffLoading={gitDiffQuery.isFetching}
          isRequestPending={false}
          mode="standalone"
          retrySettings={settingsQuery.data?.agents.retry}
          sessionId={sessionId}
        />
      </div>
    </section>
  )
}

export const Route = createFileRoute("/agents/$sessionId")({
  component: AgentWorkbenchRoutePage
})
