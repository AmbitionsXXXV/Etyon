import { logger } from "@etyon/logger/renderer"
import type { ChatSessionSummary, CreateChatSessionInput } from "@etyon/rpc"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { sortChatSessionsByLastOpenedAt } from "@/renderer/lib/sidebar/chat-sessions"

const CHAT_ROUTE_PREFIX = "/chat/" as const
const AGENT_WORKBENCH_ROUTE_PREFIX = "/agents/" as const

const getCurrentSessionIdFromPathname = (
  pathname: string
): string | undefined => {
  let routePrefix: null | string = null

  if (pathname.startsWith(CHAT_ROUTE_PREFIX)) {
    routePrefix = CHAT_ROUTE_PREFIX
  } else if (pathname.startsWith(AGENT_WORKBENCH_ROUTE_PREFIX)) {
    routePrefix = AGENT_WORKBENCH_ROUTE_PREFIX
  }

  if (routePrefix === null) {
    return undefined
  }

  const pathWithoutPrefix = pathname.slice(routePrefix.length)

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
  const replaceChatSessionList = useCallback(
    async (activeSessions: ChatSessionSummary[]) => {
      queryClient.setQueryData<ChatSessionSummary[] | undefined>(
        chatSessionsQueryKey,
        activeSessions
      )

      if (
        !currentSessionId ||
        activeSessions.some((session) => session.id === currentSessionId)
      ) {
        return
      }

      const [nextSession] = activeSessions

      if (nextSession) {
        await navigate({
          params: {
            sessionId: nextSession.id
          },
          to: "/chat/$sessionId"
        })
        return
      }

      await navigate({ to: "/" })
    },
    [chatSessionsQueryKey, currentSessionId, navigate, queryClient]
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

  const archiveChatSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      rpcClient.chatSessions.archive({
        sessionId
      }),
    onError: (error, sessionId) => {
      logger.error("sidebar_archive_chat_session_failed", {
        error,
        sessionId
      })
    },
    onSuccess: async (archivedSession) => {
      const activeSessions = (
        queryClient.getQueryData<ChatSessionSummary[] | undefined>(
          chatSessionsQueryKey
        ) ?? []
      ).filter((session) => session.id !== archivedSession.id)

      await replaceChatSessionList(activeSessions)
    }
  })
  const archiveProjectChatsMutation = useMutation({
    mutationFn: (projectPath: string) =>
      rpcClient.projects.archiveChats({
        projectPath
      }),
    onError: (error, projectPath) => {
      logger.error("sidebar_archive_project_chats_failed", {
        error,
        projectPath
      })
    },
    onSuccess: replaceChatSessionList
  })
  const removeProjectMutation = useMutation({
    mutationFn: (projectPath: string) =>
      rpcClient.projects.remove({
        projectPath
      }),
    onError: (error, projectPath) => {
      logger.error("sidebar_remove_project_failed", {
        error,
        projectPath
      })
    },
    onSuccess: replaceChatSessionList
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

  const handleArchiveChatSession = useCallback(
    (sessionId: string) => {
      archiveChatSessionMutation.mutate(sessionId)
    },
    [archiveChatSessionMutation]
  )

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
  const handleArchiveProjectChats = useCallback(
    (projectPath: string) => {
      archiveProjectChatsMutation.mutate(projectPath)
    },
    [archiveProjectChatsMutation]
  )

  const handleOpenChatSession = useCallback(
    (sessionId: string) => {
      openChatSessionMutation.mutate(sessionId)
    },
    [openChatSessionMutation]
  )
  const handleOpenProjectInFileManager = useCallback(
    async (projectPath: string) => {
      try {
        await window.electron.ipcRenderer.invoke(
          "open-project-in-file-manager",
          projectPath
        )
      } catch (error: unknown) {
        logger.error("sidebar_open_project_in_file_manager_failed", {
          error,
          projectPath
        })
      }
    },
    []
  )
  const handleRemoveProject = useCallback(
    (projectPath: string) => {
      removeProjectMutation.mutate(projectPath)
    },
    [removeProjectMutation]
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
    handleArchiveChatSession,
    handleArchiveProjectChats,
    handleCreateChatSession,
    handleCreateProjectChatSession,
    handleOpenChatSession,
    handleOpenProjectInFileManager,
    handleRemoveProject,
    handleSetChatSessionPinned,
    isArchivingChatSessionId: archiveChatSessionMutation.isPending
      ? archiveChatSessionMutation.variables
      : undefined,
    isArchivingProjectPath: archiveProjectChatsMutation.isPending
      ? archiveProjectChatsMutation.variables
      : undefined,
    isCreatingChatSession: createChatSessionMutation.isPending,
    isOpeningChatSession: openChatSessionMutation.isPending,
    isRemovingProjectPath: removeProjectMutation.isPending
      ? removeProjectMutation.variables
      : undefined,
    isSettingPinnedChatSessionId: setPinnedChatSessionMutation.isPending
      ? setPinnedChatSessionMutation.variables?.sessionId
      : undefined
  }
}
