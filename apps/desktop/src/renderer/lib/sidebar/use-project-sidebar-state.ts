import type { SidebarUiState } from "@etyon/rpc"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

const EMPTY_COLLAPSED_PROJECT_PATHS: string[] = []
const EMPTY_PROJECT_ORDER: string[] = []
export const SIDEBAR_WIDTH_PX_MAX = 420
export const SIDEBAR_WIDTH_PX_MIN = 240
const SIDEBAR_STATE_QUERY_OPTIONS = orpc.sidebarState.get.queryOptions({})

const clampSidebarWidthPx = (sidebarWidthPx: number): number =>
  Math.min(SIDEBAR_WIDTH_PX_MAX, Math.max(SIDEBAR_WIDTH_PX_MIN, sidebarWidthPx))

const omitProjectStateRecordKey = (
  record: Record<string, string> | undefined,
  omittedKey: string
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record ?? {}).filter(([entryKey]) => entryKey !== omittedKey)
  )

export const useProjectSidebarState = () => {
  const queryClient = useQueryClient()
  const sidebarStateQuery = useQuery(SIDEBAR_STATE_QUERY_OPTIONS)
  const collapsedProjectPaths =
    sidebarStateQuery.data?.collapsedProjectPaths ??
    EMPTY_COLLAPSED_PROJECT_PATHS
  const projectDisplayNames = sidebarStateQuery.data?.projectDisplayNames ?? {}
  const projectOrder = sidebarStateQuery.data?.projectOrder ?? []
  const projectPins = sidebarStateQuery.data?.projectPins ?? {}
  const sidebarWidthPx = sidebarStateQuery.data?.sidebarWidthPx ?? 272

  const setCollapsedProjectsMutation = useMutation<
    SidebarUiState,
    Error,
    string[],
    SidebarUiState | undefined
  >({
    mutationFn: (nextCollapsedProjectPaths) =>
      rpcClient.sidebarState.setCollapsedProjects({
        collapsedProjectPaths: nextCollapsedProjectPaths
      }),
    onError: (_error, _nextCollapsedProjectPaths, previousState) => {
      queryClient.setQueryData(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        previousState
      )
    },
    onMutate: (nextCollapsedProjectPaths) => {
      const previousState = queryClient.getQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey
      )

      queryClient.setQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        (currentState) => ({
          collapsedProjectPaths: nextCollapsedProjectPaths,
          projectDisplayNames: currentState?.projectDisplayNames ?? {},
          projectOrder: currentState?.projectOrder ?? EMPTY_PROJECT_ORDER,
          projectPins: currentState?.projectPins ?? {},
          sidebarWidthPx: currentState?.sidebarWidthPx ?? 272
        })
      )

      return previousState
    },
    onSuccess: (nextState) => {
      queryClient.setQueryData(SIDEBAR_STATE_QUERY_OPTIONS.queryKey, nextState)
    }
  })
  const setSidebarWidthMutation = useMutation<
    SidebarUiState,
    Error,
    number,
    SidebarUiState | undefined
  >({
    mutationFn: (nextSidebarWidthPx) =>
      rpcClient.sidebarState.setWidth({
        sidebarWidthPx: clampSidebarWidthPx(nextSidebarWidthPx)
      }),
    onError: (_error, _nextSidebarWidthPx, previousState) => {
      queryClient.setQueryData(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        previousState
      )
    },
    onMutate: (nextSidebarWidthPx) => {
      const previousState = queryClient.getQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey
      )

      queryClient.setQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        (currentState) => ({
          collapsedProjectPaths:
            currentState?.collapsedProjectPaths ??
            EMPTY_COLLAPSED_PROJECT_PATHS,
          projectDisplayNames: currentState?.projectDisplayNames ?? {},
          projectOrder: currentState?.projectOrder ?? EMPTY_PROJECT_ORDER,
          projectPins: currentState?.projectPins ?? {},
          sidebarWidthPx: clampSidebarWidthPx(nextSidebarWidthPx)
        })
      )

      return previousState
    },
    onSuccess: (nextState) => {
      queryClient.setQueryData(SIDEBAR_STATE_QUERY_OPTIONS.queryKey, nextState)
    }
  })
  const renameProjectMutation = useMutation<
    SidebarUiState,
    Error,
    {
      displayName: string
      projectPath: string
    },
    SidebarUiState | undefined
  >({
    mutationFn: ({ displayName, projectPath }) =>
      rpcClient.projects.rename({
        displayName,
        projectPath
      }),
    onError: (_error, _variables, previousState) => {
      queryClient.setQueryData(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        previousState
      )
    },
    onMutate: ({ displayName, projectPath }) => {
      const previousState = queryClient.getQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey
      )
      const normalizedDisplayName = displayName.trim()
      const projectDisplayNamesDraft = normalizedDisplayName
        ? {
            ...previousState?.projectDisplayNames,
            [projectPath]: normalizedDisplayName
          }
        : omitProjectStateRecordKey(
            previousState?.projectDisplayNames,
            projectPath
          )

      queryClient.setQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        (currentState) => ({
          collapsedProjectPaths:
            currentState?.collapsedProjectPaths ??
            EMPTY_COLLAPSED_PROJECT_PATHS,
          projectDisplayNames: projectDisplayNamesDraft,
          projectOrder: currentState?.projectOrder ?? EMPTY_PROJECT_ORDER,
          projectPins: currentState?.projectPins ?? {},
          sidebarWidthPx: currentState?.sidebarWidthPx ?? 272
        })
      )

      return previousState
    },
    onSuccess: (nextState) => {
      queryClient.setQueryData(SIDEBAR_STATE_QUERY_OPTIONS.queryKey, nextState)
    }
  })
  const setProjectPinnedMutation = useMutation<
    SidebarUiState,
    Error,
    {
      pinned: boolean
      projectPath: string
    },
    SidebarUiState | undefined
  >({
    mutationFn: ({ pinned, projectPath }) =>
      rpcClient.projects.setPinned({
        pinned,
        projectPath
      }),
    onError: (_error, _variables, previousState) => {
      queryClient.setQueryData(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        previousState
      )
    },
    onMutate: ({ pinned, projectPath }) => {
      const previousState = queryClient.getQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey
      )
      const projectPinsDraft = pinned
        ? {
            ...previousState?.projectPins,
            [projectPath]: new Date().toISOString()
          }
        : omitProjectStateRecordKey(previousState?.projectPins, projectPath)

      queryClient.setQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        (currentState) => ({
          collapsedProjectPaths:
            currentState?.collapsedProjectPaths ??
            EMPTY_COLLAPSED_PROJECT_PATHS,
          projectDisplayNames: currentState?.projectDisplayNames ?? {},
          projectOrder: currentState?.projectOrder ?? EMPTY_PROJECT_ORDER,
          projectPins: projectPinsDraft,
          sidebarWidthPx: currentState?.sidebarWidthPx ?? 272
        })
      )

      return previousState
    },
    onSuccess: (nextState) => {
      queryClient.setQueryData(SIDEBAR_STATE_QUERY_OPTIONS.queryKey, nextState)
    }
  })
  const setProjectOrderMutation = useMutation<
    SidebarUiState,
    Error,
    string[],
    SidebarUiState | undefined
  >({
    mutationFn: (nextProjectOrder) =>
      rpcClient.sidebarState.setProjectOrder({
        projectOrder: nextProjectOrder
      }),
    onError: (_error, _variables, previousState) => {
      queryClient.setQueryData(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        previousState
      )
    },
    onMutate: (nextProjectOrder) => {
      const previousState = queryClient.getQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey
      )

      queryClient.setQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        (currentState) => ({
          collapsedProjectPaths:
            currentState?.collapsedProjectPaths ??
            EMPTY_COLLAPSED_PROJECT_PATHS,
          projectDisplayNames: currentState?.projectDisplayNames ?? {},
          projectOrder: nextProjectOrder,
          projectPins: currentState?.projectPins ?? {},
          sidebarWidthPx: currentState?.sidebarWidthPx ?? 272
        })
      )

      return previousState
    },
    onSuccess: (nextState) => {
      queryClient.setQueryData(SIDEBAR_STATE_QUERY_OPTIONS.queryKey, nextState)
    }
  })

  const handleToggleProjectCollapsed = useCallback(
    (projectPath: string) => {
      const nextCollapsedProjectPaths = collapsedProjectPaths.includes(
        projectPath
      )
        ? collapsedProjectPaths.filter((item) => item !== projectPath)
        : [...collapsedProjectPaths, projectPath]

      setCollapsedProjectsMutation.mutate(nextCollapsedProjectPaths)
    },
    [collapsedProjectPaths, setCollapsedProjectsMutation]
  )
  const setSidebarWidthLocally = useCallback(
    (nextSidebarWidthPx: number) => {
      queryClient.setQueryData<SidebarUiState>(
        SIDEBAR_STATE_QUERY_OPTIONS.queryKey,
        (currentState) => ({
          collapsedProjectPaths:
            currentState?.collapsedProjectPaths ??
            EMPTY_COLLAPSED_PROJECT_PATHS,
          projectDisplayNames: currentState?.projectDisplayNames ?? {},
          projectOrder: currentState?.projectOrder ?? EMPTY_PROJECT_ORDER,
          projectPins: currentState?.projectPins ?? {},
          sidebarWidthPx: clampSidebarWidthPx(nextSidebarWidthPx)
        })
      )
    },
    [queryClient]
  )
  const persistSidebarWidth = useCallback(
    (nextSidebarWidthPx: number) => {
      setSidebarWidthMutation.mutate(clampSidebarWidthPx(nextSidebarWidthPx))
    },
    [setSidebarWidthMutation]
  )
  const handleRenameProject = useCallback(
    (projectPath: string, displayName: string) => {
      renameProjectMutation.mutate({
        displayName,
        projectPath
      })
    },
    [renameProjectMutation]
  )
  const handleSetProjectPinned = useCallback(
    (projectPath: string, pinned: boolean) => {
      setProjectPinnedMutation.mutate({
        pinned,
        projectPath
      })
    },
    [setProjectPinnedMutation]
  )
  const handleSetProjectOrder = useCallback(
    (nextProjectOrder: string[]) => {
      setProjectOrderMutation.mutate(nextProjectOrder)
    },
    [setProjectOrderMutation]
  )

  return {
    collapsedProjectPaths,
    handleRenameProject,
    handleSetProjectOrder,
    handleSetProjectPinned,
    handleToggleProjectCollapsed,
    isRenamingProjectPath: renameProjectMutation.isPending
      ? renameProjectMutation.variables?.projectPath
      : undefined,
    isSidebarStateReady: sidebarStateQuery.isSuccess,
    isSettingPinnedProjectPath: setProjectPinnedMutation.isPending
      ? setProjectPinnedMutation.variables?.projectPath
      : undefined,
    persistSidebarWidth,
    projectDisplayNames,
    projectOrder,
    projectPins,
    setSidebarWidthLocally,
    sidebarWidthPx
  }
}
