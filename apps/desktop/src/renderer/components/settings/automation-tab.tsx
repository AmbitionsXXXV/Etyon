import { useI18n } from "@etyon/i18n/react"
import type { AgentProfile, ChatSessionSummary } from "@etyon/rpc"
import { AutomationTaskDraftSchema } from "@etyon/rpc/schemas/automation"
import type {
  AutomationRun,
  AutomationTask,
  AutomationTaskDraft
} from "@etyon/rpc/schemas/automation"
import { ScrollArea } from "@etyon/ui/components/scroll-area"
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextArea,
  TextField
} from "@heroui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { SyntheticEvent } from "react"
import { useState } from "react"

import {
  createAutomationDraft,
  createAutomationSchedule,
  toAutomationDraft
} from "@/renderer/lib/automation/draft"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { resolveProfileRoster } from "@/shared/agents/profiles"

const AutomationChoice = ({
  label,
  onChange,
  options,
  value
}: {
  label: string
  onChange: (value: string) => void
  options: { id: string; label: string }[]
  value: string
}) => (
  <Select
    onChange={(key) => {
      if (typeof key === "string") {
        onChange(key)
      }
    }}
    value={value}
  >
    <Label>{label}</Label>
    <Select.Trigger>
      <Select.Value />
      <Select.Indicator />
    </Select.Trigger>
    <Select.Popover>
      <ListBox>
        {options.map((option) => (
          <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
            {option.label}
            <ListBox.ItemIndicator />
          </ListBox.Item>
        ))}
      </ListBox>
    </Select.Popover>
  </Select>
)

const AutomationToggle = ({
  isDisabled = false,
  label,
  onChange,
  value
}: {
  isDisabled?: boolean
  label: string
  onChange: (value: boolean) => void
  value: boolean
}) => (
  <Switch isDisabled={isDisabled} isSelected={value} onChange={onChange}>
    <Switch.Control>
      <Switch.Thumb />
    </Switch.Control>
    <Switch.Content>
      <Label>{label}</Label>
    </Switch.Content>
  </Switch>
)

const AutomationEditor = ({
  draft,
  isSaving,
  onCancel,
  onChange,
  onSave,
  profiles,
  sessions
}: {
  draft: AutomationTaskDraft
  isSaving: boolean
  onCancel: () => void
  onChange: (value: AutomationTaskDraft) => void
  onSave: () => void
  profiles: AgentProfile[]
  sessions: ChatSessionSummary[]
}) => {
  const { t } = useI18n({ keyPrefix: "settings.automation" })
  const { t: common } = useI18n()
  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSave()
  }
  const { schedule } = draft
  return (
    <Card>
      <Card.Header>
        <Card.Title>{draft.id ? t("edit") : t("add")}</Card.Title>
      </Card.Header>
      <Card.Content>
        <form className="space-y-4" onSubmit={submit}>
          <TextField
            isRequired
            onChange={(name) => onChange({ ...draft, name })}
            value={draft.name}
          >
            <Label>{t("name")}</Label>
            <Input maxLength={100} />
          </TextField>
          <AutomationChoice
            label={t("session")}
            onChange={(sessionId) => onChange({ ...draft, sessionId })}
            options={sessions.map((session) => ({
              id: session.id,
              label: session.title
            }))}
            value={draft.sessionId}
          />
          <TextField
            isRequired
            onChange={(prompt) => onChange({ ...draft, prompt })}
            value={draft.prompt}
          >
            <Label>{t("prompt")}</Label>
            <TextArea className="min-h-28" maxLength={32_000} />
          </TextField>
          <div className="grid grid-cols-2 gap-3">
            <AutomationChoice
              label={t("profile")}
              onChange={(profileId) =>
                onChange({
                  ...draft,
                  profileId: profileId === "default" ? null : profileId
                })
              }
              options={[
                { id: "default", label: t("defaultProfile") },
                ...profiles
                  .filter((profile) => profile.available)
                  .map((profile) => ({ id: profile.id, label: profile.name }))
              ]}
              value={draft.profileId ?? "default"}
            />
            <AutomationChoice
              label={t("permission")}
              onChange={(permissionMode) => {
                if (
                  permissionMode === "default" ||
                  permissionMode === "acceptEdits"
                ) {
                  onChange({ ...draft, permissionMode })
                }
              }}
              options={[
                { id: "default", label: t("permissionDefault") },
                { id: "acceptEdits", label: t("permissionAcceptEdits") }
              ]}
              value={draft.permissionMode}
            />
          </div>
          <TextField
            onChange={(modelId) =>
              onChange({ ...draft, modelId: modelId.trim() || null })
            }
            value={draft.modelId ?? ""}
          >
            <Label>{t("model")}</Label>
            <Input />
            <Description>{t("modelHint")}</Description>
          </TextField>
          <AutomationChoice
            label={t("schedule")}
            onChange={(kind) => {
              if (kind === "manual" || kind === "cron" || kind === "interval") {
                onChange({
                  ...draft,
                  enabled: kind !== "manual" && draft.enabled,
                  schedule: createAutomationSchedule(kind)
                })
              }
            }}
            options={[
              { id: "manual", label: t("scheduleManual") },
              { id: "interval", label: t("scheduleInterval") },
              { id: "cron", label: t("scheduleCron") }
            ]}
            value={schedule.kind}
          />
          {schedule.kind === "interval" ? (
            <TextField
              isRequired
              onChange={(value) =>
                onChange({
                  ...draft,
                  schedule: { ...schedule, minutes: Number(value) }
                })
              }
              value={String(schedule.minutes)}
            >
              <Label>{t("interval")}</Label>
              <Input max={525_600} min={1} step={1} type="number" />
            </TextField>
          ) : null}
          {schedule.kind === "cron" ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                isRequired
                onChange={(expression) =>
                  onChange({ ...draft, schedule: { ...schedule, expression } })
                }
                value={schedule.expression}
              >
                <Label>{t("cron")}</Label>
                <Input />
                <Description>{t("cronHint")}</Description>
              </TextField>
              <TextField
                isRequired
                onChange={(timeZone) =>
                  onChange({ ...draft, schedule: { ...schedule, timeZone } })
                }
                value={schedule.timeZone}
              >
                <Label>{t("timeZone")}</Label>
                <Input />
              </TextField>
            </div>
          ) : null}
          <TextField
            isRequired
            onChange={(value) =>
              onChange({ ...draft, timeoutMinutes: Number(value) })
            }
            value={String(draft.timeoutMinutes)}
          >
            <Label>{t("timeout")}</Label>
            <Input max={1440} min={1} step={1} type="number" />
          </TextField>
          <div className="flex flex-wrap gap-4">
            <AutomationToggle
              isDisabled={schedule.kind === "manual"}
              label={t("enabled")}
              onChange={(enabled) => onChange({ ...draft, enabled })}
              value={draft.enabled}
            />
            <AutomationToggle
              label={t("desktopNotification")}
              onChange={(notifyDesktop) =>
                onChange({ ...draft, notifyDesktop })
              }
              value={draft.notifyDesktop}
            />
            <AutomationToggle
              label={t("telegramNotification")}
              onChange={(notifyTelegram) =>
                onChange({ ...draft, notifyTelegram })
              }
              value={draft.notifyTelegram}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("telegramHint")}</p>
          <div className="flex gap-2">
            <Button
              isDisabled={
                isSaving ||
                !draft.sessionId ||
                !draft.name.trim() ||
                !draft.prompt.trim()
              }
              size="sm"
              type="submit"
            >
              {common("settings.common.save")}
            </Button>
            <Button
              isDisabled={isSaving}
              onPress={onCancel}
              size="sm"
              variant="ghost"
            >
              {common("settings.common.cancel")}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card>
  )
}

const AutomationTaskCard = ({
  isPending,
  onDelete,
  onEdit,
  onEnable,
  onOpen,
  onRun,
  run,
  task
}: {
  isPending: boolean
  onDelete: () => void
  onEdit: () => void
  onEnable: (enabled: boolean) => void
  onOpen: () => void
  onRun: () => void
  run?: AutomationRun
  task: AutomationTask
}) => {
  const { t, locale } = useI18n({ keyPrefix: "settings.automation" })
  const { t: common } = useI18n()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isOpen = run?.status === "running" || run?.status === "suspended"
  const scheduledLabel =
    task.schedule.kind === "cron"
      ? `${task.schedule.expression} · ${task.schedule.timeZone}`
      : task.schedule.kind === "interval"
        ? `${task.schedule.minutes} min`
        : t("scheduleManual")
  return (
    <Card>
      <Card.Header>
        <div className="flex items-start justify-between gap-3">
          <Card.Title className="break-all">{task.name}</Card.Title>
          {run ? (
            <Chip
              color={
                run.status === "failed" || run.status === "interrupted"
                  ? "danger"
                  : "default"
              }
              size="sm"
            >
              <Chip.Label>{t(`status.${run.status}`)}</Chip.Label>
            </Chip>
          ) : null}
        </div>
        <Card.Description>{scheduledLabel}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-3">
        <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
          {task.prompt}
        </p>
        {task.nextRunAt ? (
          <p className="text-xs text-muted-foreground">
            {t("nextRun")}: {new Date(task.nextRunAt).toLocaleString(locale)}
          </p>
        ) : null}
        <AutomationToggle
          isDisabled={isPending || task.schedule.kind === "manual"}
          label={t("enabled")}
          onChange={onEnable}
          value={task.enabled}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            isDisabled={isPending || isOpen}
            onPress={onRun}
            size="sm"
            variant="secondary"
          >
            {t("runNow")}
          </Button>
          <Button
            isDisabled={isPending}
            onPress={onOpen}
            size="sm"
            variant="ghost"
          >
            {t("openChat")}
          </Button>
          <Button
            isDisabled={isPending || isOpen}
            onPress={onEdit}
            size="sm"
            variant="ghost"
          >
            {t("edit")}
          </Button>
          <Button
            isDisabled={isPending || isOpen}
            onPress={() => setConfirmDelete(true)}
            size="sm"
            variant="ghost"
          >
            {t("delete")}
          </Button>
        </div>
        {confirmDelete ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm">{t("confirmDelete")}</p>
            <div className="flex gap-2">
              <Button
                isDisabled={isPending}
                onPress={onDelete}
                size="sm"
                variant="danger"
              >
                {t("delete")}
              </Button>
              <Button
                onPress={() => setConfirmDelete(false)}
                size="sm"
                variant="ghost"
              >
                {common("settings.common.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </Card.Content>
    </Card>
  )
}

const AutomationRunHistory = ({
  isPending,
  onCancel,
  onOpen,
  runs,
  tasks
}: {
  isPending: boolean
  onCancel: (runId: string) => void
  onOpen: (sessionId: string) => void
  runs: AutomationRun[]
  tasks: AutomationTask[]
}) => {
  const { t, locale } = useI18n({ keyPrefix: "settings.automation" })
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("history")}</Card.Title>
      </Card.Header>
      <Card.Content className="space-y-3">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : null}
        {runs.map((run) => (
          <div
            className="space-y-2 rounded-lg border border-border p-3"
            key={run.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {tasks.find((task) => task.id === run.taskId)?.name}
              </p>
              <Chip size="sm">
                <Chip.Label>{t(`status.${run.status}`)}</Chip.Label>
              </Chip>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("started")}: {new Date(run.startedAt).toLocaleString(locale)}
            </p>
            {run.summary ? (
              <p className="line-clamp-4 text-sm whitespace-pre-wrap">
                {run.summary}
              </p>
            ) : null}
            {run.error ? (
              <p className="text-xs text-danger">{run.error}</p>
            ) : null}
            {run.notificationError ? (
              <p className="text-xs text-danger">{run.notificationError}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                isDisabled={isPending}
                onPress={() => onOpen(run.sessionId)}
                size="sm"
                variant="ghost"
              >
                {t("openChat")}
              </Button>
              {run.status === "running" || run.status === "suspended" ? (
                <Button
                  isDisabled={isPending}
                  onPress={() => onCancel(run.id)}
                  size="sm"
                  variant="danger"
                >
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </Card.Content>
    </Card>
  )
}

export const AutomationTab = ({ active }: { active: boolean }) => {
  const { t } = useI18n({ keyPrefix: "settings.automation" })
  const queryClient = useQueryClient()
  const automation = useQuery(
    orpc.automation.list.queryOptions({
      enabled: active,
      refetchInterval: active ? 2000 : false
    })
  )
  const sessions = useQuery(
    orpc.chatSessions.list.queryOptions({ enabled: active })
  )
  const settings = useQuery(orpc.settings.get.queryOptions({ enabled: active }))
  const [draft, setDraft] = useState<AutomationTaskDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const action = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => await operation(),
    onError: (cause) => setError(cause.message),
    onSuccess: async () => {
      setError(null)
      await queryClient.invalidateQueries({
        queryKey: orpc.automation.list.key()
      })
    }
  })
  const saveDraft = (): void => {
    if (!draft) {
      return
    }
    const parsed = AutomationTaskDraftSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(" "))
      return
    }
    action.mutate(async () => {
      await rpcClient.automation.save(parsed.data)
      setDraft(null)
    })
  }
  if (!active) {
    return null
  }
  const tasks = automation.data?.tasks ?? []
  const runs = automation.data?.runs ?? []
  const chats = sessions.data ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button
          isDisabled={draft !== null || chats.length === 0}
          onPress={() => setDraft(createAutomationDraft(chats[0]?.id))}
          size="sm"
        >
          {t("add")}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {automation.isError || sessions.isError || settings.isError ? (
        <p className="text-sm text-danger" role="alert">
          {t("error")}
        </p>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 pr-3 pb-4">
          {automation.isPending ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : null}
          {draft ? (
            <AutomationEditor
              draft={draft}
              isSaving={action.isPending}
              onCancel={() => setDraft(null)}
              onChange={setDraft}
              onSave={saveDraft}
              profiles={
                settings.data ? resolveProfileRoster(settings.data.agents) : []
              }
              sessions={chats}
            />
          ) : null}
          {!automation.isPending && tasks.length === 0 && !draft ? (
            <Card>
              <Card.Content>
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              </Card.Content>
            </Card>
          ) : null}
          {tasks.map((task) => (
            <AutomationTaskCard
              isPending={action.isPending}
              key={task.id}
              onDelete={() =>
                action.mutate(async () => {
                  await rpcClient.automation.remove({ taskId: task.id })
                })
              }
              onEdit={() => setDraft(toAutomationDraft(task))}
              onEnable={(enabled) =>
                action.mutate(async () => {
                  await rpcClient.automation.setEnabled({
                    enabled,
                    taskId: task.id
                  })
                })
              }
              onOpen={() =>
                action.mutate(async () => {
                  await rpcClient.automation.openSession({
                    sessionId: task.sessionId
                  })
                })
              }
              onRun={() =>
                action.mutate(async () => {
                  await rpcClient.automation.runNow({ taskId: task.id })
                })
              }
              run={
                runs.find(
                  (run) =>
                    run.taskId === task.id &&
                    (run.status === "running" || run.status === "suspended")
                ) ?? runs.find((run) => run.taskId === task.id)
              }
              task={task}
            />
          ))}
          <AutomationRunHistory
            isPending={action.isPending}
            onCancel={(runId) =>
              action.mutate(async () => {
                await rpcClient.automation.cancel({ runId })
              })
            }
            onOpen={(sessionId) =>
              action.mutate(async () => {
                await rpcClient.automation.openSession({ sessionId })
              })
            }
            runs={runs}
            tasks={tasks}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
