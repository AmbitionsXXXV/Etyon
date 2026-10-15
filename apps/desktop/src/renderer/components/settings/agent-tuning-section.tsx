import { useI18n } from "@etyon/i18n/react"
import type { AgentTuningRow } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Skeleton } from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { MOTION_TRANSITION_FAST_CLASS } from "@/renderer/lib/motion"
import { orpc, rpcClient } from "@/renderer/lib/rpc"

const RANGE_OPTIONS = [
  { days: 1, labelKey: "settings.subscriptions.tuning.range.today" },
  { days: 7, labelKey: "settings.subscriptions.tuning.range.week" },
  { days: 30, labelKey: "settings.subscriptions.tuning.range.month" }
] as const

const AGENT_NAME_KEY = {
  "claude-code": "settings.subscriptions.account.claudeCode",
  codex: "settings.subscriptions.account.codex"
} as const

const THOUSAND = 1000
const MILLION = 1_000_000
const PERCENT = 100

/** 340000 → "340K", 1000000 → "1M". */
const formatTokens = (value: number): string => {
  if (value >= MILLION) {
    return `${Math.round((value / MILLION) * 10) / 10}M`
  }
  return value >= THOUSAND ? `${Math.round(value / THOUSAND)}K` : String(value)
}

const useSourceNote = () => {
  const { t } = useI18n()

  return (row: AgentTuningRow): string => {
    const { setting } = row
    if (setting.lockedBy) {
      return t("settings.subscriptions.tuning.source.locked", {
        variable: setting.lockedBy
      })
    }
    if (setting.isOurs) {
      return t("settings.subscriptions.tuning.source.ours")
    }
    if (setting.value !== null) {
      return t("settings.subscriptions.tuning.source.user", {
        file: row.file,
        value: formatTokens(setting.value)
      })
    }
    return t("settings.subscriptions.tuning.source.default")
  }
}

const TuningRow = ({ days, row }: { days: number; row: AgentTuningRow }) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const getSourceNote = useSourceNote()
  const { advice, setting } = row
  const tuningKey = orpc.agentTuning.get.queryOptions({
    input: { days }
  }).queryKey
  const refresh = () => queryClient.invalidateQueries({ queryKey: tuningKey })
  const apply = useMutation({
    mutationFn: (value: number) =>
      rpcClient.agentTuning.apply({
        agent: row.agent,
        model: row.model,
        value
      }),
    onSettled: refresh
  })
  const undo = useMutation({
    mutationFn: () =>
      rpcClient.agentTuning.undo({ agent: row.agent, model: row.model }),
    onSettled: refresh
  })
  const isChange =
    advice !== null &&
    advice.best !== advice.current &&
    setting.value !== advice.best
  const error = apply.error ?? undo.error

  return (
    <article className="space-y-3 rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t(AGENT_NAME_KEY[row.agent])}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {row.model}
          </span>
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("settings.subscriptions.tuning.calls", { count: row.calls })}
        </span>
      </div>

      {advice ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              {t("settings.subscriptions.tuning.now", {
                value: formatTokens(advice.current)
              })}
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <span className="font-medium">
              {t("settings.subscriptions.tuning.best", {
                value: formatTokens(advice.best)
              })}
            </span>
            {advice.saving > 0 ? (
              <span className="rounded-md bg-success-soft px-1.5 text-xs font-medium text-success-soft-foreground">
                {t("settings.subscriptions.tuning.saving", {
                  percent: Math.round(advice.saving * PERCENT)
                })}
              </span>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.subscriptions.tuning.explain", {
              after: formatTokens(advice.after),
              compactsBest: advice.compactsBest,
              compactsNow: advice.compactsNow,
              growth: formatTokens(advice.growth)
            })}
          </p>
        </>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.subscriptions.tuning.tooFew")}
        </p>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        {getSourceNote(row)}
        {row.agent === "codex"
          ? ` ${t("settings.subscriptions.tuning.codexShared")}`
          : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {advice && isChange ? (
          <Button
            isDisabled={setting.lockedBy !== null || apply.isPending}
            onPress={() => apply.mutate(advice.best)}
            size="sm"
          >
            {t("settings.subscriptions.tuning.use", {
              value: formatTokens(advice.best)
            })}
          </Button>
        ) : null}
        {setting.isOurs ? (
          <Button
            isDisabled={undo.isPending}
            onPress={() => undo.mutate()}
            size="sm"
            variant="ghost"
          >
            {t("settings.subscriptions.tuning.undo")}
          </Button>
        ) : null}
        {apply.isSuccess ? (
          <span className="text-xs text-success">
            {t("settings.subscriptions.tuning.saved")}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error.message}
        </p>
      ) : null}
    </article>
  )
}

/**
 * "Tuned for you": the auto-compact window that would have cost Claude Code
 * and Codex the fewest tokens, replayed from their own session files.
 */
export const AgentTuningSection = () => {
  const { t } = useI18n()
  const [days, setDays] = useState(7)
  const tuning = useQuery(
    orpc.agentTuning.get.queryOptions({ input: { days } })
  )

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">
            {t("settings.subscriptions.tuning.title")}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {t("settings.subscriptions.tuning.description")}
          </p>
        </div>
        <fieldset className="inline-flex gap-0.5 rounded-xl border border-border bg-background p-1">
          <legend className="sr-only">
            {t("settings.subscriptions.tuning.range.label")}
          </legend>
          {RANGE_OPTIONS.map((option) => (
            <button
              aria-pressed={days === option.days}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs",
                MOTION_TRANSITION_FAST_CLASS,
                days === option.days
                  ? "bg-default font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              key={option.days}
              onClick={() => setDays(option.days)}
              type="button"
            >
              {t(option.labelKey)}
            </button>
          ))}
        </fieldset>
      </div>

      {tuning.isPending ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : null}
      {tuning.error ? (
        <p className="text-xs text-danger" role="alert">
          {tuning.error.message}
        </p>
      ) : null}
      {tuning.data?.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.subscriptions.tuning.empty")}
        </p>
      ) : null}
      <div className="space-y-3">
        {tuning.data?.rows.map((row) => (
          <TuningRow days={days} key={`${row.agent}:${row.model}`} row={row} />
        ))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("settings.subscriptions.tuning.caveat")}
      </p>
    </section>
  )
}
