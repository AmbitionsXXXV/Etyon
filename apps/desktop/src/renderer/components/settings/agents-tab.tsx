import { useI18n } from "@etyon/i18n/react"
import type { AgentProfile, AgentSettings } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import {
  Button,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Switch,
  TextArea
} from "@heroui/react"
import type { Key } from "@heroui/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useCallback, useMemo } from "react"

import { orpc } from "@/renderer/lib/rpc"
import { buildAgentApprovalInboxItem } from "@/renderer/lib/settings-page/agent-approval-inbox"
import {
  removeAgentProfileOverride,
  resolveAgentProfileDraft,
  upsertAgentProfileOverride
} from "@/renderer/lib/settings-page/agent-profile-overrides"
import {
  AGENT_MAX_AUTOMATIC_RETRIES_MAX,
  AGENT_MAX_AUTOMATIC_RETRIES_MIN,
  AGENT_MAX_CONCURRENT_SUBAGENTS_MAX,
  AGENT_MAX_CONCURRENT_SUBAGENTS_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_PROFILE_OPTIONS,
  clampAgentMaxAutomaticRetries,
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

const AGENT_PROFILE_FIELD_CLASS_NAME =
  "border-border bg-background/70 shadow-none"

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
  const selectedProfileDefaults = useMemo(
    () =>
      ({
        allowedDelegateProfileIds: [],
        available: true,
        description: t(selectedProfile.descriptionKey),
        executionMode: selectedProfile.executionMode,
        focusAreas: selectedProfile.focusAreaKeys.map((key) => t(key)),
        id: selectedProfile.id,
        instructions: "",
        name: t(selectedProfile.nameKey),
        preferredModel: "",
        readonly: selectedProfile.readonly
      }) satisfies AgentProfile,
    [selectedProfile, t]
  )
  const selectedProfileDraft = useMemo(
    () => resolveAgentProfileDraft(agents, selectedProfileDefaults),
    [agents, selectedProfileDefaults]
  )
  const hasSelectedProfileOverride = agents.profiles.some(
    (profile) => profile.id === selectedProfile.id
  )
  const approvalInboxQuery = useQuery(
    orpc.agents.listPendingApprovals.queryOptions({
      input: {}
    })
  )
  const activeBuiltInCount = AGENT_PROFILE_OPTIONS.length
  const approvalInboxItems = useMemo(
    () =>
      (approvalInboxQuery.data?.approvals ?? []).map((approval) =>
        buildAgentApprovalInboxItem(approval)
      ),
    [approvalInboxQuery.data?.approvals]
  )
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

  const handleMaxAutomaticRetriesChange = useCallback(
    (value: number) =>
      updateAgents({
        retry: {
          ...agents.retry,
          maxAutomaticRetries: clampAgentMaxAutomaticRetries(value)
        }
      }),
    [agents.retry, updateAgents]
  )

  const handleResetSelectedProfileOverride = useCallback(
    () =>
      onChange(
        removeAgentProfileOverride({
          agents,
          profileId: selectedProfile.id
        })
      ),
    [agents, onChange, selectedProfile.id]
  )

  const handleShowToolTracesChange = useCallback(
    (checked: boolean) => updateAgents({ showToolTraces: checked }),
    [updateAgents]
  )

  const handleRefreshApprovalInbox = useCallback(() => {
    void approvalInboxQuery.refetch()
  }, [approvalInboxQuery])

  const handleRetryTransientFailuresChange = useCallback(
    (checked: boolean) =>
      updateAgents({
        retry: {
          ...agents.retry,
          retryTransientFailures: checked
        }
      }),
    [agents.retry, updateAgents]
  )

  const updateSelectedProfileOverride = useCallback(
    (patch: Partial<AgentProfile>) =>
      onChange(
        upsertAgentProfileOverride({
          agents,
          defaults: selectedProfileDefaults,
          patch
        })
      ),
    [agents, onChange, selectedProfileDefaults]
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
            checked={agents.showToolTraces}
            description={t(
              "settings.agents.control.showToolTraces.description"
            )}
            isDisabled={!agents.enabled}
            label={t("settings.agents.control.showToolTraces.label")}
            onChange={handleShowToolTracesChange}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,18rem)]">
          <AgentsSwitchRow
            checked={agents.retry.retryTransientFailures}
            description={t(
              "settings.agents.control.retryTransientFailures.description"
            )}
            isDisabled={!agents.enabled}
            label={t("settings.agents.control.retryTransientFailures.label")}
            onChange={handleRetryTransientFailuresChange}
          />
          <div
            className={cn(
              "rounded-lg border border-border bg-background/60 px-3 py-3",
              (!agents.enabled || !agents.retry.retryTransientFailures) &&
                "opacity-60"
            )}
          >
            <NumberField
              isDisabled={
                !agents.enabled || !agents.retry.retryTransientFailures
              }
              maxValue={AGENT_MAX_AUTOMATIC_RETRIES_MAX}
              minValue={AGENT_MAX_AUTOMATIC_RETRIES_MIN}
              onChange={handleMaxAutomaticRetriesChange}
              value={agents.retry.maxAutomaticRetries}
            >
              <Label className="text-xs font-medium text-muted-foreground">
                {t("settings.agents.defaults.maxAutomaticRetries.label")}
              </Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="text-center" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {t("settings.agents.defaults.maxAutomaticRetries.description")}
            </p>
          </div>
        </div>
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.22)}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {t("settings.agents.approvals.title")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.agents.approvals.description")}
            </p>
          </div>
          <Button
            isDisabled={approvalInboxQuery.isFetching}
            onPress={handleRefreshApprovalInbox}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("settings.agents.approvals.refresh")}
          </Button>
        </div>

        {approvalInboxQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.agents.approvals.loading")}
          </p>
        ) : null}

        {!approvalInboxQuery.isLoading && approvalInboxItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.agents.approvals.empty")}
          </p>
        ) : null}

        {approvalInboxItems.length > 0 ? (
          <div className="grid gap-2">
            {approvalInboxItems.map((item) => (
              <div
                className="rounded-lg border border-border bg-background/60 px-3 py-2"
                key={item.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {item.title}
                    </div>
                    {item.inputPreview ? (
                      <p className="mt-1 line-clamp-2 font-mono text-[0.6875rem] wrap-break-word text-muted-foreground">
                        {item.inputPreview}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {item.meta.map((meta) => (
                      <span
                        className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
                        key={meta}
                      >
                        {meta}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </motion.section>

      <motion.section
        {...settingsPageSectionMotion(0.3)}
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

          <div className="space-y-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">
                  {t("settings.agents.editor.title")}
                </h3>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("settings.agents.editor.description")}
                </p>
              </div>
              <Button
                isDisabled={!hasSelectedProfileOverride}
                onPress={handleResetSelectedProfileOverride}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("settings.agents.editor.reset")}
              </Button>
            </div>

            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`agent-profile-${selectedProfile.id}-name`}
                >
                  {t("settings.agents.editor.fields.name.label")}
                </Label>
                <Input
                  className={AGENT_PROFILE_FIELD_CLASS_NAME}
                  disabled={!agents.enabled}
                  id={`agent-profile-${selectedProfile.id}-name`}
                  onChange={(event) =>
                    updateSelectedProfileOverride({
                      name: event.currentTarget.value
                    })
                  }
                  value={selectedProfileDraft.name}
                  variant="primary"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`agent-profile-${selectedProfile.id}-description`}
                >
                  {t("settings.agents.editor.fields.description.label")}
                </Label>
                <TextArea
                  className={AGENT_PROFILE_FIELD_CLASS_NAME}
                  disabled={!agents.enabled}
                  id={`agent-profile-${selectedProfile.id}-description`}
                  onChange={(event) =>
                    updateSelectedProfileOverride({
                      description: event.currentTarget.value
                    })
                  }
                  rows={3}
                  value={selectedProfileDraft.description}
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`agent-profile-${selectedProfile.id}-instructions`}
                >
                  {t("settings.agents.editor.fields.instructions.label")}
                </Label>
                <TextArea
                  className={AGENT_PROFILE_FIELD_CLASS_NAME}
                  disabled={!agents.enabled}
                  id={`agent-profile-${selectedProfile.id}-instructions`}
                  onChange={(event) =>
                    updateSelectedProfileOverride({
                      instructions: event.currentTarget.value
                    })
                  }
                  placeholder={t(
                    "settings.agents.editor.fields.instructions.placeholder"
                  )}
                  rows={5}
                  value={selectedProfileDraft.instructions}
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md bg-background/50 py-2">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium">
                    {t("settings.agents.editor.fields.readonly.label")}
                  </div>
                  <p className="text-[0.6875rem] leading-5 text-muted-foreground">
                    {t("settings.agents.editor.fields.readonly.description")}
                  </p>
                </div>
                <AgentsSwitch
                  checked={selectedProfileDraft.readonly}
                  isDisabled={!agents.enabled}
                  label={t("settings.agents.editor.fields.readonly.label")}
                  onChange={(checked) =>
                    updateSelectedProfileOverride({ readonly: checked })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
