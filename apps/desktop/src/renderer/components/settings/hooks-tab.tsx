import type { HookConfigStatus } from "@etyon/rpc/schemas/hooks"
import { ScrollShadow, Switch } from "@heroui/react"

const DEFAULT_HOOK_LABELS = {
  description: "在工具执行前后和会话结束时运行本地脚本。",
  empty: "当前没有配置 Hooks。",
  enabled: "启用 Hooks",
  title: "Hooks"
}

export const HooksTab = ({
  configs,
  enabled,
  labels = DEFAULT_HOOK_LABELS,
  onEnabledChange
}: {
  configs: HookConfigStatus[]
  enabled: boolean
  labels?: {
    description: string
    empty: string
    enabled: string
    title: string
  }
  onEnabledChange: (enabled: boolean) => void
}) => (
  <section
    aria-label={labels.title}
    className="flex min-h-0 flex-col gap-4 rounded-lg border border-border bg-card p-5"
  >
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{labels.title}</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {labels.description}
        </p>
      </div>
      <Switch
        aria-label={labels.enabled}
        isSelected={enabled}
        onChange={onEnabledChange}
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    </div>
    <ScrollShadow className="max-h-[50vh] min-h-0 space-y-3">
      {configs.every(
        (config) => config.hooks.length === 0 && !config.error
      ) && <p className="text-xs text-muted-foreground">{labels.empty}</p>}
      {configs.map((config) => (
        <article
          className="space-y-2 rounded-lg border border-border p-3"
          key={config.path}
        >
          <p className="text-xs break-all text-muted-foreground">
            {config.path}
          </p>
          {config.error && (
            <p className="text-xs text-danger" role="alert">
              {config.error}
            </p>
          )}
          {config.hooks.map((hook, index) => (
            <div
              className="space-y-1 rounded-md bg-muted/40 p-2"
              key={`${hook.event}-${index}`}
            >
              <p className="text-xs font-medium">
                {hook.event} · {hook.matcher} · {hook.timeoutMs} ms
              </p>
              <pre className="text-[0.625rem] break-all whitespace-pre-wrap">
                {hook.command}
              </pre>
            </div>
          ))}
        </article>
      ))}
    </ScrollShadow>
  </section>
)
