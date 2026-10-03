import { useI18n } from "@etyon/i18n/react"
import type { AgentSettings } from "@etyon/rpc"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { HooksTab } from "@/renderer/components/settings/hooks-tab"
import { orpc } from "@/renderer/lib/rpc"

export const HooksSettings = ({
  agents,
  onChange
}: {
  agents: AgentSettings
  onChange: (value: AgentSettings) => void
}) => {
  const { t } = useI18n()
  const [sessionId, setSessionId] = useState("")
  const sessions = useQuery(orpc.chatSessions.list.queryOptions({}))
  const configs = useQuery(
    orpc.hooks.list.queryOptions({
      input: sessionId ? { sessionId } : {},
      refetchInterval: 10_000
    })
  )
  const projects = [
    ...new Map(
      (sessions.data ?? []).map((session) => [session.projectPath, session])
    ).values()
  ]
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 text-xs">
        <span>{t("settings.agents.hooks.scope")}</span>
        <select
          className="min-w-0 flex-1 rounded-md border border-border bg-background p-2"
          onChange={(event) => setSessionId(event.target.value)}
          value={sessionId}
        >
          <option value="">{t("settings.agents.hooks.global")}</option>
          {projects.map((session) => (
            <option key={session.id} value={session.id}>
              {session.projectPath}
            </option>
          ))}
        </select>
      </label>
      {configs.error && (
        <p className="text-xs text-danger" role="alert">
          {configs.error.message}
        </p>
      )}
      <HooksTab
        configs={configs.data?.configs ?? []}
        enabled={agents.hooks.enabled}
        labels={{
          description: t("settings.agents.hooks.description"),
          empty: t("settings.agents.hooks.empty"),
          enabled: t("settings.agents.hooks.enabled"),
          title: t("settings.agents.hooks.title")
        }}
        onEnabledChange={(enabled) =>
          onChange({ ...agents, hooks: { enabled } })
        }
      />
    </div>
  )
}
