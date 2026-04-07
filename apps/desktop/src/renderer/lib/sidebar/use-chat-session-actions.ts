import { logger } from "@etyon/logger/renderer"
import type { ChatSessionSummary, CreateChatSessionInput } from "@etyon/rpc"
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
    mutationFn: (input: CreateChatSessionInput) =>
      rpcClient.chatSessions.create(input),
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
    createChatSessionMutation.mutate({
      currentSessionId
    })
  }, [createChatSessionMutation, currentSessionId])
  const handleCreateProjectChatSession = useCallback(async () => {
    try {
      const selectedProjectPath = await window.electron.ipcRenderer.invoke(
        "pick-project-directory"
      )

      if (
        typeof selectedProjectPath !== "string" ||
        selectedProjectPath.length === 0
      ) {
        return
      }

      createChatSessionMutation.mutate({
        projectPath: selectedProjectPath
      })
    } catch (error: unknown) {
      logger.error("sidebar_pick_project_directory_failed", { error })
    }
  }, [createChatSessionMutation])

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
    handleCreateProjectChatSession,
    handleOpenChatSession,
    handleSetChatSessionPinned,
    isCreatingChatSession: createChatSessionMutation.isPending,
    isOpeningChatSession: openChatSessionMutation.isPending,
    isSettingPinnedChatSessionId: setPinnedChatSessionMutation.isPending
      ? setPinnedChatSessionMutation.variables?.sessionId
      : undefined
  }
}
