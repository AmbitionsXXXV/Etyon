import type { ChatSessionSummary } from "@etyon/rpc"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { sortChatSessionsByLastOpenedAt } from "@/renderer/lib/sidebar/chat-sessions"

const CHAT_ROUTE_PREFIX = "/chat/" as const

const getCurrentSessionIdFromPathname = (
  pathname: string
): string | undefined => {
  if (!pathname.startsWith(CHAT_ROUTE_PREFIX)) {
    return undefined
  }

  const pathWithoutPrefix = pathname.slice(CHAT_ROUTE_PREFIX.length)

  return pathWithoutPrefix.length > 0
    ? decodeURIComponent(pathWithoutPrefix)
    : undefined
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

export const useChatSessionActions = () => {
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  })
  const queryClient = useQueryClient()
  const chatSessionsQueryKey = orpc.chatSessions.list.queryOptions({}).queryKey
  const currentSessionId = useMemo(
    () => getCurrentSessionIdFromPathname(pathname),
    [pathname]
  )

  const createChatSessionMutation = useMutation({
    mutationFn: (nextCurrentSessionId: string | undefined) =>
      rpcClient.chatSessions.create({
        currentSessionId: nextCurrentSessionId
      }),
    onSuccess: async (nextSession) => {
      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryKey,
        (sessions) =>
          upsertChatSession({
            nextSession,
            sessions
          })
      )

      await navigate({
        params: {
          sessionId: nextSession.id
        },
        to: "/chat/$sessionId"
      })
    }
  })

  const openChatSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      rpcClient.chatSessions.open({
        sessionId
      }),
    onSuccess: async (nextSession) => {
      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryKey,
        (sessions) =>
          upsertChatSession({
            nextSession,
            sessions
          })
      )

      await navigate({
        params: {
          sessionId: nextSession.id
        },
        to: "/chat/$sessionId"
      })
    }
  })

  const setPinnedChatSessionMutation = useMutation({
    mutationFn: ({
      pinned,
      sessionId
    }: {
      pinned: boolean
      sessionId: string
    }) =>
      rpcClient.chatSessions.setPinned({
        pinned,
        sessionId
      }),
    onSuccess: (nextSession) => {
      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryKey,
        (sessions) =>
          upsertChatSession({
            nextSession,
            sessions
          })
      )
    }
  })

  const handleCreateChatSession = useCallback(() => {
    createChatSessionMutation.mutate(currentSessionId)
  }, [createChatSessionMutation, currentSessionId])

  const handleOpenChatSession = useCallback(
    (sessionId: string) => {
      openChatSessionMutation.mutate(sessionId)
    },
    [openChatSessionMutation]
  )

  const handleSetChatSessionPinned = useCallback(
    (sessionId: string, pinned: boolean) => {
      setPinnedChatSessionMutation.mutate({
        pinned,
        sessionId
      })
    },
    [setPinnedChatSessionMutation]
  )

  return {
    currentSessionId,
    handleCreateChatSession,
    handleOpenChatSession,
    handleSetChatSessionPinned,
    isCreatingChatSession: createChatSessionMutation.isPending,
    isOpeningChatSession: openChatSessionMutation.isPending,
    isSettingPinnedChatSessionId: setPinnedChatSessionMutation.isPending
      ? setPinnedChatSessionMutation.variables?.sessionId
      : undefined
  }
}
