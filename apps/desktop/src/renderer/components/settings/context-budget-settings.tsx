import { useI18n } from "@etyon/i18n/react"
import type { AgentSettings } from "@etyon/rpc"
import { Label, NumberField } from "@heroui/react"

export const ContextBudgetSettings = ({
  agents,
  onChange
}: {
  agents: AgentSettings
  onChange: (value: AgentSettings) => void
}) => {
  const { t } = useI18n()
  const update = (
    field: "maxInputTokens" | "reserveOutputTokens",
    value: number
  ): void => {
    if (Number.isFinite(value)) {
      onChange({
        ...agents,
        contextBudget: { ...agents.contextBudget, [field]: Math.trunc(value) }
      })
    }
  }
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">
        {t("settings.agents.contextBudget.title")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.contextBudget.description")}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          minValue={1024}
          maxValue={2_000_000}
          onChange={(value) => update("maxInputTokens", value)}
          value={agents.contextBudget.maxInputTokens}
        >
          <Label>{t("settings.agents.contextBudget.input")}</Label>
          <NumberField.Group>
            <NumberField.Input />
          </NumberField.Group>
        </NumberField>
        <NumberField
          minValue={256}
          maxValue={64_000}
          onChange={(value) => update("reserveOutputTokens", value)}
          value={agents.contextBudget.reserveOutputTokens}
        >
          <Label>{t("settings.agents.contextBudget.output")}</Label>
          <NumberField.Group>
            <NumberField.Input />
          </NumberField.Group>
        </NumberField>
      </div>
    </section>
  )
}
