import { useI18n } from "@etyon/i18n/react"
import type {
  AgentRunTraceRun,
  AgentRunTraceToolCall,
  StreamdownAnimation
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { ChainOfThought } from "@heroui-pro/react"
import { Button, Disclosure } from "@heroui/react"
import {
  BrainIcon,
  BrowserIcon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  WorkflowSquare02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import type { UIMessage } from "ai"
import { getToolName } from "ai"
import { useEffect, useRef, useState } from "react"
import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { Streamdown } from "streamdown"
import type { Components, ExtraProps } from "streamdown"

import { ImagenMessageImage } from "@/renderer/components/chat/imagen-message"
import { StructuredToolTraceCard } from "@/renderer/components/chat/message-tool-trace"
import {
  getPublishedArtifactRef,
  isArtifactToolPart
} from "@/renderer/lib/chat/artifact-panel"
import type { ChatArtifactRef } from "@/renderer/lib/chat/artifact-panel"
import {
  buildAssistantChainEntries,
  getAssistantBodyText,
  getRunLimitData,
  getUrlHost,
  getWorkSectionInitialExpanded,
  getWorkSectionStatus,
  groupChainEntries,
  hasPendingApproval,
  isReferencePart,
  isToolGroupRunning,
  isWorkSectionForcedExpanded,
  isWorkSectionSelfCollapsing,
  openExternalUrl,
  shouldReopenWorkSection
} from "@/renderer/lib/chat/assistant-message-timeline"
import type {
  ChatToolPart,
  ChatUiMessage,
  FileChatPart,
  GroupedChainEntry,
  SourceDocumentChatPart,
  SourceUrlChatPart,
  ToolGroupLabel,
  WorkSectionStatus
} from "@/renderer/lib/chat/assistant-message-timeline"
import { isImagenToolPart } from "@/renderer/lib/chat/imagen-message"
import { parseChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import { getToolIcon } from "@/renderer/lib/chat/message-tool-trace"
import { getStreamdownAnimateOptions } from "@/renderer/lib/chat/streamdown-settings"
import {
  useHasSubagentApprovalPending,
  useSubagentApprovals,
  useSubagentChildIds,
  useSubagentLive
} from "@/renderer/lib/chat/subagent-stream-store"
import type { SubagentLiveStatus } from "@/renderer/lib/chat/subagent-stream-store"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import { orpc } from "@/renderer/lib/rpc"
import {
  formatElapsedDuration,
  getString,
  isRecord
} from "@/renderer/lib/utils"
import type { ChatSubagentApprovalData } from "@/shared/chat/stream-data"

type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & ExtraProps

type Translate = ReturnType<typeof useI18n>["t"]

const STREAMDOWN_MARKDOWN_CLASS_NAME = cn(
  "min-w-0 text-sm leading-6 text-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_li]:my-1",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-2",
  "[&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_[data-streamdown=code-block]]:my-3 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-lg [&_[data-streamdown=code-block]]:border-border/80 [&_[data-streamdown=code-block]]:bg-muted/80 [&_[data-streamdown=code-block]]:p-0",
  "[&_[data-streamdown=code-block-actions]]:top-0 [&_[data-streamdown=code-block-actions]]:-mt-8 [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity",
  "[&_[data-streamdown=code-block-actions]>div]:border-0 [&_[data-streamdown=code-block-actions]>div]:bg-transparent [&_[data-streamdown=code-block-actions]>div]:px-2",
  "[&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100",
  "[&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100",
  "[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0",
  "[&_[data-streamdown=code-block-body]>pre]:bg-transparent [&_[data-streamdown=code-block-body]>pre]:p-3",
  "[&_[data-streamdown=code-block-header]]:h-8 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-border/60 [&_[data-streamdown=code-block-header]]:px-3",
  "[&_[data-streamdown=code-block-header]>span]:ml-0",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
)

// Intermediate narration lives inside the collapsed timeline: smaller, muted,
// and a compact subset of the body markdown styling.
const CHAIN_TEXT_MARKDOWN_CLASS_NAME = cn(
  "min-w-0 text-xs leading-5 text-muted-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  // Sub-agent output can carry full markdown headings; inside a nested row they
  // stay body-sized, only bolded, so the timeline keeps one visual scale.
  "[&_h1]:my-1.5 [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:text-foreground/90",
  "[&_h2]:my-1.5 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground/90",
  "[&_h3]:my-1 [&_h3]:text-xs [&_h3]:font-semibold",
  "[&_h4]:my-1 [&_h4]:text-xs [&_h4]:font-medium",
  "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4",
  "[&_p]:my-1",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4"
)

const WORK_DISCLOSURE_TRIGGER_CLASS_NAME =
  "h-auto min-h-8 w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted/40 data-[hovered=true]:bg-muted/40"

const MarkdownTable = ({
  children,
  className,
  node: _node,
  ...props
}: MarkdownTableProps) => (
  <table
    className={cn("my-3 w-full border-collapse text-sm", className)}
    {...props}
  >
    {children}
  </table>
)

const STREAMDOWN_MARKDOWN_COMPONENTS = {
  table: MarkdownTable
} satisfies Components

const AssistantMarkdownContent = ({
  isAnimating,
  streamdownAnimation,
  text
}: {
  isAnimating: boolean
  streamdownAnimation: StreamdownAnimation
  text: string
}) => {
  if (!text.trim()) {
    return null
  }

  const animated = isAnimating
    ? false
    : getStreamdownAnimateOptions(streamdownAnimation)

  return (
    <Streamdown
      animated={animated}
      className={STREAMDOWN_MARKDOWN_CLASS_NAME}
      components={STREAMDOWN_MARKDOWN_COMPONENTS}
      isAnimating={false}
      skipHtml
    >
      {text}
    </Streamdown>
  )
}

const getToolGroupLabelText = (t: Translate, label: ToolGroupLabel): string => {
  switch (label.kind) {
    case "editedFile": {
      return t("chat.workSection.editedFile", { name: label.name })
    }
    case "editedFiles": {
      return t("chat.workSection.editedFiles", { count: label.count })
    }
    case "exploredFile": {
      return t("chat.workSection.exploredFile")
    }
    case "exploredFiles": {
      return t("chat.workSection.exploredFiles", { count: label.count })
    }
    case "exploredProject": {
      return t("chat.workSection.exploredProject")
    }
    case "ranCommand": {
      return t("chat.workSection.ranCommand")
    }
    case "ranCommands": {
      return t("chat.workSection.ranCommands", { count: label.count })
    }
    case "readFile": {
      return t("chat.workSection.readFile", { name: label.name })
    }
    case "usedTool": {
      return t("chat.workSection.usedTool")
    }
    default: {
      return t("chat.workSection.usedTools", { count: label.count })
    }
  }
}

const getWorkSectionLabelText = (
  t: Translate,
  status: WorkSectionStatus,
  duration: string
): string => {
  switch (status) {
    case "failed": {
      return t("chat.workSection.failedAfter", { duration })
    }
    case "stopped": {
      return t("chat.workSection.stoppedAfter", { duration })
    }
    case "waiting": {
      return t("chat.workSection.waitingApproval")
    }
    case "working": {
      return t("chat.workSection.working")
    }
    default: {
      return t("chat.workSection.worked", { duration })
    }
  }
}

// Ticks a live elapsed time while the run is active, then freezes the last
// value until the persisted `workTimeMs` arrives (or replaces it outright).
const useWorkElapsedMs = ({
  liveStartedAt,
  workTimeMs
}: {
  liveStartedAt?: number
  workTimeMs?: number
}): number | undefined => {
  const [elapsedMs, setElapsedMs] = useState<number>()

  useEffect(() => {
    if (workTimeMs !== undefined || liveStartedAt === undefined) {
      return
    }

    const update = () => setElapsedMs(Math.max(0, Date.now() - liveStartedAt))

    update()
    const intervalId = window.setInterval(update, 200)

    return () => window.clearInterval(intervalId)
  }, [liveStartedAt, workTimeMs])

  return workTimeMs ?? elapsedMs
}

const WorkTextEntry = ({ text }: { text: string }) => (
  <Streamdown
    animated={false}
    className={CHAIN_TEXT_MARKDOWN_CLASS_NAME}
    isAnimating={false}
    skipHtml
  >
    {text}
  </Streamdown>
)

const WorkThinkingEntry = ({
  durationMs,
  isRunActive,
  streaming,
  text
}: {
  durationMs?: number
  isRunActive: boolean
  streaming: boolean
  text: string
}) => {
  const { t } = useI18n()
  const isStreaming = isRunActive && streaming
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const [localDurationMs, setLocalDurationMs] = useState<number>()
  const startedAtRef = useRef<number | null>(null)

  // Auto-expand live, auto-collapse once the block settles; user toggles after.
  useEffect(() => {
    setIsExpanded(isStreaming)
  }, [isStreaming])

  // Local fallback timing until the persisted duration lands.
  useEffect(() => {
    if (isStreaming) {
      startedAtRef.current ??= Date.now()
      return
    }

    if (startedAtRef.current !== null && localDurationMs === undefined) {
      setLocalDurationMs(Math.max(0, Date.now() - startedAtRef.current))
    }
  }, [isStreaming, localDurationMs])

  if (isStreaming) {
    return (
      <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
        {text}
      </p>
    )
  }

  const resolvedDurationMs = durationMs ?? localDurationMs
  const label =
    resolvedDurationMs === undefined
      ? t("chat.workSection.thoughtPlain")
      : t("chat.workSection.thought", {
          duration: formatElapsedDuration(resolvedDurationMs)
        })

  return (
    <Disclosure
      className="overflow-hidden rounded-lg"
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <Disclosure.Heading className="rounded-lg">
        <Button
          className={WORK_DISCLOSURE_TRIGGER_CLASS_NAME}
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon
              className="shrink-0 text-muted-foreground"
              icon={BrainIcon}
              size={14}
            />
            <span className="truncate text-xs">{label}</span>
          </span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-2 pt-1 pb-2">
          <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {text}
          </p>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

const WorkToolGroupEntry = ({
  entry,
  isApprovalActionDisabled,
  onApprovalResponse
}: {
  entry: Extract<GroupedChainEntry, { kind: "tool-group" }>
  isApprovalActionDisabled: boolean
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
}) => {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(entry.hasApproval)
  const firstTool = entry.tools[0]?.part
  const icon = firstTool ? getToolIcon(getToolName(firstTool)) : getToolIcon("")
  const isRunning = !entry.hasApproval && isToolGroupRunning(entry.tools)

  useEffect(() => {
    if (entry.hasApproval) {
      setIsExpanded(true)
    }
  }, [entry.hasApproval])

  return (
    <Disclosure
      className="overflow-hidden rounded-lg"
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <Disclosure.Heading className="rounded-lg">
        <Button
          className={WORK_DISCLOSURE_TRIGGER_CLASS_NAME}
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon
              className="shrink-0 text-muted-foreground"
              icon={icon}
              size={14}
            />
            <span className={cn("truncate text-xs", isRunning && "shimmer")}>
              {getToolGroupLabelText(t, entry.label)}
            </span>
          </span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="space-y-1.5 px-1 pt-1 pb-1">
          {entry.tools.map((tool) => (
            <StructuredToolTraceCard
              isApprovalActionDisabled={isApprovalActionDisabled}
              key={tool.part.toolCallId}
              onApprovalResponse={(toolPart, approved, options) => {
                onApprovalResponse(toolPart as ChatToolPart, approved, options)
              }}
              part={tool.part as never}
              repeatCount={tool.repeatCount}
            />
          ))}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

// Children are read-only, so their trace never carries an approval to act on.
const NOOP_APPROVAL_RESPONSE = (): void => {
  // no-op
}
// The read-only profile every workflow agent runs as; used to scope a workflow
// card's history children away from sibling delegate runs under the same parent.
const WORKFLOW_CHILD_PROFILE_ID = "explore"

const getPartInput = (part: ChatToolPart): unknown =>
  (part as { input?: unknown }).input

const getPartOutput = (part: ChatToolPart): unknown =>
  (part as { output?: unknown }).output

const mapRunStatusToSubagentStatus = (
  status: AgentRunTraceRun["status"]
): SubagentLiveStatus => {
  if (status === "succeeded") {
    return "succeeded"
  }

  if (status === "failed") {
    return "failed"
  }

  if (status === "superseded") {
    return "aborted"
  }

  return "running"
}

const toHistoryToolPart = (
  toolCall: AgentRunTraceToolCall
): UIMessage["parts"][number] => {
  const base = {
    input: toolCall.input,
    toolCallId: toolCall.id,
    type: `tool-${toolCall.toolName}`
  }

  if (toolCall.state === "failed") {
    return {
      ...base,
      errorText: toolCall.errorMessage ?? "error",
      state: "output-error"
    } as UIMessage["parts"][number]
  }

  return {
    ...base,
    output: toolCall.output,
    state: "output-available"
  } as UIMessage["parts"][number]
}

const SubagentStatusIcon = ({
  status,
  t
}: {
  status: SubagentLiveStatus
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

// Renders a child run's message parts with the same collapsed entry components
// the parent timeline uses; the child's trailing answer text is kept inside the
// row (not promoted to a body) so nothing leaks out of the nested disclosure.
const SubagentMiniTimeline = ({
  isRunActive,
  parts
}: {
  isRunActive: boolean
  parts: UIMessage["parts"]
}) => {
  const message = {
    id: "subagent",
    parts,
    role: "assistant"
  } as unknown as ChatUiMessage
  const entries = groupChainEntries(buildAssistantChainEntries(message))
  const bodyText = getAssistantBodyText(message)

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

        // A read-only child never nests further sub-agents.
        if (entry.kind === "subagent-call") {
          return null
        }

        return (
          <WorkToolGroupEntry
            entry={entry}
            isApprovalActionDisabled
            key={entry.key}
            onApprovalResponse={NOOP_APPROVAL_RESPONSE}
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

// One nested sub-agent row: a collapsed header (profile + task + live activity +
// timer + outcome) that expands to a lazily-rendered mini timeline. A pending
// approval pins the row open, flips the status dot to a waiting cue, and renders
// the prompt above the body.
const SubagentRow = ({
  activity,
  approvals,
  durationMs,
  fallbackTitle,
  profileId,
  renderBody,
  startedAtMs,
  status,
  task
}: {
  activity?: string
  approvals?: ChatSubagentApprovalData[]
  durationMs?: number
  fallbackTitle: string
  profileId: string
  renderBody: () => ReactNode
  startedAtMs?: number
  status: SubagentLiveStatus
  task?: string
}) => {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)
  const pendingApprovals = approvals ?? []
  const hasApproval = pendingApprovals.length > 0
  const expanded = hasApproval || isExpanded
  const isRunning = status === "running"
  const elapsedMs = useWorkElapsedMs({
    liveStartedAt: isRunning ? startedAtMs : undefined,
    workTimeMs: durationMs
  })
  const durationText =
    elapsedMs === undefined ? "" : formatElapsedDuration(elapsedMs)

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
              {profileId || fallbackTitle}
            </span>
            {task ? (
              <span className="truncate text-xs text-muted-foreground">
                {task}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {isRunning && activity && !hasApproval ? (
              <span className="max-w-40 shimmer truncate text-[0.625rem] text-muted-foreground">
                {activity}
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
              <SubagentStatusIcon status={status} t={t} />
            )}
            <Disclosure.Indicator />
          </span>
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-1 pt-1 pb-1">
          {expanded ? (
            <div className="flex flex-col gap-1">
              {pendingApprovals.map((approval) => (
                <SubagentApprovalCard
                  approval={approval}
                  key={approval.approvalId}
                />
              ))}
              {renderBody()}
            </div>
          ) : null}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

// Lazy history body: reopens a settled child run through the inspector and maps
// its recorded tool calls into the same mini timeline. Only mounted on expand.
const SubagentTraceLazyBody = ({ runId }: { runId: string }) => {
  const { t } = useI18n()
  const query = useQuery(
    orpc.agents.inspectRun.queryOptions({ input: { runId } })
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

  return (
    <SubagentMiniTimeline
      isRunActive={false}
      parts={query.data.toolCalls.map(toHistoryToolPart)}
    />
  )
}

const SubagentLiveRow = ({ childRunId }: { childRunId: string }) => {
  const { t } = useI18n()
  const live = useSubagentLive(childRunId)
  const approvals = useSubagentApprovals(childRunId)

  if (!live) {
    return null
  }

  return (
    <SubagentRow
      activity={live.activity}
      approvals={approvals}
      durationMs={live.durationMs}
      fallbackTitle={t("chat.workSection.delegatedTask")}
      profileId={live.meta.profileId}
      renderBody={() => (
        <SubagentMiniTimeline
          isRunActive={live.status === "running"}
          parts={live.parts}
        />
      )}
      startedAtMs={live.startedAtMs}
      status={live.status}
      task={live.meta.task}
    />
  )
}

const DelegateHistoryRow = ({ part }: { part: ChatToolPart }) => {
  const { t } = useI18n()
  const input = getPartInput(part)
  const inputRecord = isRecord(input) ? input : undefined
  const output = getPartOutput(part)
  const outputRecord =
    part.state === "output-available" && isRecord(output) ? output : undefined
  const childRunId = outputRecord
    ? getString(outputRecord, "childRunId")
    : undefined
  const summary = outputRecord ? getString(outputRecord, "summary") : undefined
  let status: SubagentLiveStatus = "running"

  if (part.state === "output-available") {
    status = "succeeded"
  } else if (part.state === "output-error" || part.state === "output-denied") {
    status = "failed"
  }

  return (
    <SubagentRow
      fallbackTitle={t("chat.workSection.delegatedTask")}
      profileId={inputRecord ? (getString(inputRecord, "profileId") ?? "") : ""}
      renderBody={() => {
        if (childRunId) {
          return <SubagentTraceLazyBody runId={childRunId} />
        }

        return summary ? (
          <div className="px-2 py-1">
            <WorkTextEntry text={summary} />
          </div>
        ) : null
      }}
      status={status}
      task={inputRecord ? getString(inputRecord, "task") : undefined}
    />
  )
}

const WorkflowHistoryRunRow = ({ run }: { run: AgentRunTraceRun }) => {
  const { t } = useI18n()
  const durationMs = run.finishedAt
    ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))
    : undefined

  return (
    <SubagentRow
      {...(durationMs === undefined ? {} : { durationMs })}
      fallbackTitle={t("chat.workSection.ranWorkflow")}
      profileId={run.profileId}
      renderBody={() => <SubagentTraceLazyBody runId={run.id} />}
      status={mapRunStatusToSubagentStatus(run.status)}
    />
  )
}

// History fallback for a workflow card's children. Scoped to the read-only
// workflow profile so sibling delegate runs under the same parent don't leak in
// (runs link to their parent run, not the specific tool call).
const WorkflowHistoryChildren = ({ parentRunId }: { parentRunId: string }) => {
  const { t } = useI18n()
  const query = useQuery(
    orpc.agents.listRuns.queryOptions({ input: { parentRunId } })
  )

  if (query.isPending || query.isError || !query.data) {
    return null
  }

  const runs = query.data.runs
    .filter(
      (run: AgentRunTraceRun) => run.profileId === WORKFLOW_CHILD_PROFILE_ID
    )
    .toReversed()

  if (runs.length === 0) {
    return null
  }

  return (
    <div
      aria-label={t("chat.workSection.ranWorkflow")}
      className="flex flex-col gap-1"
    >
      {runs.map((run: AgentRunTraceRun) => (
        <WorkflowHistoryRunRow key={run.id} run={run} />
      ))}
    </div>
  )
}

const WorkflowSubagentEntry = ({
  isApprovalActionDisabled,
  liveChildIds,
  onApprovalResponse,
  parentRunId,
  part
}: {
  isApprovalActionDisabled: boolean
  liveChildIds: string[]
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  parentRunId?: string
  part: ChatToolPart
}) => {
  const { t } = useI18n()

  return (
    <div className="flex flex-col gap-1">
      <StructuredToolTraceCard
        isApprovalActionDisabled={isApprovalActionDisabled}
        onApprovalResponse={(toolPart, approved, options) => {
          onApprovalResponse(toolPart as ChatToolPart, approved, options)
        }}
        part={part as never}
      />
      {liveChildIds.length > 0 ? (
        <div
          aria-label={t("chat.workSection.ranWorkflow")}
          className="flex flex-col gap-1 pl-3"
        >
          {liveChildIds.map((childRunId) => (
            <SubagentLiveRow childRunId={childRunId} key={childRunId} />
          ))}
        </div>
      ) : parentRunId ? (
        <div className="pl-3">
          <WorkflowHistoryChildren parentRunId={parentRunId} />
        </div>
      ) : null}
    </div>
  )
}

const WorkSubagentEntry = ({
  entry,
  isApprovalActionDisabled,
  onApprovalResponse,
  parentRunId
}: {
  entry: Extract<GroupedChainEntry, { kind: "subagent-call" }>
  isApprovalActionDisabled: boolean
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  parentRunId?: string
}) => {
  const liveChildIds = useSubagentChildIds(entry.part.toolCallId)

  if (entry.toolName === "workflow") {
    return (
      <WorkflowSubagentEntry
        isApprovalActionDisabled={isApprovalActionDisabled}
        liveChildIds={liveChildIds}
        onApprovalResponse={onApprovalResponse}
        parentRunId={parentRunId}
        part={entry.part}
      />
    )
  }

  const [childRunId] = liveChildIds

  if (childRunId) {
    return <SubagentLiveRow childRunId={childRunId} />
  }

  return <DelegateHistoryRow part={entry.part} />
}

const AssistantWorkSection = ({
  entries,
  exitReason,
  isApprovalActionDisabled,
  isRunActive,
  liveWorkTimeStartedAt,
  onApprovalResponse,
  parentRunId,
  thoughtDurationsMs,
  workTimeMs
}: {
  entries: GroupedChainEntry[]
  exitReason?: string | null
  isApprovalActionDisabled: boolean
  isRunActive: boolean
  liveWorkTimeStartedAt?: number
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  parentRunId?: string
  thoughtDurationsMs?: number[]
  workTimeMs?: number
}) => {
  const { t } = useI18n()
  // A gated tool part (parent) OR a delegated child awaiting approval both pin
  // the header to "Waiting for approval…". The child signal is global, so scope
  // it to the live turn — a settled message must not react to a later run's child.
  const hasSubagentApproval = useHasSubagentApprovalPending()
  const status = getWorkSectionStatus({
    exitReason,
    hasApprovalPending:
      hasPendingApproval(entries) || (isRunActive && hasSubagentApproval),
    isRunActive
  })
  const forcedExpanded = isWorkSectionForcedExpanded(status)
  const [isExpanded, setIsExpanded] = useState(() =>
    getWorkSectionInitialExpanded(status)
  )
  const wasForcedRef = useRef(forcedExpanded)
  const previousStatusRef = useRef(status)

  useEffect(() => {
    if (forcedExpanded) {
      wasForcedRef.current = true
      return
    }

    // On the running → settled edge, a normal completion collapses; an
    // interrupted/failed run stays open. Afterwards, user toggles win.
    if (wasForcedRef.current) {
      wasForcedRef.current = false
      setIsExpanded(!isWorkSectionSelfCollapsing(status))
    }
  }, [forcedExpanded, status])

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = status

    if (shouldReopenWorkSection(previousStatus, status)) {
      setIsExpanded(true)
    }
  }, [status])

  const elapsedMs = useWorkElapsedMs({
    liveStartedAt: isRunActive ? liveWorkTimeStartedAt : undefined,
    workTimeMs
  })
  const durationText =
    elapsedMs === undefined ? "" : formatElapsedDuration(elapsedMs)
  const isLive = status === "working" || status === "waiting"

  if (entries.length === 0) {
    return null
  }

  return (
    <ChainOfThought
      className={cn(
        "rounded-xl",
        isLive
          ? "border-0 bg-transparent"
          : "border border-border/70 bg-background/60"
      )}
      isExpanded={forcedExpanded || isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <ChainOfThought.Trigger
        className={cn(
          isLive
            ? "h-auto min-h-0 cursor-default gap-2 px-0 py-0 hover:bg-transparent data-[hovered=true]:bg-transparent disabled:cursor-default disabled:opacity-100 [&_[data-slot=disclosure-indicator]]:hidden"
            : "px-3"
        )}
        isDisabled={isLive}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate", isLive && "shimmer")}>
            {getWorkSectionLabelText(t, status, durationText)}
          </span>
          {isLive && durationText ? (
            <span className="shrink-0 text-[0.625rem] text-muted-foreground tabular-nums">
              {durationText}
            </span>
          ) : null}
        </span>
      </ChainOfThought.Trigger>
      <ChainOfThought.Content className={cn(isLive ? "p-0" : "px-2 pb-2")}>
        <div className="flex flex-col gap-1">
          {entries.map((entry) => {
            if (entry.kind === "reasoning") {
              return (
                <WorkThinkingEntry
                  durationMs={thoughtDurationsMs?.[entry.index]}
                  isRunActive={isRunActive}
                  key={entry.key}
                  streaming={entry.streaming}
                  text={entry.text}
                />
              )
            }

            if (entry.kind === "text") {
              return (
                <div className={cn("py-1", !isLive && "px-2")} key={entry.key}>
                  <WorkTextEntry text={entry.text} />
                </div>
              )
            }

            if (entry.kind === "subagent-call") {
              return (
                <WorkSubagentEntry
                  entry={entry}
                  isApprovalActionDisabled={isApprovalActionDisabled}
                  key={entry.key}
                  onApprovalResponse={onApprovalResponse}
                  parentRunId={parentRunId}
                />
              )
            }

            return (
              <WorkToolGroupEntry
                entry={entry}
                isApprovalActionDisabled={isApprovalActionDisabled}
                key={entry.key}
                onApprovalResponse={onApprovalResponse}
              />
            )
          })}
        </div>
      </ChainOfThought.Content>
    </ChainOfThought>
  )
}

const AssistantArtifactCard = ({
  onOpenArtifact,
  part
}: {
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const publishedArtifact = getPublishedArtifactRef(part)
  const isFailed =
    part.state === "output-error" || part.state === "output-denied"
  const pendingTitle =
    typeof (part.input as { title?: unknown } | undefined)?.title === "string"
      ? (part.input as { title: string }).title
      : null

  if (isFailed) {
    return (
      <div className="inline-flex max-w-full items-center gap-2.5 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
        <HugeiconsIcon
          className="shrink-0 text-danger"
          icon={BrowserIcon}
          size={18}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">
            {pendingTitle ?? t("chat.artifact.badge")}
          </span>
          <span className="truncate text-danger">
            {t("chat.artifact.publishFailed")}
          </span>
        </span>
      </div>
    )
  }

  if (!publishedArtifact) {
    return (
      <div className="inline-flex max-w-full animate-pulse items-center gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-xs">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={BrowserIcon}
          size={18}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">
            {pendingTitle ?? t("chat.artifact.badge")}
          </span>
          <span className="truncate text-muted-foreground">
            {t("chat.artifact.publishing")}
          </span>
        </span>
      </div>
    )
  }

  return (
    <button
      aria-label={t("chat.artifact.open", { title: publishedArtifact.title })}
      className="group inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
      onClick={() => onOpenArtifact?.(publishedArtifact)}
      type="button"
    >
      <HugeiconsIcon
        className="shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        icon={BrowserIcon}
        size={18}
        strokeWidth={2}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium text-foreground">
          {publishedArtifact.title}
        </span>
        <span className="truncate text-muted-foreground">
          {t("chat.artifact.badge")} · {publishedArtifact.path}
        </span>
      </span>
    </button>
  )
}

const AssistantFilePartTimeline = ({ part }: { part: FileChatPart }) => (
  <div className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs">
    <span className="font-medium text-foreground">File</span>
    <span className="truncate text-muted-foreground">{part.mediaType}</span>
  </div>
)

const AssistantSourceDocumentPartTimeline = ({
  part
}: {
  part: SourceDocumentChatPart
}) => (
  <div className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs">
    <span className="truncate font-medium text-foreground">{part.title}</span>
    <span className="truncate text-muted-foreground">
      {part.filename ?? part.mediaType}
    </span>
  </div>
)

const AssistantSourceUrlPartTimeline = ({
  part
}: {
  part: SourceUrlChatPart
}) => {
  const host = getUrlHost(part.url)

  return (
    <button
      className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
      onClick={() => {
        openExternalUrl(part.url)
      }}
      type="button"
    >
      <span className="truncate font-medium text-foreground">
        {part.title ?? host}
      </span>
      <span className="truncate text-muted-foreground">{host}</span>
    </button>
  )
}

const AssistantReferencePart = ({
  part
}: {
  part: ChatUiMessage["parts"][number]
}) => {
  if (part.type === "file") {
    return <AssistantFilePartTimeline part={part as FileChatPart} />
  }

  if (part.type === "source-document") {
    return (
      <AssistantSourceDocumentPartTimeline
        part={part as SourceDocumentChatPart}
      />
    )
  }

  if (part.type === "source-url") {
    return <AssistantSourceUrlPartTimeline part={part as SourceUrlChatPart} />
  }

  return null
}

export const AssistantMessageTimeline = ({
  className,
  isStreamdownAnimating,
  isApprovalActionDisabled,
  isRunActive,
  liveWorkTimeStartedAt,
  message,
  onApprovalResponse,
  onOpenArtifact,
  sessionId,
  streamdownAnimation
}: {
  className?: string
  isStreamdownAnimating: boolean
  isApprovalActionDisabled: boolean
  isRunActive: boolean
  liveWorkTimeStartedAt?: number
  message: ChatUiMessage
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  sessionId: string
  streamdownAnimation: StreamdownAnimation
}) => {
  const { t } = useI18n()
  const metadata = parseChatMessageMetadata(message.metadata)
  const chainEntries = groupChainEntries(buildAssistantChainEntries(message))
  const bodyText = getAssistantBodyText(message)
  const runLimit = getRunLimitData(message)
  const artifactParts = message.parts.filter((part) =>
    isArtifactToolPart(part)
  ) as ChatToolPart[]
  const imagenParts = message.parts.filter((part) =>
    isImagenToolPart(part)
  ) as ChatToolPart[]
  const referenceParts = message.parts
    .map((part, index) => ({ index, part }))
    .filter(({ part }) => isReferencePart(part))

  return (
    <div className={cn("space-y-2", className)}>
      {chainEntries.length > 0 ? (
        <AssistantWorkSection
          entries={chainEntries}
          exitReason={metadata?.exitReason}
          isApprovalActionDisabled={isApprovalActionDisabled}
          isRunActive={isRunActive}
          liveWorkTimeStartedAt={liveWorkTimeStartedAt}
          onApprovalResponse={onApprovalResponse}
          parentRunId={metadata?.agentProjection?.runId}
          thoughtDurationsMs={metadata?.thoughtDurationsMs}
          workTimeMs={metadata?.workTimeMs}
        />
      ) : null}
      <AssistantMarkdownContent
        isAnimating={isStreamdownAnimating}
        streamdownAnimation={streamdownAnimation}
        text={bodyText}
      />
      {runLimit ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("chat.runLimit.notice", { maxSteps: runLimit.maxSteps })}
        </p>
      ) : null}
      {artifactParts.map((part) => (
        <AssistantArtifactCard
          key={`${message.id}-artifact-${part.toolCallId}`}
          onOpenArtifact={onOpenArtifact}
          part={part}
        />
      ))}
      {imagenParts.map((part) => (
        <ImagenMessageImage
          key={`${message.id}-imagen-${part.toolCallId}`}
          part={part}
          sessionId={sessionId}
        />
      ))}
      {referenceParts.map(({ index, part }) => (
        <AssistantReferencePart
          key={`${message.id}-reference-${index}`}
          part={part}
        />
      ))}
    </div>
  )
}
