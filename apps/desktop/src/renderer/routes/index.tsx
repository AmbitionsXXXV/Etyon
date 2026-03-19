import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { motion } from "motion/react"
import { useCallback, useState } from "react"

import { orpc, rpcClient } from "../lib/rpc"

const HomePage = () => {
  const { t } = useI18n({ keyPrefix: "home" })
  const [directResult, setDirectResult] = useState<string>("")

  const pingQuery = useQuery(
    orpc.ping.queryOptions({
      input: { message: t("ping.queryMessage") }
    })
  )

  const handleDirectCall = useCallback(async () => {
    const result = await rpcClient.ping({
      message: t("ping.directMessage")
    })
    setDirectResult(JSON.stringify(result, null, 2))
  }, [t])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-lg space-y-6 text-center"
        initial={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <h1 className="text-4xl font-bold text-red-500">Etyon</h1>
        <p className="text-lg text-gray-600">{t("description")}</p>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4 rounded-lg border border-border bg-background p-6 text-left"
          initial={{ opacity: 0, y: 10 }}
          transition={{
            delay: 0.15,
            duration: 0.35,
            ease: [0.25, 0.1, 0.25, 1]
          }}
        >
          <h2 className="text-lg font-semibold">{t("ping.cardTitle")}</h2>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-500">
              {t("ping.queryLabel")}
            </h3>
            {pingQuery.isLoading && (
              <p className="text-sm text-gray-400">{t("ping.loading")}</p>
            )}
            {pingQuery.isError && (
              <p className="text-sm text-red-500">
                {t("ping.error", { message: pingQuery.error.message })}
              </p>
            )}
            {pingQuery.data && (
              <motion.pre
                animate={{ opacity: 1 }}
                className="overflow-auto rounded bg-muted p-2 text-xs text-foreground"
                initial={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {JSON.stringify(pingQuery.data, null, 2)}
              </motion.pre>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-500">
              {t("directCall.label")}
            </h3>
            <Button onClick={handleDirectCall}>{t("directCall.button")}</Button>
            {directResult && (
              <motion.pre
                animate={{ opacity: 1 }}
                className="overflow-auto rounded bg-muted p-2 text-xs text-foreground"
                initial={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {directResult}
              </motion.pre>
            )}
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}

export const Route = createFileRoute("/")({
  component: HomePage
})
