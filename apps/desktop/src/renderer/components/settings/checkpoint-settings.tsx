import { useI18n } from "@etyon/i18n/react"
import type { AgentSettings } from "@etyon/rpc"
import { Label, NumberField } from "@heroui/react"

export const CheckpointSettings = ({
  agents,
  onChange
}: {
  agents: AgentSettings
  onChange: (value: AgentSettings) => void
}) => {
  const { t } = useI18n()
  const update = (field: "maxAgeDays" | "maxTotalMb", value: number): void => {
    if (!Number.isFinite(value)) {
      return
    }
    onChange({
      ...agents,
      checkpoints: { ...agents.checkpoints, [field]: Math.trunc(value) }
    })
  }
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">
        {t("settings.agents.checkpoints.title")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.checkpoints.description")}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          minValue={1}
          maxValue={365}
          value={agents.checkpoints.maxAgeDays}
          onChange={(value) => update("maxAgeDays", value)}
        >
          <Label>{t("settings.agents.checkpoints.days")}</Label>
          <NumberField.Group>
            <NumberField.Input />
          </NumberField.Group>
        </NumberField>
        <NumberField
          minValue={16}
          maxValue={8192}
          value={agents.checkpoints.maxTotalMb}
          onChange={(value) => update("maxTotalMb", value)}
        >
          <Label>{t("settings.agents.checkpoints.storage")}</Label>
          <NumberField.Group>
            <NumberField.Input />
          </NumberField.Group>
        </NumberField>
      </div>
    </section>
  )
}
