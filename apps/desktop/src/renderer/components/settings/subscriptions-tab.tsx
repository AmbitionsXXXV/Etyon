import { useI18n } from "@etyon/i18n/react"
import type {
  LocalAccount,
  LocalAccountUsageWindow,
  LocalAccountsSettings
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Skeleton, Switch } from "@heroui/react"
import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"

import { AgentTuningSection } from "@/renderer/components/settings/agent-tuning-section"
import { orpc } from "@/renderer/lib/rpc"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

const SECTION_CLASS_NAME =
  "space-y-4 rounded-2xl border border-border bg-card p-5"
const SESSION_SPAN_SECONDS = 5 * 60 * 60
const WEEK_SPAN_SECONDS = 7 * 24 * 60 * 60
// /usage spawns Claude Code, so allowance is read on demand and kept a while.
const USAGE_STALE_MS = 5 * 60 * 1000
const USAGE_HIGH_PERCENT = 80

const ACCOUNT_NAME_KEY = {
  "claude-code": "settings.subscriptions.account.claudeCode",
  codex: "settings.subscriptions.account.codex"
} as const

const STATUS_KEY = {
  "not-installed": "settings.subscriptions.status.notInstalled",
  "signed-in": "settings.subscriptions.status.signedIn",
  "signed-out": "settings.subscriptions.status.signedOut",
  unavailable: "settings.subscriptions.status.unavailable"
} as const

const formatPlan = (plan: string): string =>
  plan.charAt(0).toUpperCase() + plan.slice(1)

const useWindowLabel = () => {
  const { t } = useI18n()

  return (window: LocalAccountUsageWindow): string => {
    let label = t("settings.subscriptions.window.custom", {
      hours: Math.round((window.spanSeconds ?? 0) / 3600)
    })

    if (window.spanSeconds === SESSION_SPAN_SECONDS) {
      label = t("settings.subscriptions.window.session")
    } else if (window.spanSeconds === WEEK_SPAN_SECONDS) {
      label = t("settings.subscriptions.window.week")
    }

    return window.scope ? `${label} · ${window.scope}` : label
  }
}

const formatReset = (window: LocalAccountUsageWindow): string | null => {
  if (window.resetsText) {
    return window.resetsText
  }

  return window.resetsAt
    ? new Date(window.resetsAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : null
}

const UsageWindowRow = ({ window }: { window: LocalAccountUsageWindow }) => {
  const { t } = useI18n()
  const getWindowLabel = useWindowLabel()
  const reset = formatReset(window)
  const used = Math.min(100, Math.max(0, window.usedPercent))

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{getWindowLabel(window)}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t("settings.subscriptions.window.used", {
            percent: Math.round(used)
          })}
        </span>
      </div>
      <div
        aria-hidden
        className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
      >
        <div
          className={cn(
            "h-full rounded-full",
            used >= USAGE_HIGH_PERCENT ? "bg-warning" : "bg-accent"
          )}
          style={{ width: `${used}%` }}
        />
      </div>
      {reset ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.subscriptions.window.resets", { time: reset })}
        </p>
      ) : null}
    </div>
  )
}

const AccountUsage = ({ account }: { account: LocalAccount }) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const usageOptions = orpc.localAccounts.usage.queryOptions({
    input: { id: account.id },
    staleTime: USAGE_STALE_MS
  })
  const usage = useQuery(usageOptions)

  return (
    <div className="space-y-3 border-t border-separator pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("settings.subscriptions.usage.title")}
        </h3>
        <Button
          aria-label={t("settings.subscriptions.usage.refresh")}
          isDisabled={usage.isFetching}
          isIconOnly
          onPress={() => {
            void queryClient.invalidateQueries({
              queryKey: usageOptions.queryKey
            })
          }}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon
            className={cn(usage.isFetching && "animate-spin")}
            icon={ArrowReloadHorizontalIcon}
            size={15}
          />
        </Button>
      </div>
      {usage.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/2 rounded-md" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ) : null}
      {usage.data?.error ? (
        <p className="text-xs leading-5 text-warning">{usage.data.error}</p>
      ) : null}
      {usage.data?.windows.map((window) => (
        <UsageWindowRow
          key={`${window.spanSeconds}-${window.scope ?? "all"}`}
          window={window}
        />
      ))}
      {usage.data?.credits ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.subscriptions.usage.credits", {
            credits: usage.data.credits
          })}
        </p>
      ) : null}
    </div>
  )
}

const AccountCard = ({ account }: { account: LocalAccount }) => {
  const { t } = useI18n()
  const isSignedIn = account.status === "signed-in"
  const identity = [account.email, account.organization]
    .filter(Boolean)
    .join(" · ")

  return (
    <section className={SECTION_CLASS_NAME}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">
              {t(ACCOUNT_NAME_KEY[account.id])}
            </h2>
            {account.plan ? (
              <span className="rounded-md bg-accent-soft px-1.5 text-xs font-medium text-accent-soft-foreground">
                {formatPlan(account.plan)}
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {identity || t(STATUS_KEY[account.status])}
          </p>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 text-xs",
            isSignedIn ? "text-success" : "text-muted-foreground"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              isSignedIn ? "bg-success" : "bg-muted-foreground"
            )}
          />
          {t(STATUS_KEY[account.status])}
        </span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("settings.subscriptions.source", { source: account.source })}
        {account.subscriptionUntil
          ? ` · ${t("settings.subscriptions.until", {
              date: new Date(account.subscriptionUntil).toLocaleDateString()
            })}`
          : ""}
      </p>
      {account.id === "claude-code" && isSignedIn ? (
        <p className="rounded-xl bg-surface p-3 text-xs leading-5 text-muted-foreground">
          {t("settings.subscriptions.claudeNote")}
        </p>
      ) : null}
      {isSignedIn ? <AccountUsage account={account} /> : null}
    </section>
  )
}

export const SubscriptionsTab = ({
  active,
  localAccounts,
  onLocalAccountsChange
}: {
  /** Inactive tabs stay mounted but read nothing (mirrors McpTab). */
  active: boolean
  localAccounts: LocalAccountsSettings
  onLocalAccountsChange: (value: LocalAccountsSettings) => void
}) => {
  const { t } = useI18n()
  const accounts = useQuery({
    ...orpc.localAccounts.list.queryOptions(),
    enabled: active
  })

  if (!active) {
    return null
  }

  return (
    <div className="space-y-6">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className={SECTION_CLASS_NAME}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.subscriptions.title")}
            </h2>
            <p className="text-sm leading-5 text-muted-foreground">
              {t("settings.subscriptions.description")}
            </p>
          </div>
          <Switch
            aria-label={t("settings.subscriptions.discovery")}
            isSelected={localAccounts.discovery}
            onChange={(discovery) =>
              onLocalAccountsChange({ ...localAccounts, discovery })
            }
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </motion.section>

      {accounts.data?.discovery === false ? (
        <p className="px-1 text-sm text-muted-foreground">
          {t("settings.subscriptions.off")}
        </p>
      ) : null}
      {accounts.isPending ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : null}
      {accounts.data?.accounts.map((account) => (
        <motion.div {...settingsPageSectionMotion(0.25)} key={account.id}>
          <AccountCard account={account} />
        </motion.div>
      ))}
      {accounts.data?.discovery ? (
        <motion.div {...settingsPageSectionMotion(0.35)}>
          <AgentTuningSection />
        </motion.div>
      ) : null}
    </div>
  )
}
