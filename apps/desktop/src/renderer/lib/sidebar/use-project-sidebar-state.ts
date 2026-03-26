import type { SidebarUiState } from "@etyon/rpc"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

const EMPTY_COLLAPSED_PROJECT_PATHS: string[] = []
export const SIDEBAR_WIDTH_PX_MAX = 420
export const SIDEBAR_WIDTH_PX_MIN = 240
const SIDEBAR_STATE_QUERY_OPTIONS = orpc.sidebarState.get.queryOptions({})

const clampSidebarWidthPx = (sidebarWidthPx: number): number =>
  Math.min(SIDEBAR_WIDTH_PX_MAX, Math.max(SIDEBAR_WIDTH_PX_MIN, sidebarWidthPx))

export const useProjectSidebarState = () => {
  const queryClient = useQueryClient()
  const sidebarStateQuery = useQuery(SIDEBAR_STATE_QUERY_OPTIONS)
  const collapsedProjectPaths =
    sidebarStateQuery.data?.collapsedProjectPaths ??
    EMPTY_COLLAPSED_PROJECT_PATHS
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
          sidebarWidthPx: clampSidebarWidthPx(nextSidebarWidthPx)
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

  return {
    collapsedProjectPaths,
    handleToggleProjectCollapsed,
    isSidebarStateReady: sidebarStateQuery.isSuccess,
    persistSidebarWidth,
    setSidebarWidthLocally,
    sidebarWidthPx
  }
}
