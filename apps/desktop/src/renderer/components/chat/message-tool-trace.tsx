import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Card, Disclosure } from "@heroui/react"
import {
  BrainIcon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Clock03Icon,
  ComputerTerminal02Icon,
  FileCodeIcon,
  SearchCodeIcon,
  ToolsIcon,
  WorkflowSquare02Icon
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DynamicToolUIPart, ToolUIPart } from "ai"
import { getToolName } from "ai"

import { TerminalOutput } from "@/renderer/components/chat/terminal-output"
import type {
  AssistantCommandTextSegment,
  AssistantFunctionCallTextSegment
} from "@/renderer/lib/chat/tool-ui"

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

interface MessageToolTraceProps {
  commandSegments: AssistantCommandTextSegment[]
  functionCallSegments: AssistantFunctionCallTextSegment[]
  isApprovalActionDisabled: boolean
  onApprovalResponse: (part: ChatToolPart, approved: boolean) => void
  parts: ChatToolPart[]
}

const TOOL_TRACE_PREVIEW_MAX_LENGTH = 220
const TOOL_TRACE_DETAIL_MAX_LENGTH = 2_400
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

  if (toolName === "runCheck" || toolName === "rtkCommand") {
    return ComputerTerminal02Icon
  }

  if (toolName === "readFile" || toolName === "gitDiff") {
    return FileCodeIcon
  }

  if (toolName === "searchFiles" || toolName === "listProjectTree") {
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

const getToolInputCommand = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  return getString(input, "command") ?? getString(input, "path") ?? ""
}

const getToolInputMeta = (input: unknown): string => {
  if (!isRecord(input)) {
    return ""
  }

  const cwd = getString(input, "cwd")
  const reason = getString(input, "reason")

  return [cwd ? `cwd: ${cwd}` : "", reason].filter(Boolean).join(" · ")
}

const getFunctionCallParameterValue = (
  segment: AssistantFunctionCallTextSegment,
  name: string
): string =>
  segment.parameters.find((parameter) => parameter.name === name)?.value ?? ""

const formatFunctionCallParameters = (
  segment: AssistantFunctionCallTextSegment
): string =>
  segment.parameters
    .map((parameter) =>
      parameter.value.includes("\n")
        ? `${parameter.name}:\n${parameter.value}`
        : `${parameter.name}: ${parameter.value}`
    )
    .join("\n")

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
    <Disclosure className="overflow-hidden rounded-lg border border-border/60 bg-background/50">
      <Disclosure.Heading className="rounded-lg">
        <Button
          className="h-8 w-full justify-between rounded-lg px-2 text-xs hover:bg-muted/50 data-[hovered=true]:bg-muted/50"
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span>{label}</span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="border-t border-border/60 p-2">
          <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[0.6875rem] leading-5 wrap-break-word whitespace-pre-wrap text-muted-foreground">
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
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visibleItems.map((item) => (
        <span
          className="rounded-md bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
          key={item}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

export const FunctionCallTextTraceCard = ({
  segment
}: {
  segment: AssistantFunctionCallTextSegment
}) => {
  const { t } = useI18n()
  const inputCommand =
    getFunctionCallParameterValue(segment, "command") ||
    getFunctionCallParameterValue(segment, "path")
  const cwd = getFunctionCallParameterValue(segment, "cwd")

  return (
    <Card
      className="rounded-xl border border-border/70 bg-background/70 p-0 shadow-none"
      variant="transparent"
    >
      <Card.Header className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={getToolIcon(segment.name)} size={15} />
          </span>
          <div className="min-w-0">
            <Card.Title className="truncate text-xs">
              {t("chat.toolTrace.functionCall")}
            </Card.Title>
            <Card.Description className="mt-1 truncate font-mono text-[0.6875rem] font-medium text-foreground!">
              {inputCommand || segment.name}
            </Card.Description>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[0.625rem] font-medium",
            getToolTraceStateClassName("input-available")
          )}
        >
          {t("chat.toolTrace.state.inputAvailable")}
        </span>
      </Card.Header>
      <Card.Content className="space-y-2 px-3 pb-3">
        <ToolTraceMeta
          items={[
            `${t("chat.toolTrace.input")}: ${segment.name}`,
            cwd ? `${t("chat.toolTrace.cwd")}: ${cwd}` : ""
          ]}
        />
        {inputCommand ? (
          <p className="rounded-md border border-border/60 bg-muted/45 p-2 font-mono text-[0.6875rem] leading-5 wrap-break-word whitespace-pre-wrap text-foreground">
            {inputCommand}
          </p>
        ) : null}
        <ToolTracePanel
          body={formatFunctionCallParameters(segment)}
          label={t("chat.toolTrace.input")}
        />
      </Card.Content>
    </Card>
  )
}

export const CommandTextTraceCard = ({
  segment
}: {
  segment: AssistantCommandTextSegment
}) => {
  const { t } = useI18n()
  const isSuccess = segment.exitCode === 0

  return (
    <Card
      className="rounded-xl border border-border/70 bg-background/70 p-0 shadow-none"
      variant="transparent"
    >
      <Card.Header className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
              isSuccess
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "bg-destructive/10 text-destructive"
            )}
          >
            <HugeiconsIcon icon={ComputerTerminal02Icon} size={15} />
          </span>
          <div className="min-w-0">
            <Card.Title className="truncate text-xs">
              {t("chat.toolTrace.executedCommand")}
            </Card.Title>
            <Card.Description className="mt-1 truncate font-mono text-[0.6875rem]">
              {segment.command}
            </Card.Description>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[0.625rem] font-medium",
            isSuccess
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {t(
            isSuccess
              ? "chat.toolTrace.state.outputAvailable"
              : "chat.toolTrace.state.outputError"
          )}
        </span>
      </Card.Header>
      <Card.Content className="space-y-2 px-3 pb-3">
        <ToolTraceMeta
          items={[
            `${t("chat.toolTrace.cwd")}: ${segment.cwd}`,
            `${t("chat.toolTrace.shell")}: ${segment.shell}`,
            `${t("chat.toolTrace.exitCode")}: ${segment.exitCode}`,
            segment.repeatCount > 1
              ? t("chat.toolTrace.repeated", { count: segment.repeatCount })
              : ""
          ]}
        />
        <TerminalOutput
          command={segment.command}
          output={segment.output}
          title={t("chat.terminal.title")}
        />
      </Card.Content>
    </Card>
  )
}

const ToolTraceCommandOutputSection = ({
  commandOutput,
  commandOutputContent,
  inputCommand,
  isCommandStreaming,
  toolName
}: {
  commandOutput: CommandOutputView | null
  commandOutputContent: string
  inputCommand: string
  isCommandStreaming: boolean
  toolName: string
}) => {
  if (!(commandOutput || inputCommand)) {
    return null
  }

  return (
    <TerminalOutput
      command={inputCommand}
      isStreaming={isCommandStreaming && !commandOutputContent}
      output={commandOutputContent}
      title={toolName}
    />
  )
}

export const StructuredToolTraceCard = ({
  isApprovalActionDisabled,
  onApprovalResponse,
  part
}: {
  isApprovalActionDisabled: boolean
  onApprovalResponse: (part: ChatToolPart, approved: boolean) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const toolName = getToolName(part)
  const output =
    part.state === "output-available" ? getToolOutputSummary(part.output) : ""
  const preview = output || getToolTracePreview(part)
  const inputCommand = getToolInputCommand(part.input)
  const inputMeta = getToolInputMeta(part.input)
  const commandOutput =
    part.state === "output-available" ? getCommandOutputView(part.output) : null
  const commandExitCodeMeta =
    commandOutput?.exitCode === undefined
      ? ""
      : `${t("chat.toolTrace.exitCode")}: ${commandOutput.exitCode ?? "-"}`
  const commandDuration = formatDuration(commandOutput?.durationMs)
  const commandOutputContent = [
    commandOutput?.stdoutPreview,
    commandOutput?.stderrPreview
  ]
    .filter(Boolean)
    .join("\n")
  const isCommandStreaming =
    part.state === "input-streaming" || part.state === "input-available"

  return (
    <Card
      className="rounded-xl border border-border/70 bg-background/70 p-0 shadow-none"
      variant="transparent"
    >
      <Card.Header className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={getToolIcon(toolName)} size={15} />
          </span>
          <div className="min-w-0">
            <Card.Title className="truncate text-xs">{toolName}</Card.Title>
            {inputCommand ? (
              <Card.Description className="mt-1 truncate font-mono text-[0.6875rem]">
                {inputCommand}
              </Card.Description>
            ) : null}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[0.625rem] font-medium",
            getToolTraceStateClassName(part.state)
          )}
        >
          {t(TOOL_TRACE_STATE_LABEL_KEY_BY_STATE[part.state])}
        </span>
      </Card.Header>
      <Card.Content className="space-y-2 px-3 pb-3">
        {preview ? (
          <p className="line-clamp-3 text-xs wrap-break-word text-muted-foreground">
            {preview}
          </p>
        ) : null}
        <ToolTraceMeta
          items={[
            inputMeta,
            commandOutput?.status
              ? `${t("chat.toolTrace.status")}: ${commandOutput.status}`
              : "",
            commandExitCodeMeta,
            commandDuration
              ? `${t("chat.toolTrace.duration")}: ${commandDuration}`
              : "",
            commandOutput?.truncated ? t("chat.toolTrace.truncated") : ""
          ]}
        />
        {part.state === "approval-requested" ? (
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
        ) : null}
        <ToolTraceCommandOutputSection
          commandOutput={commandOutput}
          commandOutputContent={commandOutputContent}
          inputCommand={inputCommand}
          isCommandStreaming={isCommandStreaming}
          toolName={toolName}
        />
        <div className="space-y-1.5">
          <ToolTracePanel
            body={formatToolTraceDetail(part.input)}
            label={t("chat.toolTrace.input")}
          />
          <ToolTracePanel
            body={
              part.state === "output-available"
                ? formatToolTraceDetail(part.output)
                : ""
            }
            label={t("chat.toolTrace.rawOutput")}
          />
        </div>
      </Card.Content>
    </Card>
  )
}

export const AssistantThinkingTrace = ({ text }: { text: string }) => {
  const { t } = useI18n()

  return (
    <Disclosure className="mt-2 rounded-xl border border-border/70 bg-background/70">
      <Disclosure.Heading>
        <Button
          className="h-9 w-full justify-between rounded-xl px-3 text-xs hover:bg-transparent"
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon icon={BrainIcon} size={14} />
            <span className="truncate">{t("chat.toolTrace.thinking")}</span>
          </span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="border-t border-border/60 p-3">
          <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {text}
          </p>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

export const MessageToolTrace = ({
  commandSegments,
  functionCallSegments,
  isApprovalActionDisabled,
  onApprovalResponse,
  parts
}: MessageToolTraceProps) => {
  const { t } = useI18n()

  if (
    parts.length === 0 &&
    commandSegments.length === 0 &&
    functionCallSegments.length === 0
  ) {
    return null
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
        <HugeiconsIcon icon={Clock03Icon} size={13} />
        <span>{t("chat.toolTrace.title")}</span>
      </div>
      {commandSegments.map((segment) => (
        <CommandTextTraceCard
          key={`${segment.cwd}-${segment.shell}-${segment.command}-${segment.exitCode}`}
          segment={segment}
        />
      ))}
      {functionCallSegments.map((segment, index) => (
        <FunctionCallTextTraceCard
          key={`${segment.name}-${index}-${getFunctionCallParameterValue(
            segment,
            "command"
          )}`}
          segment={segment}
        />
      ))}
      {parts.map((part) => (
        <StructuredToolTraceCard
          isApprovalActionDisabled={isApprovalActionDisabled}
          key={part.toolCallId}
          onApprovalResponse={onApprovalResponse}
          part={part}
        />
      ))}
    </div>
  )
}
