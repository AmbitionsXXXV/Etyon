import { useI18n } from "@etyon/i18n/react"
import { Button } from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { orpc, rpcClient } from "@/renderer/lib/rpc"

export const InvocationStatus = ({ sessionId }: { sessionId: string }) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const query = useQuery(
    orpc.invocations.list.queryOptions({
      input: { sessionId },
      refetchInterval: 5000
    })
  )
  const resolve = useMutation({
    mutationFn: async ({
      completed,
      id
    }: {
      completed: boolean
      id: string
    }) => {
      await rpcClient.invocations.resolve({ completed, id, sessionId })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.invocations.list.key()
      })
    }
  })
  const unknown =
    query.data?.invocations.filter((entry) => entry.state === "unknown") ?? []
  if (!unknown.length) {
    return null
  }
  return (
    <details
      className="mx-4 mb-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm"
      open
    >
      <summary className="cursor-pointer font-medium">
        {t("chat.invocations.title", { count: unknown.length })}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("chat.invocations.description")}
      </p>
      {unknown.map((entry) => (
        <div className="mt-3 space-y-2" key={entry.id}>
          <p className="text-xs font-medium">
            {entry.toolName} · {entry.createdAt}
          </p>
          <pre className="max-h-20 overflow-auto text-xs whitespace-pre-wrap">
            {entry.summaryJson}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              isDisabled={resolve.isPending}
              onPress={() => resolve.mutate({ completed: true, id: entry.id })}
              size="sm"
              variant="secondary"
            >
              {t("chat.invocations.completed")}
            </Button>
            <Button
              isDisabled={resolve.isPending}
              onPress={() => resolve.mutate({ completed: false, id: entry.id })}
              size="sm"
              variant="ghost"
            >
              {t("chat.invocations.notCompleted")}
            </Button>
          </div>
        </div>
      ))}
      {resolve.isError ? (
        <p className="mt-2 text-xs text-danger">
          {t("chat.invocations.failed")}
        </p>
      ) : null}
    </details>
  )
}
