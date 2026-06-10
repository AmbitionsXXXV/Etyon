import { useI18n } from "@etyon/i18n/react"
import type { AgentSettings } from "@etyon/rpc"
import { Label, NumberField, Switch } from "@heroui/react"
import { motion } from "motion/react"
import { useCallback } from "react"

import {
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  clampAgentMaxSteps
} from "@/renderer/lib/settings-page/agents-settings"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface AgentsTabProps {
  agents: AgentSettings
  onChange: (agents: AgentSettings) => void
}

export const AgentsTab = ({ agents, onChange }: AgentsTabProps) => {
  const { t } = useI18n()

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      onChange({
        ...agents,
        enabled
      })
    },
    [agents, onChange]
  )

  const handleMaxStepsChange = useCallback(
    (value: number) => {
      if (Number.isNaN(value)) {
        return
      }

      onChange({
        ...agents,
        maxSteps: clampAgentMaxSteps(value)
      })
    },
    [agents, onChange]
  )

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div>
          <h2 className="text-sm font-semibold">
            {t("settings.agents.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.agents.description")}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t("settings.agents.control.enabled.label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.agents.control.enabled.description")}
            </p>
          </div>
          <Switch
            aria-label={t("settings.agents.control.enabled.label")}
            isSelected={agents.enabled}
            onChange={handleEnabledChange}
          >
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label className="text-sm font-medium">
            {t("settings.agents.defaults.maxSteps.label")}
          </Label>
          <NumberField
            aria-label={t("settings.agents.defaults.maxSteps.label")}
            className="w-28"
            isDisabled={!agents.enabled}
            maxValue={AGENT_MAX_STEPS_MAX}
            minValue={AGENT_MAX_STEPS_MIN}
            onChange={handleMaxStepsChange}
            value={agents.maxSteps}
          >
            <NumberField.Group>
              <NumberField.Input />
            </NumberField.Group>
          </NumberField>
        </div>
      </motion.section>
    </div>
  )
}
