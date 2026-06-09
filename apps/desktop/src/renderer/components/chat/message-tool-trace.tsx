import { useI18n } from "@etyon/i18n/react"
import type { InspectAgentRunOutput } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { ChatTool } from "@heroui-pro/react"
import type { ToolPartState } from "@heroui-pro/react"
import { Button, Disclosure } from "@heroui/react"
import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  ComputerTerminal02Icon,
  FileCodeIcon,
  SearchCodeIcon,
  ToolsIcon,
  WorkflowSquare02Icon
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import type { DynamicToolUIPart, ToolUIPart } from "ai"
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
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import { mapAssistantToolPartStateToChatToolState } from "@/renderer/lib/chat/tool-ui"
import { orpc } from "@/renderer/lib/rpc"

type ChatToolPart = DynamicToolUIPart | ToolUIPart
type ChatToolState = ChatToolPart["state"]

interface CommandOutputView {
  durationMs?: number
  exitCode?: number | null
  status?: string
  stderrPreview?: string
  stdoutPreview?: string
  truncated?: boolean
}

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

export interface CompactedStructuredToolTracePart {
  part: ChatToolPart
  repeatCount: number
}

const TOOL_TRACE_PREVIEW_MAX_LENGTH = 220
const TOOL_TRACE_DETAIL_MAX_LENGTH = 2_400
const TOOL_TRACE_HEADER_PREVIEW_MAX_LENGTH = 160
const COMMAND_TITLE_TOKEN_LIMIT = 4
const SHELL_COMMAND_SEPARATOR_PATTERN = /\s*(?:&&|\|\||[;|])\s*/u
const TEST_FILE_PATTERN =
  /(?:^|\s)([^\s"'`]+)\.test\.[cm]?[tj]sx?(?=$|\s|["'])/u
const TOOL_TRACE_STATE_LABEL_KEY_BY_STATE = {
  "approval-requested": "chat.toolTrace.state.approvalRequested",
  "approval-responded": "chat.toolTrace.state.approvalResponded",
  "input-available": "chat.toolTrace.state.inputAvailable",
  "input-streaming": "chat.toolTrace.state.inputStreaming",
  "output-available": "chat.toolTrace.state.outputAvailable",
  "output-denied": "chat.toolTrace.state.outputDenied",
  "output-error": "chat.toolTrace.state.outputError"
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isTerminalStructuredToolState = (state: ChatToolState): boolean =>
  state === "output-available" ||
  state === "output-denied" ||
  state === "output-error"

const canonicalizeStructuredValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeStructuredValue(item))
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, childValue]) => [
        key,
        canonicalizeStructuredValue(childValue)
      ])
  )
}

const getStructuredToolPartCompactionKey = (part: ChatToolPart): string =>
  JSON.stringify({
    input: canonicalizeStructuredValue(part.input),
    state: part.state,
    toolName: getToolName(part)
  })

export const compactStructuredToolTraceParts = (
  parts: readonly ChatToolPart[]
): CompactedStructuredToolTracePart[] => {
  const compactedParts: CompactedStructuredToolTracePart[] = []

  for (const part of parts) {
    const lastPart = compactedParts.at(-1)

    if (
      lastPart &&
      isTerminalStructuredToolState(part.state) &&
      isTerminalStructuredToolState(lastPart.part.state) &&
      getStructuredToolPartCompactionKey(part) ===
        getStructuredToolPartCompactionKey(lastPart.part)
    ) {
      lastPart.repeatCount += 1
      continue
    }

    compactedParts.push({
      part,
      repeatCount: 1
    })
  }

  return compactedParts
}

const getString = (
  value: Record<string, unknown>,
  key: string
): string | undefined =>
  typeof value[key] === "string" ? (value[key] as string) : undefined

const getNumber = (
  value: Record<string, unknown>,
  key: string
): number | undefined =>
  typeof value[key] === "number" ? (value[key] as number) : undefined

const getBoolean = (
  value: Record<string, unknown>,
  key: string
): boolean | undefined =>
  typeof value[key] === "boolean" ? (value[key] as boolean) : undefined

const formatToolTracePreview = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }

  if (typeof value === "string") {
    return value.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  try {
    return JSON.stringify(value).slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  } catch {
    return String(value).slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }
}

const formatToolTraceDetail = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }

  if (typeof value === "string") {
    return value.slice(0, TOOL_TRACE_DETAIL_MAX_LENGTH)
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, TOOL_TRACE_DETAIL_MAX_LENGTH)
  } catch {
    return String(value).slice(0, TOOL_TRACE_DETAIL_MAX_LENGTH)
  }
}

const formatDuration = (durationMs: number | undefined): string => {
  if (durationMs === undefined) {
    return ""
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`
  }

  return `${(durationMs / 1000).toFixed(1)} s`
}

const getPathBaseName = (value: string): string => {
  const normalizedPath = value.replaceAll("\\", "/")
  const pathParts = normalizedPath.split("/")

  return pathParts.at(-1) ?? value
}

const getCommandTitleSubject = (command: string): string => {
  const testFileMatch = command.match(TEST_FILE_PATTERN)
  const testFilePath = testFileMatch?.[1]

  if (testFilePath) {
    return `${getPathBaseName(testFilePath)} tests`
  }

  const commandHead =
    command.split(SHELL_COMMAND_SEPARATOR_PATTERN)[0]?.trim() ?? command.trim()
  const tokens = commandHead.split(/\s+/u).filter(Boolean)
  const visibleTokens = tokens.slice(0, COMMAND_TITLE_TOKEN_LIMIT)
  const suffix = tokens.length > visibleTokens.length ? " ..." : ""

  return `${visibleTokens.join(" ")}${suffix}`.trim() || command.trim()
}

const getShellSummary = ({
  command,
  cwd
}: {
  command: string
  cwd?: string
}): string => {
  const commandParts = command
    .split(SHELL_COMMAND_SEPARATOR_PATTERN)
    .filter((part) => part.trim().length > 0)
  const commandCount = commandParts.length + (cwd ? 1 : 0)

  if (commandCount === 0) {
    return ""
  }

  const firstCommand = cwd
    ? "cd"
    : (commandParts[0]?.split(/\s+/u).find(Boolean) ?? "")

  if (commandCount === 1) {
    return firstCommand
  }

  return `${firstCommand}, ${commandCount - 1}+`
}

const getCollapsedOutputPreview = (output: string): string =>
  output.trim().slice(0, TOOL_TRACE_HEADER_PREVIEW_MAX_LENGTH)

const getToolTraceStateClassName = (state: ChatToolState): string => {
  switch (state) {
    case "output-available": {
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
    }
    case "output-denied":
    case "output-error": {
      return "bg-destructive/10 text-destructive"
    }
    case "approval-requested": {
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
    }
    default: {
      return "bg-muted text-muted-foreground"
    }
  }
}

const getToolIcon = (toolName: string): IconSvgElement => {
  if (toolName === "bash" || toolName === "shell") {
    return ComputerTerminal02Icon
  }

  if (
    toolName === "bash" ||
    toolName === "runCheck" ||
    toolName === "rtkCommand"
  ) {
    return ComputerTerminal02Icon
  }

  if (
    toolName === "read" ||
    toolName === "fileInfo" ||
    toolName === "gitDiff" ||
    toolName === "readFile"
  ) {
    return FileCodeIcon
  }

  if (
    toolName === "find" ||
    toolName === "grep" ||
    toolName === "ls" ||
    toolName === "findFiles" ||
    toolName === "listDirectory" ||
    toolName === "listProjectTree" ||
    toolName === "searchFiles"
  ) {
    return SearchCodeIcon
  }

  if (toolName.startsWith("agent")) {
    return WorkflowSquare02Icon
  }

  return ToolsIcon
}

const getToolTracePreview = (part: ChatToolPart): string => {
  switch (part.state) {
    case "approval-responded":
    case "output-denied": {
      return part.approval.reason ?? ""
    }
    case "output-available": {
      return formatToolTracePreview(part.output)
    }
    case "output-error": {
      return part.errorText
    }
    default: {
      return ""
    }
  }
}

const getCommandOutputView = (output: unknown): CommandOutputView | null => {
  if (!isRecord(output)) {
    return null
  }

  const stdoutPreview = getString(output, "stdoutPreview")
  const stderrPreview = getString(output, "stderrPreview")
  const status = getString(output, "status")
  const exitCode =
    typeof output.exitCode === "number" || output.exitCode === null
      ? output.exitCode
      : undefined

  if (!(stdoutPreview || stderrPreview || status || exitCode !== undefined)) {
    return null
  }

  return {
    durationMs: getNumber(output, "durationMs"),
    exitCode,
    status,
    stderrPreview,
    stdoutPreview,
    truncated: getBoolean(output, "truncated")
  }
}

const getCommandOutputContent = (
  commandOutput: CommandOutputView | null
): string =>
  [commandOutput?.stdoutPreview, commandOutput?.stderrPreview]
    .filter(Boolean)
    .join("\n")

const getCommandExitCodeMeta = ({
  commandOutput,
  label
}: {
  commandOutput: CommandOutputView | null
  label: string
}): string => {
  if (commandOutput?.exitCode === undefined) {
    return ""
  }

  return `${label}: ${commandOutput.exitCode ?? "-"}`
}

const getStructuredToolTraceMetaItems = ({
  commandDuration,
  commandExitCodeMeta,
  commandOutput,
  durationLabel,
  inputMeta,
  statusLabel,
  truncatedLabel
}: {
  commandDuration: string
  commandExitCodeMeta: string
  commandOutput: CommandOutputView | null
  durationLabel: string
  inputMeta: string
  statusLabel: string
  truncatedLabel: string
}): string[] => [
  inputMeta,
  commandOutput?.status ? `${statusLabel}: ${commandOutput.status}` : "",
  commandExitCodeMeta,
  commandDuration ? `${durationLabel}: ${commandDuration}` : "",
  commandOutput?.truncated ? truncatedLabel : ""
]

const getToolInputCommand = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "command") ?? ""
}

const getToolInputCwd = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "cwd") ?? ""
}

const getToolInputPath = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "path") ?? ""
}

const getToolInputMeta = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  const cwd = getString(input, "cwd")
  const reason = getString(input, "reason")

  return [cwd ? `cwd: ${cwd}` : "", reason].filter(Boolean).join(" · ")
}

const getToolOutputSummary = (output: unknown): string => {
  if (!isRecord(output)) {
    return formatToolTracePreview(output)
  }

  const commandOutput = getCommandOutputView(output)

  if (commandOutput) {
    return (
      commandOutput.stderrPreview ||
      commandOutput.stdoutPreview ||
      commandOutput.status ||
      ""
    ).slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  const summary = getString(output, "summary")

  if (summary) {
    return summary.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  const content = getString(output, "content")

  if (content) {
    return content.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  const patch = getString(output, "patch")

  if (patch) {
    return patch.slice(0, TOOL_TRACE_PREVIEW_MAX_LENGTH)
  }

  return formatToolTracePreview(output)
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

const EMPTY_TOOL_TRACE_META_ITEMS: string[] = []

const REMEMBERABLE_COMMAND_APPROVAL_TOOLS = new Set([
  "bash",
  "rtkCommand",
  "runCheck"
])

const canRememberCommandApproval = (part: ChatToolPart): boolean =>
  part.state === "approval-requested" &&
  REMEMBERABLE_COMMAND_APPROVAL_TOOLS.has(getToolName(part)) &&
  getToolInputCommand(part.input).trim().length > 0

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
