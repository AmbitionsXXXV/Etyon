import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type { UpdateCheckErrorCode, UpdateStatus } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Chip, ScrollShadow, Spinner, Switch } from "@heroui/react"
import { Download01Icon, RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useEffect } from "react"

import { AgentMarkdown } from "@/renderer/components/chat/agent-markdown"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"
import { queryClient } from "@/renderer/query-client"

// Compact markdown styling for remote release notes, sized for the boxed
// preview inside the update card.
const RELEASE_NOTES_CLASS_NAME = cn(
  "min-w-0 text-xs leading-6 text-muted-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground",
  "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_li]:my-0.5",
  "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-1.5",
  "[&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5"
)

const UPDATE_ERROR_MESSAGE_KEY = {
  http: "settings.about.updates.error.http",
  "invalid-response": "settings.about.updates.error.invalidResponse",
  network: "settings.about.updates.error.network"
} as const satisfies Record<UpdateCheckErrorCode, TranslationKey>

const BYTES_PER_MEGABYTE = 1024 * 1024

const formatDmgSize = (sizeBytes: number): string =>
  `${(sizeBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`

const AppInfoCard = ({ status }: { status: UpdateStatus | undefined }) => {
  const { t } = useI18n()

  return (
    <motion.section
      {...settingsPageSectionMotion(0.15)}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <h2 className="text-sm font-semibold">{t("settings.about.app.title")}</h2>

      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          {t("settings.about.app.version")}
        </span>

        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">
            {status?.currentVersion ?? "—"}
          </span>

          {status?.buildIdentifier === "development" && (
            <Chip size="sm" variant="soft">
              {t("settings.about.app.developmentBadge")}
            </Chip>
          )}
        </div>
      </div>
    </motion.section>
  )
}

const AvailableUpdateDetails = ({ status }: { status: UpdateStatus }) => {
  const { t } = useI18n()
  const { available } = status
  const downloadMutation = useMutation({
    mutationFn: () => rpcClient.updates.openDownload()
  })
  const releasePageMutation = useMutation({
    mutationFn: () => rpcClient.updates.openReleasePage()
  })

  if (!available) {
    return null
  }

  const downloadLabel =
    available.dmgSizeBytes === null
      ? t("settings.about.updates.actions.download")
      : t("settings.about.updates.actions.downloadWithSize", {
          size: formatDmgSize(available.dmgSizeBytes)
        })

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {t("settings.about.updates.available.heading", {
            version: available.version
          })}
        </h3>

        {available.publishedAt !== null && (
          <p className="text-xs text-muted-foreground">
            {t("settings.about.updates.available.published", {
              date: new Date(available.publishedAt).toLocaleDateString()
            })}
          </p>
        )}
      </div>

      {available.notes !== null && (
        <ScrollShadow className="max-h-64 rounded-lg border border-border/60 bg-card/50 px-3 py-2">
          <AgentMarkdown
            animated={false}
            className={RELEASE_NOTES_CLASS_NAME}
            isAnimating={false}
          >
            {available.notes}
          </AgentMarkdown>
        </ScrollShadow>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {available.dmgUrl !== null && (
          <Button
            isDisabled={downloadMutation.isPending}
            onPress={() => downloadMutation.mutate()}
          >
            <HugeiconsIcon icon={Download01Icon} size={15} />
            {downloadLabel}
          </Button>
        )}

        <Button
          isDisabled={releasePageMutation.isPending}
          onPress={() => releasePageMutation.mutate()}
          variant="ghost"
        >
          {t("settings.about.updates.actions.releasePage")}
        </Button>
      </div>
    </div>
  )
}

export const AboutTab = () => {
  const { t } = useI18n()
  const statusQuery = useQuery({
    ...orpc.updates.status.queryOptions({}),
    refetchOnWindowFocus: false
  })
  const settingsQuery = useQuery({
    ...orpc.settings.get.queryOptions({}),
    refetchOnWindowFocus: false
  })
  const status = statusQuery.data

  useEffect(() => {
    const { queryKey } = orpc.updates.status.queryOptions({})

    return window.electron.onUpdatesStatusChanged((next) => {
      queryClient.setQueryData(queryKey, next)
    })
  }, [])

  const checkMutation = useMutation({
    mutationFn: () => rpcClient.updates.check(),
    onSuccess: (next) => {
      queryClient.setQueryData(
        orpc.updates.status.queryOptions({}).queryKey,
        next
      )
    }
  })
  const autoCheckMutation = useMutation({
    mutationFn: (autoCheck: boolean) => {
      const settings = settingsQuery.data

      if (!settings) {
        throw new Error("Settings are unavailable.")
      }

      return rpcClient.settings.update({
        updates: { ...settings.updates, autoCheck }
      })
    },
    onSuccess: async () => {
      await settingsQuery.refetch()
    }
  })

  const isChecking = status?.state === "checking" || checkMutation.isPending
  const lastCheckedAt = status?.lastCheckedAt ?? null
  const statusMessage = (() => {
    if (isChecking) {
      return t("settings.about.updates.status.checking")
    }

    switch (status?.state) {
      case "available": {
        return t("settings.about.updates.status.available")
      }
      case "error": {
        return t(UPDATE_ERROR_MESSAGE_KEY[status.errorCode ?? "network"])
      }
      case "up-to-date": {
        return t("settings.about.updates.status.upToDate", {
          version: status.currentVersion
        })
      }
      default: {
        return t("settings.about.updates.status.idle")
      }
    }
  })()

  return (
    <div className="space-y-8">
      <AppInfoCard status={status} />

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.about.updates.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.about.updates.autoCheck.description")}
            </p>
          </div>

          <Switch
            aria-label={t("settings.about.updates.autoCheck.label")}
            isDisabled={autoCheckMutation.isPending || settingsQuery.isLoading}
            isSelected={settingsQuery.data?.updates.autoCheck ?? true}
            onChange={(autoCheck) => autoCheckMutation.mutate(autoCheck)}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {isChecking && <Spinner size="sm" />}

            <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
              <span>{statusMessage}</span>

              {!isChecking && lastCheckedAt !== null && (
                <span className="text-[0.6875rem]">
                  {t("settings.about.updates.status.lastChecked", {
                    time: new Date(lastCheckedAt).toLocaleString()
                  })}
                </span>
              )}
            </div>
          </div>

          <Button
            isDisabled={isChecking}
            onPress={() => checkMutation.mutate()}
            variant="secondary"
          >
            <HugeiconsIcon icon={RefreshIcon} size={15} />
            {isChecking
              ? t("settings.about.updates.actions.checking")
              : t("settings.about.updates.actions.check")}
          </Button>
        </div>

        {status?.state === "available" && (
          <AvailableUpdateDetails status={status} />
        )}
      </motion.section>
    </div>
  )
}
