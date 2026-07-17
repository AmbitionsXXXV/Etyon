import type { TranslationKey } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type { AgentProfile, AgentSettings } from "@etyon/rpc"
import { Label, ListBox, NumberField, Select, Switch } from "@heroui/react"
import type { Key } from "@heroui/react"
import { motion } from "motion/react"
import { useCallback, useMemo } from "react"

import {
  AGENT_CONCURRENT_SUBAGENTS_MAX,
  AGENT_CONCURRENT_SUBAGENTS_MIN,
  clampConcurrentSubagents,
  getAgentProfileMetrics,
  setAgentProfileAvailability
} from "@/renderer/lib/settings-page/agents-settings"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"
import {
  PERMISSION_MODES,
  isAgentPermissionMode
} from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import {
  resolveActiveProfile,
  resolveProfileRoster
} from "@/shared/agents/profiles"

interface AgentsTabProps {
  agents: AgentSettings
  onChange: (agents: AgentSettings) => void
}

type Translate = ReturnType<typeof useI18n>["t"]

/** Literal translation keys for each built-in profile (the `t` fn rejects
 * dynamically-built keys), keyed by stable profile id. */
const BUILT_IN_PROFILE_LABEL_KEYS: Record<
  string,
  { description: TranslationKey; name: TranslationKey }
> = {
  coder: {
    description: "settings.agents.profiles.coder.description",
    name: "settings.agents.profiles.coder.name"
  },
  explore: {
    description: "settings.agents.profiles.explore.description",
    name: "settings.agents.profiles.explore.name"
  },
  "general-purpose": {
    description: "settings.agents.profiles.generalPurpose.description",
    name: "settings.agents.profiles.generalPurpose.name"
  },
  "harness-operator": {
    description: "settings.agents.profiles.harnessOperator.description",
    name: "settings.agents.profiles.harnessOperator.name"
  },
  plan: {
    description: "settings.agents.profiles.plan.description",
    name: "settings.agents.profiles.plan.name"
  },
  review: {
    description: "settings.agents.profiles.review.description",
    name: "settings.agents.profiles.review.name"
  }
}

/** Literal option labels for each permission mode (the `t` fn rejects
 * dynamically-built keys), keyed by mode. */
const PERMISSION_MODE_OPTION_LABEL_KEYS: Record<
  AgentPermissionMode,
  TranslationKey
> = {
  acceptEdits: "settings.agents.control.permissionMode.option.acceptEdits",
  bypass: "settings.agents.control.permissionMode.option.bypass",
  default: "settings.agents.control.permissionMode.option.default"
}

const localizedProfileName = (t: Translate, profile: AgentProfile): string => {
  const keys = BUILT_IN_PROFILE_LABEL_KEYS[profile.id]

  return keys ? t(keys.name) : profile.name
}

const localizedProfileDescription = (
  t: Translate,
  profile: AgentProfile
): string => {
  const keys = BUILT_IN_PROFILE_LABEL_KEYS[profile.id]

  return keys ? t(keys.description) : profile.description
}

const MetricCard = ({
  description,
  label,
  value
}: {
  description: string
  label: string
  value: number
}) => (
  <div className="rounded-lg border border-border bg-background p-3">
    <p className="text-2xl font-semibold tabular-nums">{value}</p>
    <p className="mt-1 text-xs font-medium">{label}</p>
    <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
  </div>
)

const ProfileRosterRow = ({
  description,
  isDisabled,
  name,
  onAvailableChange,
  profile
}: {
  description: string
  isDisabled: boolean
  name: string
  onAvailableChange: (available: boolean) => void
  profile: AgentProfile
}) => {
  const { t } = useI18n()

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {profile.readonly
              ? t("settings.agents.roster.readonly")
              : t("settings.agents.roster.writeCapable")}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        aria-label={name}
        isDisabled={isDisabled}
        isSelected={profile.available}
        onChange={onAvailableChange}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  )
}

export const AgentsTab = ({ agents, onChange }: AgentsTabProps) => {
  const { t } = useI18n()

  const roster = useMemo(() => resolveProfileRoster(agents), [agents])
  const metrics = useMemo(() => getAgentProfileMetrics(agents), [agents])
  const activeProfileId = useMemo(
    () => resolveActiveProfile(agents).id,
    [agents]
  )
  const activeProfile = roster.find((profile) => profile.id === activeProfileId)
  const availableProfiles = useMemo(
    () => roster.filter((profile) => profile.available),
    [roster]
  )

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      onChange({ ...agents, enabled })
    },
    [agents, onChange]
  )

  const handleAutoLoadWorkspaceRulesChange = useCallback(
    (autoLoadWorkspaceRules: boolean) => {
      onChange({ ...agents, autoLoadWorkspaceRules })
    },
    [agents, onChange]
  )

  const handleDefaultProfileChange = useCallback(
    (next: Key | Key[] | null) => {
      if (typeof next !== "string") {
        return
      }

      onChange({ ...agents, defaultProfileId: next })
    },
    [agents, onChange]
  )

  const handleProfileAvailableChange = useCallback(
    (profile: AgentProfile, available: boolean) => {
      onChange({
        ...agents,
        profiles: setAgentProfileAvailability(agents, profile, available)
      })
    },
    [agents, onChange]
  )

  const handleAllowDelegationChange = useCallback(
    (allowSubagentDelegation: boolean) => {
      onChange({ ...agents, allowSubagentDelegation })
    },
    [agents, onChange]
  )

  const handleConcurrentSubagentsChange = useCallback(
    (value: number) => {
      if (Number.isNaN(value)) {
        return
      }

      onChange({
        ...agents,
        maxConcurrentSubagents: clampConcurrentSubagents(value)
      })
    },
    [agents, onChange]
  )

  const handlePermissionModeChange = useCallback(
    (next: Key | Key[] | null) => {
      if (!isAgentPermissionMode(next)) {
        return
      }

      onChange({ ...agents, defaultPermissionMode: next })
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
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t("settings.agents.autoLoadWorkspaceRules.label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.agents.autoLoadWorkspaceRules.description")}
            </p>
          </div>
          <Switch
            aria-label={t("settings.agents.autoLoadWorkspaceRules.label")}
            isDisabled={!agents.enabled}
            isSelected={agents.autoLoadWorkspaceRules}
            onChange={handleAutoLoadWorkspaceRulesChange}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(1)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div>
          <h2 className="text-sm font-semibold">
            {t("settings.agents.roster.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.agents.roster.description")}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            description={t("settings.agents.metrics.active.description")}
            label={t("settings.agents.metrics.active.label")}
            value={metrics.active}
          />
          <MetricCard
            description={t("settings.agents.metrics.custom.description")}
            label={t("settings.agents.metrics.custom.label")}
            value={metrics.custom}
          />
          <MetricCard
            description={t("settings.agents.metrics.delegation.description")}
            label={t("settings.agents.metrics.delegation.label")}
            value={metrics.delegation}
          />
        </div>

        <Select
          className="max-w-xl"
          fullWidth
          isDisabled={!agents.enabled}
          onChange={handleDefaultProfileChange}
          value={agents.defaultProfileId}
          variant="primary"
        >
          <Label className="text-xs font-medium text-muted-foreground">
            {t("settings.agents.defaults.profile.label")}
          </Label>
          <Select.Trigger className="border border-border bg-background">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="border border-border/80 bg-popover shadow-overlay">
            <ListBox>
              {availableProfiles.map((profile) => (
                <ListBox.Item
                  id={profile.id}
                  key={profile.id}
                  textValue={localizedProfileName(t, profile)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {localizedProfileName(t, profile)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {localizedProfileDescription(t, profile)}
                    </div>
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <div className="space-y-2">
          {roster.map((profile) => (
            <ProfileRosterRow
              description={localizedProfileDescription(t, profile)}
              isDisabled={!agents.enabled}
              key={profile.id}
              name={localizedProfileName(t, profile)}
              onAvailableChange={(available) =>
                handleProfileAvailableChange(profile, available)
              }
              profile={profile}
            />
          ))}
        </div>

        {activeProfile ? (
          <div className="rounded-lg border border-border/70 bg-background p-3">
            <p className="text-xs font-semibold">
              {t("settings.agents.preview.title")}
            </p>
            <p className="mt-1 text-sm font-medium">
              {localizedProfileName(t, activeProfile)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {localizedProfileDescription(t, activeProfile)}
            </p>
          </div>
        ) : null}
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(2)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t("settings.agents.control.permissionMode.label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.agents.control.permissionMode.description")}
            </p>
          </div>
          <Select
            className="max-w-xl"
            fullWidth
            isDisabled={!agents.enabled}
            onChange={handlePermissionModeChange}
            value={agents.defaultPermissionMode}
            variant="primary"
          >
            <Label className="sr-only">
              {t("settings.agents.control.permissionMode.label")}
            </Label>
            <Select.Trigger className="border border-border bg-background">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="border border-border/80 bg-popover shadow-overlay">
              <ListBox>
                {PERMISSION_MODES.map((mode) => (
                  <ListBox.Item
                    id={mode}
                    key={mode}
                    textValue={t(PERMISSION_MODE_OPTION_LABEL_KEYS[mode])}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {t(PERMISSION_MODE_OPTION_LABEL_KEYS[mode])}
                      </div>
                    </div>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t("settings.agents.control.allowSubagentDelegation.label")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.agents.control.allowSubagentDelegation.description")}
            </p>
          </div>
          <Switch
            aria-label={t(
              "settings.agents.control.allowSubagentDelegation.label"
            )}
            isDisabled={!agents.enabled}
            isSelected={agents.allowSubagentDelegation}
            onChange={handleAllowDelegationChange}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label className="text-sm font-medium">
            {t("settings.agents.defaults.maxConcurrentSubagents.label")}
          </Label>
          <NumberField
            aria-label={t(
              "settings.agents.defaults.maxConcurrentSubagents.label"
            )}
            className="w-28"
            isDisabled={!(agents.enabled && agents.allowSubagentDelegation)}
            maxValue={AGENT_CONCURRENT_SUBAGENTS_MAX}
            minValue={AGENT_CONCURRENT_SUBAGENTS_MIN}
            onChange={handleConcurrentSubagentsChange}
            value={agents.maxConcurrentSubagents}
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
