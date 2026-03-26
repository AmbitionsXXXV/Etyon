import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import { Input } from "@etyon/ui/components/input"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"
import {
  getChatSessionTitle,
  sortChatSessionsByLastOpenedAt
} from "@/renderer/lib/sidebar/chat-sessions"

const ChatSessionPage = () => {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sessionId } = Route.useParams()
  const chatSessionsQuery = useQuery(orpc.chatSessions.list.queryOptions({}))
  const chatSessionsQueryKey = orpc.chatSessions.list.queryOptions({}).queryKey
  const session = useMemo(
    () => chatSessionsQuery.data?.find((item) => item.id === sessionId),
    [chatSessionsQuery.data, sessionId]
  )
  const sessionExists = Boolean(session)
  const handleNavigateHome = useCallback(() => {
    navigate({ to: "/" })
  }, [navigate])

  useEffect(() => {
    let isDisposed = false

    const syncLastOpenedAt = async (): Promise<void> => {
      if (!chatSessionsQuery.isSuccess || !sessionExists) {
        return
      }

      const openedSession = await rpcClient.chatSessions.open({ sessionId })

      if (isDisposed) {
        return
      }

      queryClient.setQueryData(chatSessionsQueryKey, (previousSessions) =>
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
      isDisposed = true
    }
  }, [
    chatSessionsQuery.isSuccess,
    chatSessionsQueryKey,
    queryClient,
    sessionExists,
    sessionId
  ])

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
          <Button className="mt-6" onClick={handleNavigateHome}>
            {t("chat.missing.action")}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">
          {getChatSessionTitle({
            fallbackTitle: t("home.actions.newChat"),
            session
          })}
        </h1>
        <p className="text-sm text-muted-foreground">{session.projectPath}</p>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-h-[420px] flex-col rounded-3xl border border-border bg-card shadow-sm">
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <h2 className="text-lg font-semibold">
                {t("chat.placeholder.title")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {t("chat.placeholder.description")}
              </p>
            </div>
          </div>
          <div className="border-t border-border p-4">
            <Input
              disabled
              placeholder={t("chat.placeholder.inputPlaceholder")}
              value=""
            />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">{t("chat.details.title")}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {t("chat.details.project")}
                </dt>
                <dd className="mt-1 break-all">{session.projectPath}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("chat.details.sessionId")}
                </dt>
                <dd className="mt-1 break-all">{session.id}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </section>
  )
}

export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatSessionPage
})
