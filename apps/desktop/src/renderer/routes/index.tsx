import { Button } from "@etyon/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useState } from "react"

import { orpc, rpcClient } from "../lib/rpc"

const HomePage = () => {
  const [directResult, setDirectResult] = useState<string>("")

  const pingQuery = useQuery(
    orpc.ping.queryOptions({
      input: { message: "hello from TanStack Query" }
    })
  )

  const handleDirectCall = useCallback(async () => {
    const result = await rpcClient.ping({ message: "hello from direct call" })
    setDirectResult(JSON.stringify(result, null, 2))
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-lg space-y-6 text-center">
        <h1 className="text-4xl font-bold text-red-500">Etyon</h1>
        <p className="text-lg text-gray-600">
          Welcome to your Electron application.
        </p>

        <div className="space-y-4 rounded-lg border border-border bg-background p-6 text-left">
          <h2 className="text-lg font-semibold">oRPC IPC Test</h2>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-500">
              TanStack Query (auto)
            </h3>
            {pingQuery.isLoading && (
              <p className="text-sm text-gray-400">Loading...</p>
            )}
            {pingQuery.isError && (
              <p className="text-sm text-red-500">
                Error: {pingQuery.error.message}
              </p>
            )}
            {pingQuery.data && (
              <pre className="overflow-auto rounded bg-muted p-2 text-xs text-foreground">
                {JSON.stringify(pingQuery.data, null, 2)}
              </pre>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-500">Direct Call</h3>
            <Button onClick={handleDirectCall}>Call rpcClient.ping()</Button>
            {directResult && (
              <pre className="overflow-auto rounded bg-muted p-2 text-xs text-foreground">
                {directResult}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute("/")({
  component: HomePage
})
