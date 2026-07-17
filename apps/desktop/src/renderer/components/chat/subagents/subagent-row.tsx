import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Disclosure, Tooltip } from "@heroui/react"
import {
  BrainIcon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  WorkflowSquare02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { memo, useMemo, useState } from "react"
import type { ReactNode } from "react"

import {
  useWorkElapsedMs,
  WORK_DISCLOSURE_TRIGGER_CLASS_NAME,
  WorkTextEntry,
  WorkThinkingEntry,
  WorkTodoEntry,
  WorkToolGroupEntry
} from "@/renderer/components/chat/work-entries"
import type { Translate } from "@/renderer/components/chat/work-entries"
import {
  buildAssistantChainEntries,
  getAssistantBodyText,
  groupChainEntries
} from "@/renderer/lib/chat/assistant-message-timeline"
import type { ChatUiMessage } from "@/renderer/lib/chat/assistant-message-timeline"
import {
  isUnsettledRunStatus,
  traceToolCallsToParts
} from "@/renderer/lib/chat/subagent-view-model"
import type {
  SubagentDisplayStatus,
  SubagentRowBody,
  SubagentRowViewModel
} from "@/renderer/lib/chat/subagent-view-model"
import { orpc } from "@/renderer/lib/rpc"
import { formatElapsedDuration } from "@/renderer/lib/utils"
import { deriveCommandApprovalPattern } from "@/shared/agents/command-allowlist"
import type { ChatSubagentApprovalData } from "@/shared/chat/stream-data"

// Poll a still-in-flight child run's trace until it settles.
const UNSETTLED_RUN_REFETCH_MS = 2000

const SubagentStatusIcon = ({
  status,
  t
}: {
  status: SubagentDisplayStatus
  t: Translate
}) => {
  if (status === "running") {
    return (
      <span
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground"
        title={t("chat.subagent.running")}
      />
    )
  }

  if (status === "succeeded") {
    return (
      <HugeiconsIcon
        aria-label={t("chat.subagent.succeeded")}
        className="shrink-0 text-success"
        icon={CheckmarkCircle01Icon}
        size={13}
      />
    )
  }

  return (
    <HugeiconsIcon
      aria-label={t(
        status === "aborted" ? "chat.subagent.aborted" : "chat.subagent.failed"
      )}
      className="shrink-0 text-danger"
      icon={Cancel01Icon}
      size={13}
    />
  )
}

// Blocking approval prompt for a writable child's edit/write/bash call. Owns its
// own respondToApproval mutation (leaf-owns-its-request, like the lazy trace
// body) and disables its buttons once answered; the resolved stream part then
// drops the card from the store.
const SubagentApprovalCard = ({
  approval
}: {
  approval: ChatSubagentApprovalData
}) => {
  const { t } = useI18n()
  const [submitted, setSubmitted] = useState(false)
  const mutation = useMutation(orpc.agents.respondToApproval.mutationOptions())
  const isDisabled = submitted || mutation.isPending

  const respond = (approved: boolean, rememberCommand?: boolean): void => {
    setSubmitted(true)
    mutation.mutate({
      approvalId: approval.approvalId,
      approved,
      ...(rememberCommand ? { rememberCommand } : {})
    })
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2",
        approval.dangerous
          ? "border-danger/50 bg-danger/5"
          : "border-amber-500/40 bg-amber-500/5"
      )}
    >
      <span className="text-xs font-medium text-foreground">
        {t("chat.subagent.approvalTitle", { tool: approval.toolName })}
      </span>
      <code className="block truncate rounded bg-muted px-2 py-1 text-[0.7rem] text-muted-foreground">
        {approval.commandOrPath}
      </code>
      {approval.dangerous ? (
        <p className="text-[0.7rem] text-danger">
          {t("chat.subagent.approvalDanger")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          isDisabled={isDisabled}
          onPress={() => respond(true)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} />
          {t("chat.toolTrace.approve")}
        </Button>
        {approval.canRemember ? (
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isDisabled={isDisabled}
                onPress={() => respond(true, true)}
                size="sm"
                type="button"
                variant="secondary"
              >
                <HugeiconsIcon icon={BrainIcon} size={13} />
                {t("chat.toolTrace.approveAndRemember")}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">
              {t("chat.toolTrace.rememberPatternHint", {
                pattern:
                  deriveCommandApprovalPattern(approval.commandOrPath) ??
                  approval.commandOrPath
              })}
            </Tooltip.Content>
          </Tooltip>
        ) : null}
        <Button
          isDisabled={isDisabled}
          onPress={() => respond(false)}
          size="sm"
          type="button"
          variant="danger-soft"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} />
          {t("chat.toolTrace.deny")}
        </Button>
      </div>
    </div>
  )
}

// Renders a child run's message parts with the same collapsed entry components
// the parent timeline uses; the child's trailing answer text is kept inside the
// row (not promoted to a body) so nothing leaks out of the nested disclosure.
const SubagentMiniTimeline = memo(
  ({
    isRunActive,
    parts
  }: {
    isRunActive: boolean
    parts: ChatUiMessage["parts"]
  }) => {
    const entries = groupChainEntries(buildAssistantChainEntries({ parts }))
    const bodyText = getAssistantBodyText({ parts })

    if (entries.length === 0 && bodyText.trim().length === 0) {
      return null
    }

    return (
      <div className="flex flex-col gap-1">
        {entries.map((entry) => {
          if (entry.kind === "reasoning") {
            return (
              <WorkThinkingEntry
                isRunActive={isRunActive}
                key={entry.key}
                streaming={entry.streaming}
                text={entry.text}
              />
            )
          }

          if (entry.kind === "text") {
            return (
              <div className="px-2 py-1" key={entry.key}>
                <WorkTextEntry text={entry.text} />
              </div>
            )
          }

          // A read-only child never nests further sub-agents nor asks for input.
          if (entry.kind === "subagent-call" || entry.kind === "input-tool") {
            return null
          }

          // A child's checklist has no live run id here, so it renders from the
          // forwarded tool-call input.
          if (entry.kind === "todo") {
            return <WorkTodoEntry key={entry.key} part={entry.part} />
          }

          return (
            <WorkToolGroupEntry
              entry={entry}
              isApprovalActionDisabled
              key={entry.key}
            />
          )
        })}
        {bodyText.trim().length > 0 ? (
          <div className="px-2 py-1">
            <WorkTextEntry text={bodyText} />
          </div>
        ) : null}
      </div>
    )
  }
)
SubagentMiniTimeline.displayName = "SubagentMiniTimeline"

// Lazy history body: reopens a settled child run through the inspector and maps
// its recorded tool calls into the same mini timeline. Mounted only on expand,
// and keeps polling while the run is still in flight.
const SubagentTraceBody = memo(({ runId }: { runId: string }) => {
  const { t } = useI18n()
  const query = useQuery({
    ...orpc.agents.inspectRun.queryOptions({ input: { runId } }),
    refetchInterval: (runQuery) => {
      const status = runQuery.state.data?.run.status

      return status !== undefined && isUnsettledRunStatus(status)
        ? UNSETTLED_RUN_REFETCH_MS
        : false
    }
  })
  const toolCalls = query.data?.toolCalls
  const parts = useMemo(
    () => (toolCalls === undefined ? [] : traceToolCallsToParts(toolCalls)),
    [toolCalls]
  )

  if (query.isPending) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {t("chat.subagent.loading")}
      </p>
    )
  }

  if (query.isError || !query.data) {
    return (
      <p className="px-2 py-1 text-xs text-destructive">
        {t("chat.subagent.loadFailed")}
      </p>
    )
  }

  return <SubagentMiniTimeline isRunActive={false} parts={parts} />
})
SubagentTraceBody.displayName = "SubagentTraceBody"

const renderSubagentBody = (body: SubagentRowBody): ReactNode => {
  switch (body.kind) {
    case "live-parts": {
      return (
        <SubagentMiniTimeline
          isRunActive={body.isRunActive}
          parts={body.parts}
        />
      )
    }
    case "trace": {
      return <SubagentTraceBody runId={body.runId} />
    }
    case "summary": {
      return (
        <div className="px-2 py-1">
          <WorkTextEntry text={body.text} />
        </div>
      )
    }
    default: {
      return null
    }
  }
}

// One nested sub-agent row: a collapsed header (profile + task + live activity +
// timer + outcome) that expands to a lazily-rendered mini timeline. A pending
// approval pins the row open, flips the status dot to a waiting cue, and renders
// the prompt above the body.
const SubagentRowView = memo(({ model }: { model: SubagentRowViewModel }) => {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)
  const hasApproval = model.approvals.length > 0
  const expanded = hasApproval || isExpanded
  const isRunning = model.status === "running"
  const elapsedMs = useWorkElapsedMs({
    liveStartedAt: isRunning ? model.startedAtMs : undefined,
    workTimeMs: model.durationMs
  })
  const durationText =
    elapsedMs === undefined ? "" : formatElapsedDuration(elapsedMs)
  const fallbackTitle =
    model.origin === "workflow"
      ? t("chat.workSection.ranWorkflow")
      : t("chat.workSection.delegatedTask")

  return (
    <Disclosure
      aria-label={t("chat.subagent.viewDetails")}
      className="overflow-hidden rounded-lg"
      isExpanded={expanded}
      onExpandedChange={setIsExpanded}
    >
      <Disclosure.Heading className="rounded-lg">
        <Button
          className={WORK_DISCLOSURE_TRIGGER_CLASS_NAME}
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <HugeiconsIcon
              className="shrink-0 text-muted-foreground"
              icon={WorkflowSquare02Icon}
              size={14}
            />
            <span className="shrink-0 truncate text-xs font-medium text-foreground">
              {model.profileId || fallbackTitle}
            </span>
            {model.task ? (
              <span className="truncate text-xs text-muted-foreground">
                {model.task}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {isRunning && model.activity && !hasApproval ? (
              <span className="max-w-40 shimmer truncate text-[0.625rem] text-muted-foreground">
                {model.activity}
              </span>
            ) : null}
            {durationText ? (
              <span className="text-[0.625rem] text-muted-foreground tabular-nums">
                {durationText}
              </span>
            ) : null}
            {hasApproval ? (
              <span
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                title={t("chat.workSection.waitingApproval")}
              />
            ) : (
              <SubagentStatusIcon status={model.status} t={t} />
            )}
            <Disclosure.Indicator />
          </span>
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-1 pt-1 pb-1">
          {expanded ? (
            <div className="flex flex-col gap-1">
              {model.approvals.map((approval) => (
                <SubagentApprovalCard
                  approval={approval}
                  key={approval.approvalId}
                />
              ))}
              {renderSubagentBody(model.body)}
            </div>
          ) : null}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
})
SubagentRowView.displayName = "SubagentRowView"

export { SubagentRowView }
