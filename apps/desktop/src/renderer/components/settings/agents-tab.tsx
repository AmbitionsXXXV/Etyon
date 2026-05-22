import { useI18n } from "@etyon/i18n/react"
import type { AgentSettings } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Label, ListBox, NumberField, Select, Switch } from "@heroui/react"
import type { Key } from "@heroui/react"
import { motion } from "motion/react"
import { useCallback, useMemo } from "react"

import {
  AGENT_MAX_CONCURRENT_SUBAGENTS_MAX,
  AGENT_MAX_CONCURRENT_SUBAGENTS_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_PROFILE_OPTIONS,
  clampAgentMaxConcurrentSubagents,
  clampAgentMaxSteps,
  getAgentProfileOption
} from "@/renderer/lib/settings-page/agents-settings"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

interface AgentsTabProps {
  agents: AgentSettings
  onChange: (agents: AgentSettings) => void
}

interface AgentsSwitchRowProps {
  checked: boolean
  description: string
  isDisabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}

const AGENT_MODE_LABEL_KEYS = {
  coder: "settings.agents.executionMode.coder",
  generalist: "settings.agents.executionMode.generalist",
  operator: "settings.agents.executionMode.operator",
  plan: "settings.agents.executionMode.plan"
} as const

const AgentsSwitch = ({
  checked,
  isDisabled = false,
  label,
  onChange
}: {
  checked: boolean
  isDisabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch
    aria-label={label}
    isDisabled={isDisabled}
    isSelected={checked}
    onChange={onChange}
  >
    <Switch.Control>
      <Switch.Thumb />
    </Switch.Control>
  </Switch>
)

const AgentsSwitchRow = ({
  checked,
  description,
  isDisabled = false,
  label,
  onChange
}: AgentsSwitchRowProps) => (
  <div
    className={cn(
      "flex items-start justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-3",
      isDisabled && "opacity-60"
    )}
  >
    <div className="min-w-0 space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    </div>

    <AgentsSwitch
      checked={checked}
      isDisabled={isDisabled}
      label={label}
      onChange={onChange}
    />
  </div>
)

const AgentMetric = ({
  description,
  label,
  value
}: {
  description: string
  label: string
  value: string
}) => (
  <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
    <div className="text-[0.6875rem] font-medium tracking-normal text-muted-foreground uppercase">
      {label}
    </div>
    <div className="mt-1 text-lg leading-none font-semibold">{value}</div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      {description}
    </p>
  </div>
)

export const AgentsTab = ({ agents, onChange }: AgentsTabProps) => {
  const { t } = useI18n()
  const selectedProfile = useMemo(
    () => getAgentProfileOption(agents.defaultProfileId),
    [agents.defaultProfileId]
  )
  const activeBuiltInCount = AGENT_PROFILE_OPTIONS.length
  const delegationLinkCount = AGENT_PROFILE_OPTIONS.filter(
    (profile) => profile.executionMode === "coder" || profile.id === "plan"
  ).length

  const updateAgents = useCallback(
    (patch: Partial<AgentSettings>) => {
      onChange({
        ...agents,
        ...patch
      })
    },
    [agents, onChange]
  )

  const handleAllowSubagentDelegationChange = useCallback(
    (checked: boolean) => updateAgents({ allowSubagentDelegation: checked }),
    [updateAgents]
  )

  const handleDefaultProfileChange = useCallback(
    (profileId: Key | Key[] | null) => {
      if (!profileId || Array.isArray(profileId)) {
        return
      }

      updateAgents({ defaultProfileId: String(profileId) })
    },
    [updateAgents]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => updateAgents({ enabled: checked }),
    [updateAgents]
  )

  const handleMaxConcurrentSubagentsChange = useCallback(
    (value: number) =>
      updateAgents({
        maxConcurrentSubagents: clampAgentMaxConcurrentSubagents(value)
      }),
    [updateAgents]
  )

  const handleMaxStepsChange = useCallback(
    (value: number) => updateAgents({ maxSteps: clampAgentMaxSteps(value) }),
    [updateAgents]
  )

  const handleRequireApprovalForWritesChange = useCallback(
    (checked: boolean) => updateAgents({ requireApprovalForWrites: checked }),
    [updateAgents]
  )

  const handleShowToolTracesChange = useCallback(
    (checked: boolean) => updateAgents({ showToolTraces: checked }),
    [updateAgents]
  )

  return (
    <div className="space-y-8">
      <motion.section
        {...settingsPageSectionMotion(0.15)}
        className="space-y-5 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-3xl space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.agents.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.agents.description")}
            </p>
          </div>

          <AgentsSwitch
            checked={agents.enabled}
            label={t("settings.agents.control.enabled.label")}
            onChange={handleEnabledChange}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <AgentMetric
            description={t("settings.agents.metrics.active.description")}
            label={t("settings.agents.metrics.active.label")}
            value={String(activeBuiltInCount)}
          />
          <AgentMetric
            description={t("settings.agents.metrics.delegation.description")}
            label={t("settings.agents.metrics.delegation.label")}
            value={String(delegationLinkCount)}
          />
          <AgentMetric
            description={t("settings.agents.metrics.custom.description")}
            label={t("settings.agents.metrics.custom.label")}
            value={String(agents.profiles.length)}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <AgentsSwitchRow
            checked={agents.allowSubagentDelegation}
            description={t(
              "settings.agents.control.allowSubagentDelegation.description"
            )}
            isDisabled={!agents.enabled}
            label={t("settings.agents.control.allowSubagentDelegation.label")}
            onChange={handleAllowSubagentDelegationChange}
          />
          <AgentsSwitchRow
            checked={agents.requireApprovalForWrites}
            description={t(
              "settings.agents.control.requireApprovalForWrites.description"
            )}
            isDisabled={!agents.enabled}
            label={t("settings.agents.control.requireApprovalForWrites.label")}
            onChange={handleRequireApprovalForWritesChange}
          />
          <AgentsSwitchRow
            checked={agents.showToolTraces}
            description={t(
              "settings.agents.control.showToolTraces.description"
            )}
            isDisabled={!agents.enabled}
            label={t("settings.agents.control.showToolTraces.label")}
            onChange={handleShowToolTracesChange}
          />
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.25)}
        className="grid gap-5 rounded-lg border border-border bg-card p-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.agents.roster.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.agents.roster.description")}
            </p>
          </div>

          <div className="grid gap-2">
            {AGENT_PROFILE_OPTIONS.map((profile) => (
              <button
                aria-pressed={agents.defaultProfileId === profile.id}
                className={cn(
                  "min-h-19 rounded-lg border border-border bg-background/60 px-3 py-2 text-left transition-colors hover:bg-background",
                  agents.defaultProfileId === profile.id &&
                    "border-primary/70 bg-primary/10"
                )}
                key={profile.id}
                onClick={() => updateAgents({ defaultProfileId: profile.id })}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-medium">
                    {t(profile.nameKey)}
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
                    {t(AGENT_MODE_LABEL_KEYS[profile.executionMode])}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {t(profile.descriptionKey)}
                </p>
                <div className="mt-1 text-[0.6875rem] text-muted-foreground">
                  {profile.readonly
                    ? t("settings.agents.roster.readonly")
                    : t("settings.agents.roster.writeCapable")}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-2">
            <Select
              isDisabled={!agents.enabled}
              onChange={handleDefaultProfileChange}
              value={agents.defaultProfileId}
            >
              <Label className="text-xs font-medium text-muted-foreground">
                {t("settings.agents.defaults.profile.label")}
              </Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {AGENT_PROFILE_OPTIONS.map((profile) => (
                    <ListBox.Item
                      id={profile.id}
                      key={profile.id}
                      textValue={t(profile.nameKey)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {t(profile.nameKey)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {t(profile.descriptionKey)}
                        </div>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <NumberField
              isDisabled={!agents.enabled}
              maxValue={AGENT_MAX_STEPS_MAX}
              minValue={AGENT_MAX_STEPS_MIN}
              onChange={handleMaxStepsChange}
              value={agents.maxSteps}
            >
              <Label className="text-xs font-medium text-muted-foreground">
                {t("settings.agents.defaults.maxSteps.label")}
              </Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="text-center" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>

            <NumberField
              isDisabled={!agents.enabled || !agents.allowSubagentDelegation}
              maxValue={AGENT_MAX_CONCURRENT_SUBAGENTS_MAX}
              minValue={AGENT_MAX_CONCURRENT_SUBAGENTS_MIN}
              onChange={handleMaxConcurrentSubagentsChange}
              value={agents.maxConcurrentSubagents}
            >
              <Label className="text-xs font-medium text-muted-foreground">
                {t("settings.agents.defaults.maxConcurrentSubagents.label")}
              </Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="text-center" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="text-xs font-medium text-muted-foreground">
              {t("settings.agents.preview.title")}
            </div>
            <div className="mt-2 text-sm font-semibold">
              {t(selectedProfile.nameKey)}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t(selectedProfile.descriptionKey)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedProfile.focusAreaKeys.map((key) => (
                <span
                  className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground"
                  key={key}
                >
                  {t(key)}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t("settings.agents.preview.description")}
            </p>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
