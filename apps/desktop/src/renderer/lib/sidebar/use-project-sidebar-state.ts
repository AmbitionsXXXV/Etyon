import type { SidebarUiState } from "@etyon/rpc"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

const EMPTY_COLLAPSED_PROJECT_PATHS: string[] = []
const SIDEBAR_STATE_QUERY_OPTIONS = orpc.sidebarState.get.queryOptions({})

export const useProjectSidebarState = () => {
  const queryClient = useQueryClient()
  const sidebarStateQuery = useQuery(SIDEBAR_STATE_QUERY_OPTIONS)
  const collapsedProjectPaths =
    sidebarStateQuery.data?.collapsedProjectPaths ??
    EMPTY_COLLAPSED_PROJECT_PATHS

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

      queryClient.setQueryData(SIDEBAR_STATE_QUERY_OPTIONS.queryKey, {
        collapsedProjectPaths: nextCollapsedProjectPaths
      })

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

  return {
    collapsedProjectPaths,
    handleToggleProjectCollapsed,
    isSidebarStateReady: sidebarStateQuery.isSuccess
  }
}
