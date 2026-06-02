import { useI18n } from "@etyon/i18n/react"
import type {
  AgentRetrySettings,
  AgentRunGraphExecutionNode,
  AgentRunGraphExecutionPlan,
  AgentRunGraphTemplate,
  AgentRunGraphTemplateId,
  AgentRunTraceRun,
  AgentSessionSnapshotOutput,
  GitProjectDiffOutput,
  PendingAgentApproval,
  ReadAgentArtifactOutput
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import {
  Button,
  Chip,
  Disclosure,
  Label,
  NumberField,
  ScrollShadow,
  Switch
} from "@heroui/react"
import {
  Add01Icon,
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  GitCompareIcon,
  PlayIcon,
  RepeatIcon,
  Rocket01Icon,
  TerminalIcon,
  WorkflowSquare02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import type {
  AgentRunTracePreview,
  AgentWorkbenchBackgroundProcessPreview,
  AgentWorkbenchGraphRetryPreview,
  AgentWorkbenchRetryPolicyPreview,
  AgentWorkbenchShellCommandPreview,
  AgentWorkbenchShellOutputPreview
} from "@/renderer/lib/chat/agent-workbench"
import {
  getAgentWorkbenchBackgroundProcessPreview,
  getAgentWorkbenchControlState,
  getAgentWorkbenchDiffPreview,
  getAgentWorkbenchFirstFailedNode,
  getAgentWorkbenchFirstRunningNode,
  getAgentWorkbenchGraphPreview,
  getAgentWorkbenchGraphPlan,
  getAgentWorkbenchGraphRetryPreview,
  getAgentWorkbenchOperationErrorMessage,
  getAgentWorkbenchPendingApprovals,
  getAgentWorkbenchPreview,
  getAgentWorkbenchRetryPolicyPreview,
  getAgentWorkbenchRootRunOrNull,
  getAgentWorkbenchRootTrace,
  getAgentWorkbenchRunDepth,
  getAgentWorkbenchSelectedRun,
  getAgentWorkbenchSessionPreview,
  getAgentWorkbenchShellCommandPreview,
  getAgentWorkbenchShellOutputPreview,
  getGraphApprovalOperationRunIds,
  getGraphOperationRunIds
} from "@/renderer/lib/chat/agent-workbench"
import { orpc, rpcClient } from "@/renderer/lib/rpc"
import { buildAgentApprovalInboxItem } from "@/renderer/lib/settings-page/agent-approval-inbox"
import {
  AGENT_MAX_AUTOMATIC_RETRIES_MAX,
  AGENT_MAX_AUTOMATIC_RETRIES_MIN,
  clampAgentMaxAutomaticRetries
} from "@/renderer/lib/settings-page/agents-settings"
import { CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS } from "@/renderer/lib/sidebar/chat-sessions"

interface AgentWorkbenchPanelProps {
  gitDiff?: GitProjectDiffOutput
  isRequestPending: boolean
  isProjectDiffLoading: boolean
  mode?: AgentWorkbenchPanelMode
  retrySettings?: AgentRetrySettings
  sessionId: string
}

interface AgentWorkbenchPanelChromeProps {
  approvalCount: number
  children: ReactNode
  mode: AgentWorkbenchPanelMode
  runs: AgentRunTraceRun[]
}

interface InvalidateAgentWorkbenchQueriesOptions {
  approvalsQueryKey: QueryKey
  queryClient: QueryClient
  runIds: string[]
  runsQueryKey: QueryKey
  sessionId: string
}

interface RefreshAgentWorkbenchQueriesOptions {
  approvalsQueryKey: QueryKey
  queryClient: QueryClient
  rootRun: AgentRunTraceRun | null
  runsQueryKey: QueryKey
  sessionQueryKey: QueryKey
  selectedArtifactId: string | null
  selectedRun: AgentRunTraceRun | null
  sessionId: string
  templatesQueryKey: QueryKey
}

interface UseAgentWorkbenchOperationsOptions {
  approvalsQueryKey: QueryKey
  failedNode: AgentRunGraphExecutionNode | null
  rootRun: AgentRunTraceRun | null
  runningNode: AgentRunGraphExecutionNode | null
  runsQueryKey: QueryKey
  selectedTemplateId: AgentRunGraphTemplateId
  selectedRun: AgentRunTraceRun | null
  sessionId: string
  sessionQueryKey: QueryKey
  setSelectedRunId: (runId: string) => void
  taskText: string
}

interface UseAgentWorkbenchSelectionSyncOptions {
  preview: AgentRunTracePreview | null
  runs: AgentRunTraceRun[]
  runsById: Map<string, AgentRunTraceRun>
  selectedArtifactId: string | null
  selectedRunId: string | null
  selectedTemplateId: AgentRunGraphTemplateId
  setSelectedArtifactId: (artifactId: string | null) => void
  setSelectedRunId: (runId: string | null) => void
  setSelectedTemplateId: (templateId: AgentRunGraphTemplateId) => void
  templates: AgentRunGraphTemplate[]
}

type AgentRunTracePreviewItem = AgentRunTracePreview["events"][number]
type AgentWorkbenchGraphNodePreview = NonNullable<
  ReturnType<typeof getAgentWorkbenchGraphPreview>
>["stages"][number]["nodes"][number]
type AgentWorkbenchPanelMode = "embedded" | "standalone"

interface RespondAgentWorkbenchApprovalInput {
  approval: PendingAgentApproval
  approved: boolean
}

interface MoveAgentWorkbenchSessionLeafInput {
  branchSummary: string
  entryId: null | string
}

const RUN_LIST_LIMIT = 30
const ARTIFACT_PREVIEW_MAX_CHARS = 4_000
const DIFF_FILE_PREVIEW_LIMIT = 6
const DEFAULT_RUN_GRAPH_TEMPLATE_ID: AgentRunGraphTemplateId = "solo-coder"
const SESSION_ROOT_ENTRY_VALUE = "__root__"
const EMPTY_AGENT_RUNS: AgentRunTraceRun[] = []
const EMPTY_GRAPH_RETRIES: AgentWorkbenchGraphRetryPreview[] = []
const EMPTY_RUN_GRAPH_TEMPLATES: AgentRunGraphTemplate[] = []
const runGridHeightClassNameByMode: Record<AgentWorkbenchPanelMode, string> = {
  embedded: "max-h-[min(24rem,40vh)]",
  standalone: "flex-1"
}

type ChipColor = "danger" | "default" | "success" | "warning"

const runStatusChipColor: Record<AgentRunTraceRun["status"], ChipColor> = {
  failed: "danger",
  running: "warning",
  succeeded: "success",
  suspended: "default"
}

const graphNodeStatusChipColor: Record<
  AgentRunGraphExecutionNode["status"],
  ChipColor
> = {
  failed: "danger",
  pending: "default",
  running: "warning",
  skipped: "default",
  succeeded: "success",
  suspended: "default"
}

const backgroundProcessStatusChipColor: Record<
  AgentWorkbenchBackgroundProcessPreview["status"],
  ChipColor
> = {
  exited: "success",
  running: "warning",
  spawn_error: "danger",
  stopped: "default",
  unknown: "default"
}

const shellCommandStatusChipColor: Record<
  AgentWorkbenchShellCommandPreview["status"],
  ChipColor
> = {
  failed: "danger",
  running: "warning",
  success: "success",
  unknown: "default"
}

const isLiveAgentRun = (run: AgentRunTraceRun): boolean =>
  run.status === "running" || run.status === "suspended"

const getAgentWorkbenchRunsRefetchInterval = ({
  isRequestPending,
  runs
}: {
  isRequestPending: boolean
  runs: readonly AgentRunTraceRun[]
}): false | number =>
  isRequestPending || runs.some(isLiveAgentRun)
    ? CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
    : false

const getAgentWorkbenchApprovalsRefetchInterval = ({
  approvalCount,
  isRequestPending
}: {
  approvalCount: number
  isRequestPending: boolean
}): false | number =>
  isRequestPending || approvalCount > 0
    ? CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
    : false

const processDurationFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0
})

const runTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short"
})

const invalidateAgentWorkbenchQueries = ({
  approvalsQueryKey,
  queryClient,
  runIds,
  runsQueryKey,
  sessionId
}: InvalidateAgentWorkbenchQueriesOptions) => {
  void queryClient.invalidateQueries({
    queryKey: runsQueryKey
  })
  void queryClient.invalidateQueries({
    queryKey: approvalsQueryKey
  })

  for (const runId of runIds) {
    void queryClient.invalidateQueries({
      queryKey: orpc.agents.inspectRun.queryOptions({
        input: {
          runId,
          sessionId
        }
      }).queryKey
    })
  }
}

const formatRunTime = (run: AgentRunTraceRun): string =>
  runTimeFormatter.format(new Date(run.startedAt))

const formatProcessDuration = (durationMs?: number): string => {
  if (durationMs === undefined) {
    return "-"
  }

  const normalizedDurationMs = Math.max(0, durationMs)

  if (normalizedDurationMs < 1_000) {
    return `${Math.round(normalizedDurationMs)} ms`
  }

  return `${processDurationFormatter.format(normalizedDurationMs / 1_000)} s`
}

const getAgentWorkbenchRetrySettings = ({
  graphPlan,
  retrySettings
}: {
  graphPlan: AgentRunGraphExecutionPlan | null
  retrySettings?: AgentRetrySettings
}): AgentRetrySettings | undefined => graphPlan?.retryPolicy ?? retrySettings

const refreshAgentWorkbenchQueries = ({
  approvalsQueryKey,
  queryClient,
  rootRun,
  runsQueryKey,
  sessionQueryKey,
  selectedArtifactId,
  selectedRun,
  sessionId,
  templatesQueryKey
}: RefreshAgentWorkbenchQueriesOptions) => {
  void queryClient.invalidateQueries({
    queryKey: runsQueryKey
  })
  void queryClient.invalidateQueries({
    queryKey: approvalsQueryKey
  })
  void queryClient.invalidateQueries({
    queryKey: templatesQueryKey
  })
  void queryClient.invalidateQueries({
    queryKey: sessionQueryKey
  })

  const inspectRunIds = new Set<string>()

  if (selectedRun) {
    inspectRunIds.add(selectedRun.id)
  }

  if (rootRun && rootRun.id !== selectedRun?.id) {
    inspectRunIds.add(rootRun.id)
  }

  for (const runId of inspectRunIds) {
    void queryClient.invalidateQueries({
      queryKey: orpc.agents.inspectRun.queryOptions({
        input: {
          runId,
          sessionId
        }
      }).queryKey
    })
  }

  if (!selectedArtifactId) {
    return
  }

  void queryClient.invalidateQueries({
    queryKey: orpc.agents.readArtifact.queryOptions({
      input: {
        artifactId: selectedArtifactId,
        maxChars: ARTIFACT_PREVIEW_MAX_CHARS,
        sessionId
      }
    }).queryKey
  })
}

const RunStatusBadge = ({ status }: { status: AgentRunTraceRun["status"] }) => (
  <Chip color={runStatusChipColor[status]} size="sm" variant="soft">
    <Chip.Label>{status}</Chip.Label>
  </Chip>
)

const GraphNodeStatusBadge = ({
  status
}: {
  status: AgentRunGraphExecutionNode["status"]
}) => (
  <Chip color={graphNodeStatusChipColor[status]} size="sm" variant="soft">
    <Chip.Label>{status}</Chip.Label>
  </Chip>
)

const BackgroundProcessStatusBadge = ({
  status
}: {
  status: AgentWorkbenchBackgroundProcessPreview["status"]
}) => (
  <Chip
    color={backgroundProcessStatusChipColor[status]}
    size="sm"
    variant="soft"
  >
    <Chip.Label>{status}</Chip.Label>
  </Chip>
)

const ShellCommandStatusBadge = ({
  status
}: {
  status: AgentWorkbenchShellCommandPreview["status"]
}) => (
  <Chip color={shellCommandStatusChipColor[status]} size="sm" variant="soft">
    <Chip.Label>{status}</Chip.Label>
  </Chip>
)

const WorkbenchPreviewList = ({
  emptyLabel,
  items,
  onSelectItem,
  selectedItemId
}: {
  emptyLabel: string
  items: AgentRunTracePreviewItem[]
  onSelectItem?: (itemId: string) => void
  selectedItemId?: string | null
}) => {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <>
      {items.map((item) => {
        const className = cn(
          "w-full rounded-md border border-border/50 bg-background/50 px-2 py-1 text-left",
          selectedItemId === item.id && "border-ring bg-muted/50"
        )
        const content = (
          <>
            <p className="truncate text-[0.6875rem] font-medium">
              {item.label}
            </p>
            <p className="line-clamp-2 font-mono text-[0.625rem] text-muted-foreground">
              {item.detail}
            </p>
          </>
        )

        return onSelectItem ? (
          <button
            className={className}
            key={item.id}
            onClick={() => onSelectItem(item.id)}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div className={className} key={item.id}>
            {content}
          </div>
        )
      })}
    </>
  )
}

const AgentWorkbenchGraphNodeCard = ({
  node,
  onSelectRun
}: {
  node: AgentWorkbenchGraphNodePreview
  onSelectRun: (runId: string) => void
}) => {
  const { t } = useI18n()
  const { childRunId } = node
  const isSelectable = Boolean(childRunId)
  const className = cn(
    "w-full min-w-0 rounded-md border border-border/50 bg-background/55 p-2 text-left",
    isSelectable && "transition-colors hover:border-ring hover:bg-muted/45"
  )
  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">
            {node.label}
          </p>
          <p className="truncate text-[0.625rem] text-muted-foreground">
            {node.role} / {node.profileId}
          </p>
        </div>
        <GraphNodeStatusBadge status={node.status} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1 text-[0.625rem] text-muted-foreground">
        <span className="rounded-sm bg-muted px-1.5 py-0.5">
          {t("chat.workbench.graphAttempt", {
            count: node.attempt
          })}
        </span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5">
          {t("chat.workbench.graphTools", {
            count: node.activeToolCount
          })}
        </span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5">
          {node.toolScope}
        </span>
      </div>
      {node.dependsOn.length > 0 ? (
        <p className="mt-1.5 truncate text-[0.625rem] text-muted-foreground">
          {`${t("chat.workbench.graphDependencies")}: ${node.dependsOn
            .map((edge) => edge.fromLabel)
            .join(", ")}`}
        </p>
      ) : null}
      {node.childRunId ? (
        <p className="mt-1 truncate font-mono text-[0.625rem] text-muted-foreground">
          {`${t("chat.workbench.graphChildRun")}: ${node.childRunId}`}
        </p>
      ) : null}
      {node.errorMessage ? (
        <p className="mt-1.5 line-clamp-2 text-[0.625rem] text-destructive">
          {node.errorMessage}
        </p>
      ) : null}
      {node.lastOutputPreview ? (
        <p className="mt-1.5 line-clamp-2 text-[0.625rem] text-muted-foreground">
          {node.lastOutputPreview}
        </p>
      ) : null}
    </>
  )

  if (childRunId) {
    return (
      <button
        className={className}
        onClick={() => onSelectRun(childRunId)}
        type="button"
      >
        {content}
      </button>
    )
  }

  return <div className={className}>{content}</div>
}

const AgentWorkbenchGraphRetryList = ({
  retries
}: {
  retries: AgentWorkbenchGraphRetryPreview[]
}) => {
  const { t } = useI18n()

  if (retries.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border/50 bg-background/35 p-2">
      <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
        {t("chat.workbench.graphRetries", {
          count: retries.length
        })}
      </p>
      <div className="space-y-1">
        {retries.map((retry) => (
          <div
            className="grid min-w-0 gap-1 rounded-md border border-border/50 bg-background/55 px-2 py-1.5 text-[0.625rem]"
            key={retry.eventId}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">
                {retry.nodeId}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {t(
                  retry.automatic
                    ? "chat.workbench.graphRetryAutomatic"
                    : "chat.workbench.graphRetryManual"
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 text-muted-foreground">
              {retry.attempt === undefined ? null : (
                <span className="rounded-sm bg-muted px-1.5 py-0.5">
                  {t("chat.workbench.graphRetryAttempt", {
                    count: retry.attempt
                  })}
                </span>
              )}
              <span className="rounded-sm bg-muted px-1.5 py-0.5">
                #{retry.sequence}
              </span>
              {retry.childRunId ? (
                <span className="rounded-sm bg-muted px-1.5 py-0.5">
                  {retry.childRunId}
                </span>
              ) : null}
            </div>
            {retry.errorMessage ? (
              <p className="line-clamp-2 text-destructive">
                {retry.errorMessage}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

const AgentWorkbenchRetryPolicyPanel = ({
  isPending = false,
  onRetryPolicyChange,
  retryPolicy
}: {
  isPending?: boolean
  onRetryPolicyChange?: (retryPolicy: AgentRetrySettings) => void
  retryPolicy: AgentWorkbenchRetryPolicyPreview
}) => {
  const { t } = useI18n()
  const isEditable = Boolean(onRetryPolicyChange)
  const handleRetryTransientFailuresChange = (checked: boolean) => {
    onRetryPolicyChange?.({
      maxAutomaticRetries:
        checked && retryPolicy.maxAutomaticRetries === 0
          ? 1
          : retryPolicy.maxAutomaticRetries,
      retryTransientFailures: checked
    })
  }
  const handleMaxAutomaticRetriesChange = (value: number) => {
    onRetryPolicyChange?.({
      maxAutomaticRetries: clampAgentMaxAutomaticRetries(value),
      retryTransientFailures: retryPolicy.retryTransientFailures
    })
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border/50 bg-background/35 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
          {t("chat.workbench.graphRetryStrategy")}
        </p>
        <Chip
          color={retryPolicy.automaticRetryEnabled ? "success" : "default"}
          size="sm"
          variant="soft"
        >
          <Chip.Label>
            {t(
              retryPolicy.automaticRetryEnabled
                ? "chat.workbench.graphRetryStrategyAuto"
                : "chat.workbench.graphRetryStrategyDisabled"
            )}
          </Chip.Label>
        </Chip>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(8rem,10rem)]">
        <Switch
          aria-label={t("chat.workbench.graphRetryToggle")}
          isDisabled={!isEditable || isPending}
          isSelected={retryPolicy.retryTransientFailures}
          onChange={handleRetryTransientFailuresChange}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-xs">
              {t("chat.workbench.graphRetryToggle")}
            </Label>
          </Switch.Content>
        </Switch>
        <NumberField
          isDisabled={
            !isEditable || isPending || !retryPolicy.retryTransientFailures
          }
          maxValue={AGENT_MAX_AUTOMATIC_RETRIES_MAX}
          minValue={AGENT_MAX_AUTOMATIC_RETRIES_MIN}
          onChange={handleMaxAutomaticRetriesChange}
          value={retryPolicy.maxAutomaticRetries}
        >
          <Label className="text-xs text-muted-foreground">
            {t("chat.workbench.graphRetryLimit")}
          </Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="text-center" />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
      </div>
      <div className="flex flex-wrap gap-1 text-[0.625rem] text-muted-foreground">
        <span className="rounded-sm bg-muted px-1.5 py-0.5">
          {t("chat.workbench.graphRetryStrategyLimit", {
            count: retryPolicy.maxAutomaticRetries
          })}
        </span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5">
          {t(
            retryPolicy.retryTransientFailures
              ? "chat.workbench.graphRetryTransientOn"
              : "chat.workbench.graphRetryTransientOff"
          )}
        </span>
      </div>
    </div>
  )
}

export const AgentWorkbenchToolCallsPanel = ({
  preview
}: {
  preview: AgentRunTracePreview
}) => {
  const { t } = useI18n()

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-[0.6875rem] font-medium text-muted-foreground">
        {t("chat.workbench.tools", {
          count: preview.toolCallCount
        })}
      </p>
      <WorkbenchPreviewList
        emptyLabel={t("chat.workbench.emptyTools")}
        items={preview.toolCalls}
      />
    </div>
  )
}

export const AgentWorkbenchBackgroundProcessPanel = ({
  processes
}: {
  processes: AgentWorkbenchBackgroundProcessPreview[]
}) => {
  const { t } = useI18n()

  if (processes.length === 0) {
    return null
  }

  return (
    <div className="shrink-0 space-y-1.5 rounded-md border border-border/50 bg-background/35 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            className="shrink-0 text-muted-foreground"
            icon={TerminalIcon}
            size={14}
          />
          <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.backgroundProcesses", {
              count: processes.length
            })}
          </p>
        </div>
      </div>
      <ScrollShadow className="max-h-40 pr-1">
        <div className="space-y-1.5">
          {processes.map((process) => (
            <div
              className="min-w-0 rounded-md border border-border/50 bg-background/55 p-2"
              key={process.id}
            >
              <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[0.625rem] font-medium text-foreground">
                    {process.command ?? process.processId}
                  </p>
                  <p className="truncate font-mono text-[0.625rem] text-muted-foreground">
                    {process.processId}
                  </p>
                  {process.cwd ? (
                    <p className="truncate font-mono text-[0.625rem] text-muted-foreground">
                      {process.cwd}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <BackgroundProcessStatusBadge status={process.status} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1 text-[0.625rem] text-muted-foreground">
                {process.pid === undefined ? null : (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {t("chat.workbench.processPid", {
                      pid: process.pid ?? "-"
                    })}
                  </span>
                )}
                <span className="rounded-sm bg-muted px-1.5 py-0.5">
                  {t("chat.workbench.processDuration", {
                    duration: formatProcessDuration(process.durationMs)
                  })}
                </span>
                <span className="rounded-sm bg-muted px-1.5 py-0.5">
                  {t("chat.workbench.processOutputChars", {
                    stderr: process.stderrChars,
                    stdout: process.stdoutChars
                  })}
                </span>
                {process.exitCode === undefined ? null : (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {t("chat.workbench.processExitCode", {
                      code: process.exitCode ?? "-"
                    })}
                  </span>
                )}
                {process.sandboxed === undefined ? null : (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {t(
                      process.sandboxed
                        ? "chat.workbench.processSandboxed"
                        : "chat.workbench.processUnsandboxed"
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollShadow>
    </div>
  )
}

export const AgentWorkbenchShellCommandPanel = ({
  commands
}: {
  commands: AgentWorkbenchShellCommandPreview[]
}) => {
  const { t } = useI18n()

  if (commands.length === 0) {
    return null
  }

  return (
    <div className="shrink-0 space-y-1.5 rounded-md border border-border/50 bg-background/35 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            className="shrink-0 text-muted-foreground"
            icon={TerminalIcon}
            size={14}
          />
          <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.shellCommands", {
              count: commands.length
            })}
          </p>
        </div>
      </div>
      <ScrollShadow className="max-h-40 pr-1">
        <div className="space-y-1.5">
          {commands.map((command) => (
            <div
              className="min-w-0 rounded-md border border-border/50 bg-background/55 p-2"
              key={command.id}
            >
              <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[0.625rem] font-medium text-foreground">
                    {command.command ?? command.id}
                  </p>
                  {command.cwd ? (
                    <p className="truncate font-mono text-[0.625rem] text-muted-foreground">
                      {command.cwd}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <ShellCommandStatusBadge status={command.status} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1 text-[0.625rem] text-muted-foreground">
                {command.pid === undefined ? null : (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {t("chat.workbench.processPid", {
                      pid: command.pid ?? "-"
                    })}
                  </span>
                )}
                <span className="rounded-sm bg-muted px-1.5 py-0.5">
                  {t("chat.workbench.processDuration", {
                    duration: formatProcessDuration(command.durationMs)
                  })}
                </span>
                <span className="rounded-sm bg-muted px-1.5 py-0.5">
                  {t("chat.workbench.processOutputChars", {
                    stderr: command.stderrChars,
                    stdout: command.stdoutChars
                  })}
                </span>
                {command.exitCode === undefined ? null : (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {t("chat.workbench.processExitCode", {
                      code: command.exitCode ?? "-"
                    })}
                  </span>
                )}
                {command.shellStatus ? (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {command.shellStatus}
                  </span>
                ) : null}
                {command.sandboxed === undefined ? null : (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {t(
                      command.sandboxed
                        ? "chat.workbench.processSandboxed"
                        : "chat.workbench.processUnsandboxed"
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollShadow>
    </div>
  )
}

export const AgentWorkbenchShellOutputPanel = ({
  outputs
}: {
  outputs: AgentWorkbenchShellOutputPreview[]
}) => {
  const { t } = useI18n()

  if (outputs.length === 0) {
    return null
  }

  return (
    <div className="shrink-0 space-y-1.5 rounded-md border border-border/50 bg-background/35 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            className="shrink-0 text-muted-foreground"
            icon={TerminalIcon}
            size={14}
          />
          <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.shellOutput", {
              count: outputs.length
            })}
          </p>
        </div>
      </div>
      <ScrollShadow className="max-h-36 pr-1">
        <div className="space-y-1.5">
          {outputs.map((output) => (
            <div
              className="min-w-0 rounded-md border border-border/50 bg-background/55 p-2"
              key={output.id}
            >
              <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[0.625rem] font-medium text-foreground">
                    {output.commandLabel}
                  </p>
                  {output.cwd ? (
                    <p className="truncate font-mono text-[0.625rem] text-muted-foreground">
                      {output.cwd}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 text-[0.625rem] font-medium",
                      output.channel === "stderr"
                        ? "bg-danger/10 text-danger"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {output.channel}
                  </span>
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                    {t("chat.workbench.shellOutputChunks", {
                      count: output.chunkCount
                    })}
                  </span>
                </div>
              </div>
              <pre className="max-h-24 overflow-auto font-mono text-[0.625rem] wrap-break-word whitespace-pre-wrap text-foreground">
                {output.text}
              </pre>
              {output.truncated ? (
                <p className="mt-1 text-[0.625rem] text-muted-foreground">
                  {t("chat.workbench.shellOutputTruncated")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </ScrollShadow>
    </div>
  )
}

export const AgentWorkbenchGraphPlanPanel = ({
  graphPlan,
  isRetryPolicyPending = false,
  onRetryPolicyChange,
  onSelectRun,
  retryPolicy,
  retries = EMPTY_GRAPH_RETRIES
}: {
  graphPlan: AgentRunGraphExecutionPlan | null
  isRetryPolicyPending?: boolean
  onRetryPolicyChange?: (retryPolicy: AgentRetrySettings) => void
  onSelectRun: (runId: string) => void
  retryPolicy?: AgentWorkbenchRetryPolicyPreview
  retries?: AgentWorkbenchGraphRetryPreview[]
}) => {
  const { t } = useI18n()
  const preview = getAgentWorkbenchGraphPreview(graphPlan)

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            className="shrink-0 text-muted-foreground"
            icon={WorkflowSquare02Icon}
            size={14}
          />
          <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.graph")}
          </p>
        </div>
        <span className="shrink-0 text-[0.625rem] text-muted-foreground">
          {t("chat.workbench.graphNodeCount", {
            count: preview?.totalNodeCount ?? 0
          })}
        </span>
      </div>

      {preview ? (
        <div className="space-y-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {preview.name}
            </p>
            {preview.task ? (
              <p className="mt-0.5 line-clamp-2 text-[0.625rem] text-muted-foreground">
                {`${t("chat.workbench.graphTask")}: ${preview.task}`}
              </p>
            ) : null}
          </div>
          {retryPolicy ? (
            <AgentWorkbenchRetryPolicyPanel
              isPending={isRetryPolicyPending}
              onRetryPolicyChange={onRetryPolicyChange}
              retryPolicy={retryPolicy}
            />
          ) : null}
          <AgentWorkbenchGraphRetryList retries={retries} />
          <div className="space-y-2">
            {preview.stages.map((stage) => (
              <div
                className="space-y-1.5 rounded-md border border-border/50 bg-background/35 p-2"
                key={stage.id}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
                    {t("chat.workbench.graphStage", {
                      index: stage.index + 1
                    })}
                  </p>
                  <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                    {t(
                      stage.parallel
                        ? "chat.workbench.graphParallel"
                        : "chat.workbench.graphSequential"
                    )}
                  </span>
                </div>
                <div className="grid min-w-0 gap-1.5 md:grid-cols-2">
                  {stage.nodes.map((node) => (
                    <AgentWorkbenchGraphNodeCard
                      key={node.id}
                      node={node}
                      onSelectRun={onSelectRun}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("chat.workbench.graphEmpty")}
        </p>
      )}
    </div>
  )
}

const AgentRunGraphList = ({
  emptyLabel,
  onSelectRun,
  runs,
  runsById,
  selectedRunId
}: {
  emptyLabel: string
  onSelectRun: (runId: string) => void
  runs: AgentRunTraceRun[]
  runsById: Map<string, AgentRunTraceRun>
  selectedRunId: string | null
}) => {
  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <ScrollShadow className="h-full pr-1">
      <div className="space-y-1">
        {runs.map((run) => {
          const depth = getAgentWorkbenchRunDepth({
            run,
            runsById
          })

          return (
            <button
              className={cn(
                "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition-colors hover:border-border/60 hover:bg-muted/40",
                selectedRunId === run.id && "border-border bg-muted/55"
              )}
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {run.profileId}
                </span>
                <span className="block truncate font-mono text-[0.625rem] text-muted-foreground">
                  {run.id}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <RunStatusBadge status={run.status} />
                <span className="hidden text-[0.625rem] text-muted-foreground xl:inline">
                  {formatRunTime(run)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </ScrollShadow>
  )
}

const AgentWorkbenchControls = ({
  failedNode,
  isApprovalResponsePending,
  graphPlan,
  isAdvanceGraphPending,
  isCreateGraphPending,
  isExecuteNodePending,
  isRetryNodePending,
  isRunGraphPending,
  isSkipNodePending,
  isStartStagePending,
  onAdvanceGraph,
  onCreateGraph,
  onExecuteNode,
  onRetryNode,
  onRunGraph,
  onSelectedTemplateIdChange,
  onSkipNode,
  onStartStage,
  onTaskTextChange,
  operationErrorMessage,
  selectedTemplateId,
  taskText,
  templates
}: {
  failedNode: AgentRunGraphExecutionNode | null
  graphPlan: AgentRunGraphExecutionPlan | null
  isAdvanceGraphPending: boolean
  isApprovalResponsePending: boolean
  isCreateGraphPending: boolean
  isExecuteNodePending: boolean
  isRetryNodePending: boolean
  isRunGraphPending: boolean
  isSkipNodePending: boolean
  isStartStagePending: boolean
  onAdvanceGraph: () => void
  onCreateGraph: () => void
  onExecuteNode: () => void
  onRetryNode: () => void
  onRunGraph: () => void
  onSelectedTemplateIdChange: (templateId: AgentRunGraphTemplateId) => void
  onSkipNode: () => void
  onStartStage: () => void
  onTaskTextChange: (text: string) => void
  operationErrorMessage: string | null
  selectedTemplateId: AgentRunGraphTemplateId
  taskText: string
  templates: AgentRunGraphTemplate[]
}) => {
  const { t } = useI18n()
  const isPending =
    isAdvanceGraphPending ||
    isApprovalResponsePending ||
    isCreateGraphPending ||
    isExecuteNodePending ||
    isRetryNodePending ||
    isRunGraphPending ||
    isSkipNodePending ||
    isStartStagePending
  const controlState = getAgentWorkbenchControlState({
    failedNode,
    graphPlan,
    isPending,
    templateCount: templates.length
  })

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
      <div className="grid gap-2 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)]">
        <label className="min-w-0 space-y-1">
          <span className="block text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.template")}
          </span>
          <select
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs transition-colors outline-none focus:border-ring"
            disabled={templates.length === 0 || isPending}
            onChange={(event) =>
              onSelectedTemplateIdChange(
                event.currentTarget.value as AgentRunGraphTemplateId
              )
            }
            value={selectedTemplateId}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.task")}
          </span>
          <input
            aria-label={t("chat.workbench.task")}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-ring"
            onChange={(event) => onTaskTextChange(event.currentTarget.value)}
            placeholder={t("chat.workbench.taskPlaceholder")}
            value={taskText}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canCreateGraph}
          onPress={onCreateGraph}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
          <span>{t("chat.workbench.createGraph")}</span>
        </Button>
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canRunGraph}
          onPress={onRunGraph}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={Rocket01Icon} size={14} />
          <span>{t("chat.workbench.runGraph")}</span>
        </Button>
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canExecuteRunningNode}
          onPress={onExecuteNode}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={PlayIcon} size={14} />
          <span>{t("chat.workbench.executeNode")}</span>
        </Button>
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canStartNextStage}
          onPress={onStartStage}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={PlayIcon} size={14} />
          <span>{t("chat.workbench.startNextStage")}</span>
        </Button>
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canAdvanceGraph}
          onPress={onAdvanceGraph}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={Rocket01Icon} size={14} />
          <span>{t("chat.workbench.advance")}</span>
        </Button>
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canRetryFailedNode}
          onPress={onRetryNode}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={RepeatIcon} size={14} />
          <span>{t("chat.workbench.retryFailed")}</span>
        </Button>
        <Button
          className="gap-1.5"
          isDisabled={!controlState.canSkipFailedNode}
          onPress={onSkipNode}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
          <span>{t("chat.workbench.skipFailed")}</span>
        </Button>
      </div>

      {failedNode ? (
        <p className="truncate text-[0.6875rem] text-muted-foreground">
          {t("chat.workbench.failedNode", {
            node: failedNode.label
          })}
        </p>
      ) : null}
      {operationErrorMessage ? (
        <p className="line-clamp-2 text-xs text-destructive">
          {operationErrorMessage}
        </p>
      ) : null}
    </div>
  )
}

const AgentWorkbenchApprovalInbox = ({
  approvals,
  isPending,
  onRespond
}: {
  approvals: PendingAgentApproval[]
  isPending: boolean
  onRespond: (input: RespondAgentWorkbenchApprovalInput) => void
}) => {
  const { t } = useI18n()

  if (approvals.length === 0) {
    return null
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-sky-500/30 bg-sky-500/10 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="truncate text-[0.6875rem] font-medium text-sky-700">
          {t("chat.workbench.approvals", {
            count: approvals.length
          })}
        </p>
        <span className="text-[0.625rem] text-muted-foreground">
          {t("chat.workbench.approvalRequired")}
        </span>
      </div>
      <div className="space-y-1.5">
        {approvals.map((approval) => {
          const item = buildAgentApprovalInboxItem(approval)
          const isActionDisabled = isPending || !approval.approvalId

          return (
            <div
              className="grid min-w-0 gap-2 rounded-md border border-border/50 bg-background/60 p-2 md:grid-cols-[minmax(0,1fr)_auto]"
              key={`${approval.runId}:${approval.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {item.title}
                </p>
                <p className="line-clamp-2 font-mono text-[0.625rem] text-muted-foreground">
                  {item.inputPreview}
                </p>
                <p className="mt-0.5 truncate text-[0.625rem] text-muted-foreground">
                  {item.meta.join(" / ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  className="gap-1"
                  isDisabled={isActionDisabled}
                  onPress={() =>
                    onRespond({
                      approval,
                      approved: true
                    })
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} />
                  <span>{t("chat.workbench.approve")}</span>
                </Button>
                <Button
                  className="gap-1"
                  isDisabled={isActionDisabled}
                  onPress={() =>
                    onRespond({
                      approval,
                      approved: false
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={13} />
                  <span>{t("chat.workbench.deny")}</span>
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const AgentWorkbenchSessionPanel = ({
  isLoading,
  isPending,
  onAppendCompactionSummary,
  onMoveLeaf,
  operationErrorMessage,
  snapshot
}: {
  isLoading: boolean
  isPending: boolean
  onAppendCompactionSummary: (summary: string) => void
  onMoveLeaf: (input: MoveAgentWorkbenchSessionLeafInput) => void
  operationErrorMessage: string | null
  snapshot: AgentSessionSnapshotOutput | null
}) => {
  const { t } = useI18n()
  const preview = getAgentWorkbenchSessionPreview(snapshot)
  const [branchSummary, setBranchSummary] = useState("")
  const [compactionSummary, setCompactionSummary] = useState("")
  const [selectedEntryId, setSelectedEntryId] = useState(
    SESSION_ROOT_ENTRY_VALUE
  )
  const entryIdSignature =
    preview?.entries.map((entry) => entry.id).join("\n") ?? ""
  const selectedEntryValue = selectedEntryId || SESSION_ROOT_ENTRY_VALUE

  useEffect(() => {
    const defaultEntryId =
      preview?.leafEntryId ??
      preview?.entries.at(-1)?.id ??
      SESSION_ROOT_ENTRY_VALUE

    if (
      selectedEntryId === SESSION_ROOT_ENTRY_VALUE ||
      !preview?.entries.some((entry) => entry.id === selectedEntryId)
    ) {
      setSelectedEntryId(defaultEntryId)
    }
  }, [
    entryIdSignature,
    preview?.leafEntryId,
    preview?.entries,
    selectedEntryId
  ])

  const handleMoveLeaf = () => {
    onMoveLeaf({
      branchSummary: branchSummary.trim(),
      entryId:
        selectedEntryValue === SESSION_ROOT_ENTRY_VALUE
          ? null
          : selectedEntryValue
    })
    setBranchSummary("")
  }

  const handleAppendCompactionSummary = () => {
    const summary = compactionSummary.trim()

    if (!summary) {
      return
    }

    onAppendCompactionSummary(summary)
    setCompactionSummary("")
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            className="shrink-0 text-muted-foreground"
            icon={WorkflowSquare02Icon}
            size={14}
          />
          <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.session")}
          </p>
        </div>
        <span className="shrink-0 text-[0.625rem] text-muted-foreground">
          {t("chat.workbench.sessionEntries", {
            count: preview?.entries.length ?? 0
          })}
        </span>
      </div>

      {preview ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 text-[0.625rem] text-muted-foreground">
            <span className="rounded-sm bg-muted px-1.5 py-0.5">
              {t("chat.workbench.sessionContext", {
                count: preview.contextCount
              })}
            </span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5">
              {t("chat.workbench.sessionEvents", {
                count: preview.sessionEventCount
              })}
            </span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5">
              {t("chat.workbench.sessionLeaf", {
                entry: preview.leafEntryId ?? "-"
              })}
            </span>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto]">
            <label className="min-w-0 space-y-1">
              <span className="block text-[0.6875rem] font-medium text-muted-foreground">
                {t("chat.workbench.sessionTarget")}
              </span>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs transition-colors outline-none focus:border-ring"
                disabled={isPending}
                onChange={(event) =>
                  setSelectedEntryId(event.currentTarget.value)
                }
                value={selectedEntryValue}
              >
                <option value={SESSION_ROOT_ENTRY_VALUE}>
                  {t("chat.workbench.sessionRoot")}
                </option>
                {preview.entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 space-y-1">
              <span className="block text-[0.6875rem] font-medium text-muted-foreground">
                {t("chat.workbench.sessionBranchSummary")}
              </span>
              <textarea
                aria-label={t("chat.workbench.sessionBranchSummary")}
                className="min-h-8 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-ring"
                disabled={isPending}
                onChange={(event) =>
                  setBranchSummary(event.currentTarget.value)
                }
                placeholder={t("chat.workbench.sessionBranchPlaceholder")}
                rows={2}
                value={branchSummary}
              />
            </label>
            <Button
              className="gap-1.5 self-end"
              isDisabled={isPending}
              onPress={handleMoveLeaf}
              size="sm"
              type="button"
              variant="secondary"
            >
              <HugeiconsIcon icon={GitCompareIcon} size={14} />
              <span>{t("chat.workbench.sessionMoveLeaf")}</span>
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="min-w-0 space-y-1">
              <span className="block text-[0.6875rem] font-medium text-muted-foreground">
                {t("chat.workbench.sessionCompactionSummary")}
              </span>
              <textarea
                aria-label={t("chat.workbench.sessionCompactionSummary")}
                className="min-h-10 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-ring"
                disabled={isPending}
                onChange={(event) =>
                  setCompactionSummary(event.currentTarget.value)
                }
                placeholder={t("chat.workbench.sessionCompactionPlaceholder")}
                rows={2}
                value={compactionSummary}
              />
            </label>
            <Button
              className="gap-1.5 self-end"
              isDisabled={isPending || compactionSummary.trim().length === 0}
              onPress={handleAppendCompactionSummary}
              size="sm"
              type="button"
              variant="secondary"
            >
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
              <span>{t("chat.workbench.sessionCompact")}</span>
            </Button>
          </div>

          {operationErrorMessage ? (
            <p className="line-clamp-2 text-xs text-destructive">
              {operationErrorMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <p
          className={cn(
            "text-xs text-muted-foreground",
            isLoading && "animate-pulse"
          )}
        >
          {t(
            isLoading
              ? "chat.workbench.sessionLoading"
              : "chat.workbench.sessionEmpty"
          )}
        </p>
      )}
    </div>
  )
}

const AgentWorkbenchDiffPanel = ({
  gitDiff,
  isLoading
}: {
  gitDiff?: GitProjectDiffOutput
  isLoading: boolean
}) => {
  const { t } = useI18n()
  const preview = getAgentWorkbenchDiffPreview(gitDiff)
  const files = preview.files.slice(0, DIFF_FILE_PREVIEW_LIMIT)
  const hiddenFileCount = Math.max(0, preview.files.length - files.length)

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            className="shrink-0 text-muted-foreground"
            icon={GitCompareIcon}
            size={14}
          />
          <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">
            {t("chat.workbench.diff")}
          </p>
        </div>
        <span className="shrink-0 text-[0.625rem] text-muted-foreground">
          {t("chat.workbench.diffFiles", {
            count: preview.changedFileCount
          })}
        </span>
      </div>

      {preview.hasChanges ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2 text-[0.625rem] font-medium tabular-nums">
            <span className="text-success">
              +{preview.additions.toLocaleString()}
            </span>
            <span className="text-danger">
              -{preview.deletions.toLocaleString()}
            </span>
            {preview.truncated ? (
              <span className="text-warning">
                {t("chat.workbench.diffTruncated")}
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            {files.map((file) => (
              <div
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-[0.625rem]"
                key={file.path}
              >
                <span className="truncate font-mono text-foreground">
                  {file.path}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-success">+{file.additions}</span>
                  <span className="px-1 text-muted-foreground">/</span>
                  <span className="text-danger">-{file.deletions}</span>
                </span>
              </div>
            ))}
          </div>
          {hiddenFileCount > 0 ? (
            <p className="text-[0.625rem] text-muted-foreground">
              {t("chat.workbench.diffMoreFiles", {
                count: hiddenFileCount
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p
          className={cn(
            "text-xs text-muted-foreground",
            isLoading && "animate-pulse"
          )}
        >
          {t(
            isLoading
              ? "chat.workbench.diffLoading"
              : "chat.workbench.diffEmpty"
          )}
        </p>
      )}
    </div>
  )
}

const hasPendingAgentWorkbenchSessionMutation = ({
  appendPending,
  movePending
}: {
  appendPending: boolean
  movePending: boolean
}): boolean => movePending || appendPending

const shouldInspectAgentWorkbenchRootRun = ({
  rootRun,
  selectedRun
}: {
  rootRun: AgentRunTraceRun | null
  selectedRun: AgentRunTraceRun | null
}): boolean => rootRun !== null && rootRun.id !== selectedRun?.id

const shouldInspectAgentWorkbenchSelectedRun = (
  selectedRun: AgentRunTraceRun | null
): boolean => selectedRun !== null

const AgentWorkbenchTriggerChips = ({
  approvalCount,
  runs
}: {
  approvalCount: number
  runs: AgentRunTraceRun[]
}) => {
  const { t } = useI18n()
  const runningCount = runs.filter((r) => r.status === "running").length
  const failedCount = runs.filter((r) => r.status === "failed").length

  return (
    <>
      {runs.length > 0 ? (
        <Chip color="default" size="sm" variant="secondary">
          <Chip.Label>
            {t("chat.workbench.runCount", { count: runs.length })}
          </Chip.Label>
        </Chip>
      ) : null}
      {runningCount > 0 ? (
        <Chip color="warning" size="sm" variant="soft">
          <Chip.Label>{runningCount} running</Chip.Label>
        </Chip>
      ) : null}
      {failedCount > 0 ? (
        <Chip color="danger" size="sm" variant="soft">
          <Chip.Label>{failedCount} failed</Chip.Label>
        </Chip>
      ) : null}
      {approvalCount > 0 ? (
        <Chip color="accent" size="sm" variant="soft">
          <Chip.Label>
            {t("chat.workbench.approvals", {
              count: approvalCount
            })}
          </Chip.Label>
        </Chip>
      ) : null}
    </>
  )
}

const AgentWorkbenchPanelChrome = ({
  approvalCount,
  children,
  mode,
  runs
}: AgentWorkbenchPanelChromeProps) => {
  const { t } = useI18n()

  if (mode === "standalone") {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <HugeiconsIcon
              className="shrink-0 text-muted-foreground"
              icon={WorkflowSquare02Icon}
              size={18}
            />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {t("chat.workbench.title")}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {t("chat.workbench.subtitle")}
              </p>
            </div>
          </div>
          <AgentWorkbenchTriggerChips
            approvalCount={approvalCount}
            runs={runs}
          />
        </header>
        <ScrollShadow className="min-h-0 flex-1 px-4 py-4">
          <div className="flex h-full min-h-0 flex-col">{children}</div>
        </ScrollShadow>
      </section>
    )
  }

  return (
    <Disclosure className="min-h-0 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <HugeiconsIcon
              className="shrink-0 text-muted-foreground"
              icon={WorkflowSquare02Icon}
              size={18}
            />
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {t("chat.workbench.title")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {t("chat.workbench.subtitle")}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AgentWorkbenchTriggerChips
              approvalCount={approvalCount}
              runs={runs}
            />
            <Disclosure.Indicator />
          </div>
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content className="min-h-0 overflow-hidden">
        <Disclosure.Body>
          <ScrollShadow className="max-h-[50vh] px-4 pb-4">
            {children}
          </ScrollShadow>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

const SelectedRunDetails = ({
  artifactContent,
  backgroundProcesses,
  isArtifactContentLoading,
  isLoading,
  onSelectArtifact,
  preview,
  run,
  selectedArtifactId,
  shellCommands,
  shellOutputs
}: {
  artifactContent: ReadAgentArtifactOutput | null
  backgroundProcesses: AgentWorkbenchBackgroundProcessPreview[]
  isArtifactContentLoading: boolean
  isLoading: boolean
  onSelectArtifact: (artifactId: string) => void
  preview: AgentRunTracePreview | null
  run: AgentRunTraceRun | null
  selectedArtifactId: string | null
  shellCommands: AgentWorkbenchShellCommandPreview[]
  shellOutputs: AgentWorkbenchShellOutputPreview[]
}) => {
  const { t } = useI18n()

  if (!run) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("chat.workbench.emptyRuns")}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">
            {run.profileId}
          </p>
          <p className="truncate font-mono text-[0.625rem] text-muted-foreground">
            {run.id}
          </p>
        </div>
        <RunStatusBadge status={run.status} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[0.625rem] text-muted-foreground">
        <span>{`${t("chat.workbench.model")}: ${run.modelId ?? "-"}`}</span>
        {run.parentRunId ? (
          <span>{`${t("chat.workbench.parent")}: ${run.parentRunId}`}</span>
        ) : null}
      </div>
      {run.errorMessage ? (
        <p className="line-clamp-2 text-xs text-destructive">
          {run.errorMessage}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">
          {t("chat.workbench.loading")}
        </p>
      ) : null}
      <AgentWorkbenchShellCommandPanel commands={shellCommands} />
      <AgentWorkbenchBackgroundProcessPanel processes={backgroundProcesses} />
      <AgentWorkbenchShellOutputPanel outputs={shellOutputs} />
      {preview ? (
        <div className="grid min-h-0 min-w-0 flex-1 gap-2 md:grid-cols-3">
          <div className="min-h-0 min-w-0 space-y-1.5">
            <p className="text-[0.6875rem] font-medium text-muted-foreground">
              {t("chat.workbench.artifacts", {
                count: preview.artifactCount
              })}
            </p>
            <WorkbenchPreviewList
              emptyLabel={t("chat.workbench.emptyArtifacts")}
              items={preview.artifacts}
              onSelectItem={onSelectArtifact}
              selectedItemId={selectedArtifactId}
            />
            {isArtifactContentLoading ? (
              <p className="text-xs text-muted-foreground">
                {t("chat.workbench.artifactLoading")}
              </p>
            ) : null}
            {artifactContent ? (
              <div className="rounded-md border border-border/50 bg-background/50 p-2">
                <p className="mb-1 truncate text-[0.6875rem] font-medium text-muted-foreground">
                  {t("chat.workbench.artifactContent")}
                </p>
                <pre className="max-h-36 overflow-auto font-mono text-[0.625rem] wrap-break-word whitespace-pre-wrap text-foreground">
                  {artifactContent.content}
                </pre>
                {artifactContent.truncated ? (
                  <p className="mt-1 text-[0.625rem] text-muted-foreground">
                    {t("chat.workbench.artifactTruncated", {
                      count: artifactContent.omittedChars
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <AgentWorkbenchToolCallsPanel preview={preview} />
          <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
            <p className="shrink-0 text-[0.6875rem] font-medium text-muted-foreground">
              {t("chat.workbench.events", {
                count: preview.eventCount
              })}
            </p>
            <ScrollShadow className="min-h-0 flex-1 pr-1">
              <div className="space-y-1">
                <WorkbenchPreviewList
                  emptyLabel={t("chat.workbench.emptyEvents")}
                  items={preview.events}
                />
              </div>
            </ScrollShadow>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const useAgentWorkbenchOperations = ({
  approvalsQueryKey,
  failedNode,
  rootRun,
  runningNode,
  runsQueryKey,
  selectedTemplateId,
  selectedRun,
  sessionId,
  sessionQueryKey,
  setSelectedRunId,
  taskText
}: UseAgentWorkbenchOperationsOptions) => {
  const queryClient = useQueryClient()
  const invalidateQueries = (runIds: string[]) =>
    invalidateAgentWorkbenchQueries({
      approvalsQueryKey,
      queryClient,
      runIds,
      runsQueryKey,
      sessionId
    })
  const invalidateSessionQueries = (runId: string) => {
    invalidateQueries([runId])
    void queryClient.invalidateQueries({
      queryKey: sessionQueryKey
    })
  }
  const instantiateGraphMutation = useMutation({
    mutationFn: () => {
      const task = taskText.trim()

      return rpcClient.agents.instantiateRunGraphTemplate({
        sessionId,
        ...(task ? { task } : {}),
        templateId: selectedTemplateId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const startStageMutation = useMutation({
    mutationFn: () => {
      if (!rootRun) {
        throw new Error("Run graph root is not selected.")
      }

      return rpcClient.agents.startRunGraphNextStage({
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const advanceGraphMutation = useMutation({
    mutationFn: () => {
      if (!rootRun) {
        throw new Error("Run graph root is not selected.")
      }

      return rpcClient.agents.advanceRunGraph({
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const executeNodeMutation = useMutation({
    mutationFn: () => {
      if (!rootRun || !runningNode) {
        throw new Error("Running run graph node is not selected.")
      }

      return rpcClient.agents.executeRunGraphNode({
        nodeId: runningNode.id,
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.childRun.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const runGraphMutation = useMutation({
    mutationFn: () => {
      if (!rootRun) {
        throw new Error("Run graph root is not selected.")
      }

      return rpcClient.agents.runGraphUntilIdle({
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      const lastChildRun = result.childRuns.at(-1)

      setSelectedRunId(lastChildRun?.id ?? result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const retryNodeMutation = useMutation({
    mutationFn: () => {
      if (!failedNode || !rootRun) {
        throw new Error("Failed run graph node is not selected.")
      }

      return rpcClient.agents.retryRunGraphNode({
        nodeId: failedNode.id,
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const skipNodeMutation = useMutation({
    mutationFn: () => {
      if (!failedNode || !rootRun) {
        throw new Error("Failed run graph node is not selected.")
      }

      return rpcClient.agents.skipRunGraphNode({
        nodeId: failedNode.id,
        reason: "Skipped in Agent Workbench.",
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const updateRetryPolicyMutation = useMutation({
    mutationFn: (retryPolicy: AgentRetrySettings) => {
      if (!rootRun) {
        throw new Error("Run graph root is not selected.")
      }

      return rpcClient.agents.updateRunGraphRetryPolicy({
        retryPolicy,
        runId: rootRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id)
      invalidateQueries(getGraphOperationRunIds(result))
    }
  })
  const respondApprovalMutation = useMutation({
    mutationFn: ({
      approval,
      approved
    }: RespondAgentWorkbenchApprovalInput) => {
      if (!rootRun) {
        throw new Error("Run graph root is not selected.")
      }

      if (!approval.approvalId) {
        throw new Error("Pending approval has no resumable approval id.")
      }

      return rpcClient.agents.respondToRunGraphApproval({
        approvalId: approval.approvalId,
        approved,
        continueUntilIdle: true,
        ...(approved ? {} : { reason: "Denied in Agent Workbench." }),
        rootRunId: rootRun.id,
        sessionId,
        toolCallId: approval.id
      })
    },
    onSuccess: (result) => {
      const continuedChildRun = result.continuedGraph?.childRuns.at(-1)

      setSelectedRunId(continuedChildRun?.id ?? result.childRun.id)
      invalidateQueries(getGraphApprovalOperationRunIds(result))
    }
  })
  const moveSessionLeafMutation = useMutation({
    mutationFn: ({
      branchSummary,
      entryId
    }: MoveAgentWorkbenchSessionLeafInput) => {
      if (!selectedRun) {
        throw new Error("Agent session run is not selected.")
      }

      return rpcClient.agents.moveSessionLeaf({
        ...(branchSummary ? { branchSummary } : {}),
        entryId,
        runId: selectedRun.id,
        sessionId
      })
    },
    onSuccess: (result) => {
      if (result.run) {
        setSelectedRunId(result.run.id)
        invalidateSessionQueries(result.run.id)
      }
    }
  })
  const appendSessionCompactionSummaryMutation = useMutation({
    mutationFn: (summary: string) => {
      if (!selectedRun) {
        throw new Error("Agent session run is not selected.")
      }

      return rpcClient.agents.appendSessionCompactionSummary({
        runId: selectedRun.id,
        sessionId,
        summary
      })
    },
    onSuccess: (result) => {
      if (result.run) {
        setSelectedRunId(result.run.id)
        invalidateSessionQueries(result.run.id)
      }
    }
  })
  const graphOperationErrorMessage =
    getAgentWorkbenchOperationErrorMessage(instantiateGraphMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(startStageMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(advanceGraphMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(executeNodeMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(runGraphMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(retryNodeMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(skipNodeMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(updateRetryPolicyMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(respondApprovalMutation.error)
  const sessionOperationErrorMessage =
    getAgentWorkbenchOperationErrorMessage(moveSessionLeafMutation.error) ??
    getAgentWorkbenchOperationErrorMessage(
      appendSessionCompactionSummaryMutation.error
    )

  return {
    advanceGraphMutation,
    appendSessionCompactionSummaryMutation,
    executeNodeMutation,
    graphOperationErrorMessage,
    instantiateGraphMutation,
    moveSessionLeafMutation,
    respondApprovalMutation,
    retryNodeMutation,
    runGraphMutation,
    skipNodeMutation,
    sessionOperationErrorMessage,
    startStageMutation,
    updateRetryPolicyMutation
  }
}

const useAgentWorkbenchSelectionSync = ({
  preview,
  runs,
  runsById,
  selectedArtifactId,
  selectedRunId,
  selectedTemplateId,
  setSelectedArtifactId,
  setSelectedRunId,
  setSelectedTemplateId,
  templates
}: UseAgentWorkbenchSelectionSyncOptions) => {
  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null)
      return
    }

    if (!selectedRunId || !runsById.has(selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null)
    }
  }, [runs, runsById, selectedRunId, setSelectedRunId])

  useEffect(() => {
    if (
      templates.length > 0 &&
      !templates.some((template) => template.id === selectedTemplateId)
    ) {
      setSelectedTemplateId(templates[0]?.id ?? DEFAULT_RUN_GRAPH_TEMPLATE_ID)
    }
  }, [selectedTemplateId, setSelectedTemplateId, templates])

  useEffect(() => {
    const artifactIds = preview?.artifacts.map((artifact) => artifact.id) ?? []

    if (artifactIds.length === 0) {
      setSelectedArtifactId(null)
      return
    }

    if (!selectedArtifactId || !artifactIds.includes(selectedArtifactId)) {
      setSelectedArtifactId(artifactIds[0] ?? null)
    }
  }, [preview, selectedArtifactId, setSelectedArtifactId])
}

export const AgentWorkbenchPanel = ({
  gitDiff,
  isRequestPending,
  isProjectDiffLoading,
  mode = "embedded",
  retrySettings,
  sessionId
}: AgentWorkbenchPanelProps) => {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<AgentRunGraphTemplateId>(DEFAULT_RUN_GRAPH_TEMPLATE_ID)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null
  )
  const [taskText, setTaskText] = useState("")
  const runsQueryOptions = orpc.agents.listRuns.queryOptions({
    input: {
      limit: RUN_LIST_LIMIT,
      sessionId
    }
  })
  const approvalsQueryOptions = orpc.agents.listPendingApprovals.queryOptions({
    input: {
      sessionId
    }
  })
  const templatesQueryOptions = orpc.agents.listRunGraphTemplates.queryOptions(
    {}
  )
  const templatesQuery = useQuery({
    ...templatesQueryOptions
  })
  const runsQuery = useQuery({
    ...runsQueryOptions,
    refetchInterval: (query) =>
      getAgentWorkbenchRunsRefetchInterval({
        isRequestPending,
        runs: query.state.data?.runs ?? EMPTY_AGENT_RUNS
      })
  })
  const approvalsQuery = useQuery({
    ...approvalsQueryOptions,
    refetchInterval: (query) =>
      getAgentWorkbenchApprovalsRefetchInterval({
        approvalCount: query.state.data?.approvals.length ?? 0,
        isRequestPending
      })
  })
  const runs = runsQuery.data?.runs ?? EMPTY_AGENT_RUNS
  const approvals = approvalsQuery.data?.approvals ?? []
  const templates = templatesQuery.data?.templates ?? EMPTY_RUN_GRAPH_TEMPLATES
  const runsById = useMemo(
    () => new Map(runs.map((run) => [run.id, run])),
    [runs]
  )
  const selectedRun = getAgentWorkbenchSelectedRun({
    runsById,
    selectedRunId
  })
  const rootRun = getAgentWorkbenchRootRunOrNull({
    run: selectedRun,
    runsById
  })
  const inspectRunQuery = useQuery({
    ...orpc.agents.inspectRun.queryOptions({
      input: {
        runId: selectedRun?.id ?? "",
        sessionId
      }
    }),
    enabled: shouldInspectAgentWorkbenchSelectedRun(selectedRun)
  })
  const rootInspectRunQuery = useQuery({
    ...orpc.agents.inspectRun.queryOptions({
      input: {
        runId: rootRun?.id ?? "",
        sessionId
      }
    }),
    enabled: shouldInspectAgentWorkbenchRootRun({
      rootRun,
      selectedRun
    })
  })
  const sessionQueryOptions = orpc.agents.inspectSession.queryOptions({
    input: {
      runId: selectedRun?.id ?? "",
      sessionId
    }
  })
  const sessionQuery = useQuery({
    ...sessionQueryOptions,
    enabled: shouldInspectAgentWorkbenchSelectedRun(selectedRun)
  })
  const preview = getAgentWorkbenchPreview(inspectRunQuery.data)
  const backgroundProcesses = getAgentWorkbenchBackgroundProcessPreview(
    inspectRunQuery.data
  )
  const shellCommands = getAgentWorkbenchShellCommandPreview(
    inspectRunQuery.data
  )
  const shellOutputs = getAgentWorkbenchShellOutputPreview(inspectRunQuery.data)
  const rootTrace = getAgentWorkbenchRootTrace({
    inspectedRootRun: rootInspectRunQuery.data,
    inspectedRun: inspectRunQuery.data,
    rootRun,
    selectedRun
  })
  const graphPlan = getAgentWorkbenchGraphPlan(rootTrace)
  const graphRetries = getAgentWorkbenchGraphRetryPreview(rootTrace)
  const retryPolicy = getAgentWorkbenchRetryPolicyPreview(
    getAgentWorkbenchRetrySettings({
      graphPlan,
      retrySettings
    })
  )
  const failedNode = getAgentWorkbenchFirstFailedNode(graphPlan)
  const runningNode = getAgentWorkbenchFirstRunningNode(graphPlan)
  const pendingApprovals = getAgentWorkbenchPendingApprovals({
    approvals,
    rootRun,
    runsById
  })
  const artifactContentQuery = useQuery({
    ...orpc.agents.readArtifact.queryOptions({
      input: {
        artifactId: selectedArtifactId ?? "",
        maxChars: ARTIFACT_PREVIEW_MAX_CHARS,
        sessionId
      }
    }),
    enabled: selectedArtifactId !== null
  })
  const {
    advanceGraphMutation,
    appendSessionCompactionSummaryMutation,
    executeNodeMutation,
    graphOperationErrorMessage,
    instantiateGraphMutation,
    moveSessionLeafMutation,
    respondApprovalMutation,
    retryNodeMutation,
    runGraphMutation,
    sessionOperationErrorMessage,
    skipNodeMutation,
    startStageMutation,
    updateRetryPolicyMutation
  } = useAgentWorkbenchOperations({
    approvalsQueryKey: approvalsQueryOptions.queryKey,
    failedNode,
    rootRun,
    runningNode,
    runsQueryKey: runsQueryOptions.queryKey,
    selectedTemplateId,
    selectedRun,
    sessionId,
    sessionQueryKey: sessionQueryOptions.queryKey,
    setSelectedRunId,
    taskText
  })

  useAgentWorkbenchSelectionSync({
    preview,
    runs,
    runsById,
    selectedArtifactId,
    selectedRunId,
    selectedTemplateId,
    setSelectedArtifactId,
    setSelectedRunId,
    setSelectedTemplateId,
    templates
  })

  const handleRefresh = () => {
    refreshAgentWorkbenchQueries({
      approvalsQueryKey: approvalsQueryOptions.queryKey,
      queryClient,
      rootRun,
      runsQueryKey: runsQueryOptions.queryKey,
      sessionQueryKey: sessionQueryOptions.queryKey,
      selectedArtifactId,
      selectedRun,
      sessionId,
      templatesQueryKey: templatesQueryOptions.queryKey
    })
  }
  const isSessionMutationPending = hasPendingAgentWorkbenchSessionMutation({
    appendPending: appendSessionCompactionSummaryMutation.isPending,
    movePending: moveSessionLeafMutation.isPending
  })
  const workbenchContent = (
    <>
      <div className="flex min-w-0 items-center justify-end">
        <Button
          aria-label={t("chat.workbench.refresh")}
          isIconOnly
          onPress={handleRefresh}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={16} />
        </Button>
      </div>

      <AgentWorkbenchControls
        failedNode={failedNode}
        graphPlan={graphPlan}
        isAdvanceGraphPending={advanceGraphMutation.isPending}
        isApprovalResponsePending={respondApprovalMutation.isPending}
        isCreateGraphPending={instantiateGraphMutation.isPending}
        isExecuteNodePending={executeNodeMutation.isPending}
        isRetryNodePending={retryNodeMutation.isPending}
        isRunGraphPending={runGraphMutation.isPending}
        isSkipNodePending={skipNodeMutation.isPending}
        isStartStagePending={startStageMutation.isPending}
        onAdvanceGraph={() => advanceGraphMutation.mutate()}
        onCreateGraph={() => instantiateGraphMutation.mutate()}
        onExecuteNode={() => executeNodeMutation.mutate()}
        onRetryNode={() => retryNodeMutation.mutate()}
        onRunGraph={() => runGraphMutation.mutate()}
        onSelectedTemplateIdChange={setSelectedTemplateId}
        onSkipNode={() => skipNodeMutation.mutate()}
        onStartStage={() => startStageMutation.mutate()}
        onTaskTextChange={setTaskText}
        operationErrorMessage={graphOperationErrorMessage}
        selectedTemplateId={selectedTemplateId}
        taskText={taskText}
        templates={templates}
      />

      <AgentWorkbenchApprovalInbox
        approvals={pendingApprovals}
        isPending={respondApprovalMutation.isPending}
        onRespond={(input) => respondApprovalMutation.mutate(input)}
      />

      <AgentWorkbenchGraphPlanPanel
        graphPlan={graphPlan}
        isRetryPolicyPending={updateRetryPolicyMutation.isPending}
        onRetryPolicyChange={(policy) =>
          updateRetryPolicyMutation.mutate(policy)
        }
        onSelectRun={setSelectedRunId}
        retryPolicy={retryPolicy}
        retries={graphRetries}
      />

      <AgentWorkbenchSessionPanel
        isLoading={sessionQuery.isFetching}
        isPending={isSessionMutationPending}
        onAppendCompactionSummary={(summary) =>
          appendSessionCompactionSummaryMutation.mutate(summary)
        }
        onMoveLeaf={(input) => moveSessionLeafMutation.mutate(input)}
        operationErrorMessage={sessionOperationErrorMessage}
        snapshot={sessionQuery.data ?? null}
      />

      <AgentWorkbenchDiffPanel
        gitDiff={gitDiff}
        isLoading={isProjectDiffLoading}
      />

      <div
        className={cn(
          "mt-3 grid min-h-0 gap-3 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)]",
          runGridHeightClassNameByMode[mode]
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border/50 bg-muted/20 p-2">
          <div className="min-h-0 flex-1">
            <AgentRunGraphList
              emptyLabel={t("chat.workbench.emptyRuns")}
              onSelectRun={setSelectedRunId}
              runs={runs}
              runsById={runsById}
              selectedRunId={selectedRunId}
            />
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border/50 bg-muted/20 p-2">
          <SelectedRunDetails
            artifactContent={artifactContentQuery.data ?? null}
            backgroundProcesses={backgroundProcesses}
            isArtifactContentLoading={artifactContentQuery.isFetching}
            isLoading={inspectRunQuery.isFetching}
            onSelectArtifact={setSelectedArtifactId}
            preview={preview}
            run={selectedRun}
            selectedArtifactId={selectedArtifactId}
            shellCommands={shellCommands}
            shellOutputs={shellOutputs}
          />
        </div>
      </div>
    </>
  )

  return (
    <AgentWorkbenchPanelChrome
      approvalCount={pendingApprovals.length}
      mode={mode}
      runs={runs}
    >
      {workbenchContent}
    </AgentWorkbenchPanelChrome>
  )
}
