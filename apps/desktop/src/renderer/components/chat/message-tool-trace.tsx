import { useI18n } from "@etyon/i18n/react"
import type { InspectAgentRunOutput } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { ChatTool } from "@heroui-pro/react"
import type { ToolPartState } from "@heroui-pro/react"
import { Button, Disclosure } from "@heroui/react"
import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  ComputerTerminal02Icon
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { getToolName } from "ai"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"

import { TerminalOutput } from "@/renderer/components/chat/terminal-output"
import {
  buildAgentRunGraphPreview,
  buildAgentRunGraphPreviewDisplay,
  buildAgentRunTracePreview,
  getAgentRunIdFromToolOutput
} from "@/renderer/lib/chat/agent-run-trace"
import {
  canRememberCommandApproval,
  EMPTY_TOOL_TRACE_META_ITEMS,
  formatToolTraceDetail,
  getCollapsedOutputPreview,
  getCommandExitCodeMeta,
  getCommandOutputContent,
  getCommandOutputView,
  getCommandTitleSubject,
  getShellSummary,
  getStructuredToolTraceMetaItems,
  getToolIcon,
  getToolInputCommand,
  getToolInputCwd,
  getToolInputMeta,
  getToolInputPath,
  getToolOutputSummary,
  getToolTracePreview,
  getToolTraceStateClassName,
  TOOL_TRACE_STATE_LABEL_KEY_BY_STATE
} from "@/renderer/lib/chat/message-tool-trace"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import { mapAssistantToolPartStateToChatToolState } from "@/renderer/lib/chat/tool-ui"
import { orpc } from "@/renderer/lib/rpc"
import { formatDuration } from "@/renderer/lib/utils"

interface ToolTracePanelProps {
  body?: string
  label: string
}

interface ToolTraceCardProps {
  actions?: ReactNode
  children?: ReactNode
  defaultExpanded?: boolean
  description?: string
  icon: IconSvgElement
  state: ToolPartState
  statusClassName: string
  statusLabel: string
  title: string
}

const ToolTracePanel = ({ body, label }: ToolTracePanelProps) => {
  if (!body) {
    return null
  }

  return (
    <Disclosure className="overflow-hidden rounded-md border border-border/60 bg-background/50">
      <Disclosure.Heading className="rounded-md">
        <Button
          className="h-7 w-full justify-between rounded-md px-2 text-[0.6875rem] hover:bg-muted/50 data-[hovered=true]:bg-muted/50"
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span>{label}</span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="border-t border-border/60 p-1.5">
          <pre className="max-h-48 overflow-auto rounded-sm bg-muted/50 p-2 font-mono text-[0.6875rem] leading-5 wrap-break-word whitespace-pre-wrap text-muted-foreground">
            {body}
          </pre>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

const ToolTraceMeta = ({ items }: { items: string[] }) => {
  const visibleItems = items.filter(Boolean)

  if (visibleItems.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1">
      {visibleItems.map((item) => (
        <span
          className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
          key={item}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

const AgentTracePreviewList = ({
  items,
  label
}: {
  items: {
    detail: string
    id: string
    label: string
  }[]
  label: string
}) => {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[0.6875rem] font-medium text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            className="rounded-md border border-border/50 bg-muted/35 px-2 py-1.5"
            key={item.id}
          >
            <div className="truncate text-[0.6875rem] font-medium text-foreground">
              {item.label}
            </div>
            {item.detail ? (
              <div className="mt-0.5 line-clamp-2 font-mono text-[0.625rem] wrap-break-word text-muted-foreground">
                {item.detail}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

const AgentRunGraphPreviewPanel = ({
  graph
}: {
  graph: ReturnType<typeof buildAgentRunGraphPreviewDisplay>
}) => {
  const { t } = useI18n()

  if (graph.nodes.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[0.6875rem] font-medium text-muted-foreground">
        {t("chat.toolTrace.runGraph")}
      </p>
      <div className="space-y-1">
        {graph.nodes.map((node) => (
          <div
            className="rounded-md border border-border/50 bg-muted/25 px-2 py-1.5"
            key={node.id}
            style={{ marginLeft: `${node.depth * 12}px` }}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-[0.6875rem] font-medium text-foreground">
                {node.label}
              </span>
              <span className="max-w-28 truncate font-mono text-[0.625rem] text-muted-foreground">
                {node.id}
              </span>
            </div>
            <ToolTraceMeta items={node.detailItems} />
          </div>
        ))}
      </div>
    </div>
  )
}

export const AgentChildTracePanel = ({
  defaultExpanded = false,
  runId,
  sessionId
}: {
  defaultExpanded?: boolean
  runId: string
  sessionId: string
}) => {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const traceQuery = useQuery({
    ...orpc.agents.inspectRun.queryOptions({
      input: {
        runId,
        sessionId
      }
    }),
    enabled: isExpanded
  })
  const trace = traceQuery.data as InspectAgentRunOutput | undefined
  const preview = trace ? buildAgentRunTracePreview(trace) : null
  const parentRunId = trace?.run.parentRunId ?? null
  const parentTraceQuery = useQuery({
    ...orpc.agents.inspectRun.queryOptions({
      input: {
        runId: parentRunId ?? "",
        sessionId
      }
    }),
    enabled: isExpanded && parentRunId !== null
  })
  const parentTrace = parentTraceQuery.data as InspectAgentRunOutput | undefined
  const graphPreview = trace
    ? buildAgentRunGraphPreviewDisplay(
        buildAgentRunGraphPreview(parentTrace ? [parentTrace, trace] : [trace])
      )
    : null

  return (
    <Disclosure
      className="overflow-hidden rounded-md border border-border/60 bg-background/50"
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <Disclosure.Heading className="rounded-md">
        <Button
          className="h-8 w-full justify-between rounded-md px-2 text-[0.6875rem] hover:bg-muted/50 data-[hovered=true]:bg-muted/50"
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span className="min-w-0 truncate">
            {t("chat.toolTrace.childTrace")}
          </span>
          <span className="flex min-w-0 shrink-0 items-center gap-1.5">
            <span className="max-w-32 truncate font-mono text-[0.625rem] text-muted-foreground">
              {runId}
            </span>
            <Disclosure.Indicator />
          </span>
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="space-y-2 border-t border-border/60 p-2">
          {traceQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              {t("chat.toolTrace.childTraceLoading")}
            </p>
          ) : null}
          {traceQuery.isError ? (
            <p className="text-xs text-destructive">
              {t("chat.toolTrace.childTraceError")}
            </p>
          ) : null}
          {preview ? (
            <>
              {parentTraceQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">
                  {t("chat.toolTrace.runGraphLoading")}
                </p>
              ) : null}
              {graphPreview ? (
                <AgentRunGraphPreviewPanel graph={graphPreview} />
              ) : null}
              <ToolTraceMeta
                items={[
                  `${t("chat.toolTrace.profile")}: ${preview.profileId}`,
                  `${t("chat.toolTrace.status")}: ${preview.status}`,
                  t("chat.toolTrace.childTraceArtifacts", {
                    count: preview.artifactCount
                  }),
                  t("chat.toolTrace.childTraceEvents", {
                    count: preview.eventCount
                  }),
                  t("chat.toolTrace.childTraceTools", {
                    count: preview.toolCallCount
                  })
                ]}
              />
              {preview.artifacts.length === 0 &&
              preview.events.length === 0 &&
              preview.toolCalls.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("chat.toolTrace.childTraceEmpty")}
                </p>
              ) : null}
              <AgentTracePreviewList
                items={preview.artifacts}
                label={t("chat.toolTrace.childTraceArtifacts", {
                  count: preview.artifactCount
                })}
              />
              <AgentTracePreviewList
                items={preview.toolCalls}
                label={t("chat.toolTrace.childTraceTools", {
                  count: preview.toolCallCount
                })}
              />
              <AgentTracePreviewList
                items={preview.events}
                label={t("chat.toolTrace.childTraceEvents", {
                  count: preview.eventCount
                })}
              />
              <ToolTracePanel
                body={formatToolTraceDetail(traceQuery.data)}
                label={t("chat.toolTrace.rawOutput")}
              />
            </>
          ) : null}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

const ToolTraceCard = ({
  actions,
  children,
  defaultExpanded = false,
  description,
  icon,
  state,
  statusClassName,
  statusLabel,
  title
}: ToolTraceCardProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  useEffect(() => {
    if (defaultExpanded) {
      setIsExpanded(true)
    }
  }, [defaultExpanded])

  return (
    <ChatTool
      className="overflow-hidden rounded-lg border border-border/70 bg-background/60"
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      state={state}
      toolName={title}
    >
      <ChatTool.Trigger className="h-auto min-h-8 w-full justify-between rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted/35 data-[hovered=true]:bg-muted/35 [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1">
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <HugeiconsIcon icon={icon} size={13} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-medium text-foreground">
              {title}
            </span>
            {description ? (
              <span className="block truncate font-mono text-[0.625rem] leading-4 text-muted-foreground">
                {description}
              </span>
            ) : null}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[0.625rem] font-medium",
                statusClassName
              )}
            >
              {statusLabel}
            </span>
          </span>
        </span>
      </ChatTool.Trigger>
      <ChatTool.Content>
        <div className="space-y-2 border-t border-border/60 p-2">
          {actions}
          {children}
        </div>
      </ChatTool.Content>
    </ChatTool>
  )
}

const ToolCallShellLine = ({
  command,
  cwd
}: {
  command: string
  cwd?: string
}) => (
  <div className="mb-3 wrap-break-word whitespace-pre-wrap text-zinc-100">
    <span className="text-zinc-500">$ </span>
    {cwd ? (
      <>
        <span className="text-cyan-300">cd</span>
        <span> {cwd} </span>
        <span className="text-zinc-300">&&</span>
        <span> </span>
      </>
    ) : null}
    <span>{command}</span>
  </div>
)

const CommandToolCallCard = ({
  actions,
  command,
  defaultExpanded = false,
  detail,
  isStreaming = false,
  metaItems = EMPTY_TOOL_TRACE_META_ITEMS,
  output,
  state,
  statusClassName,
  statusLabel,
  title,
  cwd
}: {
  actions?: ReactNode
  command: string
  cwd?: string
  defaultExpanded?: boolean
  detail?: ReactNode
  isStreaming?: boolean
  metaItems?: string[]
  output: string
  state: ToolPartState
  statusClassName: string
  statusLabel: string
  title: string
}) => {
  const shellSummary = getShellSummary({ command, cwd })
  const description = getCollapsedOutputPreview(output) || shellSummary

  return (
    <ToolTraceCard
      actions={actions}
      defaultExpanded={defaultExpanded}
      description={description}
      icon={ComputerTerminal02Icon}
      state={state}
      statusClassName={statusClassName}
      statusLabel={statusLabel}
      title={title}
    >
      <TerminalOutput
        className="rounded-md border-zinc-800/70 shadow-none"
        command={command}
        contentClassName="max-h-72 p-3"
        header="hidden"
        isStreaming={isStreaming}
        output={output}
        prefix={<ToolCallShellLine command={command} cwd={cwd} />}
      />
      {metaItems.length > 0 ? <ToolTraceMeta items={metaItems} /> : null}
      {detail ? <div className="space-y-1.5">{detail}</div> : null}
    </ToolTraceCard>
  )
}

const ToolApprovalActions = ({
  isApprovalActionDisabled,
  onApprovalResponse,
  part
}: {
  isApprovalActionDisabled: boolean
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()

  if (part.state !== "approval-requested") {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        isDisabled={isApprovalActionDisabled}
        onPress={() => onApprovalResponse(part, true)}
        size="sm"
        type="button"
        variant="secondary"
      >
        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} />
        {t("chat.toolTrace.approve")}
      </Button>
      {canRememberCommandApproval(part) ? (
        <Button
          isDisabled={isApprovalActionDisabled}
          onPress={() =>
            onApprovalResponse(part, true, {
              rememberCommand: true
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} />
          {t("chat.toolTrace.approveAndRemember")}
        </Button>
      ) : null}
      <Button
        isDisabled={isApprovalActionDisabled}
        onPress={() => onApprovalResponse(part, false)}
        size="sm"
        type="button"
        variant="danger-soft"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} />
        {t("chat.toolTrace.deny")}
      </Button>
    </div>
  )
}

const ToolTraceDetailPanels = ({
  input,
  output
}: {
  input: unknown
  output?: unknown
}) => {
  const { t } = useI18n()

  return (
    <>
      <ToolTracePanel
        body={formatToolTraceDetail(input)}
        label={t("chat.toolTrace.input")}
      />
      <ToolTracePanel
        body={output === undefined ? "" : formatToolTraceDetail(output)}
        label={t("chat.toolTrace.rawOutput")}
      />
    </>
  )
}

export const StructuredToolTraceCard = ({
  chatSessionId,
  isApprovalActionDisabled,
  onApprovalResponse,
  part,
  repeatCount = 1
}: {
  chatSessionId?: string
  isApprovalActionDisabled: boolean
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  part: ChatToolPart
  repeatCount?: number
}) => {
  const { t } = useI18n()
  const toolName = getToolName(part)
  const output =
    part.state === "output-available" ? getToolOutputSummary(part.output) : ""
  const preview = output || getToolTracePreview(part)
  const inputCommand = getToolInputCommand(part.input)
  const inputCwd = getToolInputCwd(part.input)
  const inputPath = getToolInputPath(part.input)
  const inputLabel = inputCommand || inputPath
  const inputMeta = getToolInputMeta(part.input)
  const commandOutput =
    part.state === "output-available" ? getCommandOutputView(part.output) : null
  const commandExitCodeMeta = getCommandExitCodeMeta({
    commandOutput,
    label: t("chat.toolTrace.exitCode")
  })
  const commandDuration = formatDuration(commandOutput?.durationMs)
  const commandOutputContent = getCommandOutputContent(commandOutput)
  const isCommandStreaming =
    part.state === "input-streaming" || part.state === "input-available"
  const statusLabel = t(
    TOOL_TRACE_STATE_LABEL_KEY_BY_STATE[
      part.state as keyof typeof TOOL_TRACE_STATE_LABEL_KEY_BY_STATE
    ]
  )
  const statusClassName = getToolTraceStateClassName(part.state)
  const heroToolState = mapAssistantToolPartStateToChatToolState(part.state)
  const metaItems = getStructuredToolTraceMetaItems({
    commandDuration,
    commandExitCodeMeta,
    commandOutput,
    durationLabel: t("chat.toolTrace.duration"),
    inputMeta,
    statusLabel: t("chat.toolTrace.status"),
    truncatedLabel: t("chat.toolTrace.truncated")
  })
  const repeatedMetaItem =
    repeatCount > 1 ? t("chat.toolTrace.repeated", { count: repeatCount }) : ""
  const approvalActions =
    part.state === "approval-requested" ? (
      <ToolApprovalActions
        isApprovalActionDisabled={isApprovalActionDisabled}
        onApprovalResponse={onApprovalResponse}
        part={part}
      />
    ) : null
  const outputDetail =
    part.state === "output-available" ? part.output : undefined
  const childRunId =
    part.state === "output-available"
      ? getAgentRunIdFromToolOutput(part.output)
      : null
  const detailPanels = (
    <>
      {childRunId && chatSessionId ? (
        <AgentChildTracePanel runId={childRunId} sessionId={chatSessionId} />
      ) : null}
      <ToolTraceDetailPanels input={part.input} output={outputDetail} />
    </>
  )

  if (inputCommand) {
    const commandOutputText = commandOutputContent || preview
    const title = t("chat.toolTrace.runCommand", {
      command: getCommandTitleSubject(inputCommand)
    })

    return (
      <CommandToolCallCard
        actions={approvalActions}
        command={inputCommand}
        cwd={inputCwd}
        defaultExpanded={part.state === "approval-requested"}
        detail={detailPanels}
        isStreaming={isCommandStreaming && !commandOutputText}
        metaItems={[...metaItems, repeatedMetaItem]}
        output={commandOutputText}
        state={heroToolState}
        statusClassName={statusClassName}
        statusLabel={statusLabel}
        title={title}
      />
    )
  }

  return (
    <ToolTraceCard
      actions={approvalActions}
      defaultExpanded={part.state === "approval-requested"}
      description={inputLabel || preview}
      icon={getToolIcon(toolName)}
      state={heroToolState}
      statusClassName={statusClassName}
      statusLabel={statusLabel}
      title={toolName}
    >
      {preview ? (
        <p className="line-clamp-3 text-xs wrap-break-word text-muted-foreground">
          {preview}
        </p>
      ) : null}
      <ToolTraceMeta items={[...metaItems, repeatedMetaItem]} />
      <div className="space-y-1.5">{detailPanels}</div>
    </ToolTraceCard>
  )
}
