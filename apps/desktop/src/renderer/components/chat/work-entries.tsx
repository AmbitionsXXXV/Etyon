import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Disclosure } from "@heroui/react"
import {
  BrainIcon,
  CheckListIcon,
  CheckmarkCircle01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { getToolName } from "ai"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Streamdown } from "streamdown"

import { StructuredToolTraceCard } from "@/renderer/components/chat/message-tool-trace"
import {
  getTodoPartTodos,
  isToolGroupRunning
} from "@/renderer/lib/chat/assistant-message-timeline"
import type {
  ChatToolPart,
  GroupedChainEntry,
  ToolGroupLabel
} from "@/renderer/lib/chat/assistant-message-timeline"
import { getToolIcon } from "@/renderer/lib/chat/message-tool-trace"
import { useTodos } from "@/renderer/lib/chat/todo-store"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import { formatElapsedDuration } from "@/renderer/lib/utils"
import { countTodosByStatus } from "@/shared/chat/stream-data"
import type { ChatTodoItem, ChatTodoStatus } from "@/shared/chat/stream-data"

export type Translate = ReturnType<typeof useI18n>["t"]

// Intermediate narration lives inside the collapsed timeline: smaller, muted,
// and a compact subset of the body markdown styling.
export const CHAIN_TEXT_MARKDOWN_CLASS_NAME = cn(
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

export const WORK_DISCLOSURE_TRIGGER_CLASS_NAME =
  "h-auto min-h-8 w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted/40 data-[hovered=true]:bg-muted/40"

export const getToolGroupLabelText = (
  t: Translate,
  label: ToolGroupLabel
): string => {
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

// Ticks a live elapsed time while the run is active, then freezes the last
// value until the persisted `workTimeMs` arrives (or replaces it outright).
export const useWorkElapsedMs = ({
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

export const WorkTextEntry = ({ text }: { text: string }) => (
  <Streamdown
    animated={false}
    className={CHAIN_TEXT_MARKDOWN_CLASS_NAME}
    isAnimating={false}
    skipHtml
  >
    {text}
  </Streamdown>
)

export const WorkThinkingEntry = ({
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

export const TodoStatusIndicator = ({ status }: { status: ChatTodoStatus }) => {
  let mark: ReactNode

  if (status === "completed") {
    mark = (
      <HugeiconsIcon
        className="text-success"
        icon={CheckmarkCircle01Icon}
        size={13}
      />
    )
  } else if (status === "in_progress") {
    mark = <span className="size-2 animate-pulse rounded-full bg-foreground" />
  } else {
    mark = (
      <span className="size-2.5 rounded-full border border-muted-foreground/50" />
    )
  }

  return (
    <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
      {mark}
    </span>
  )
}

export const TodoItemRow = ({ todo }: { todo: ChatTodoItem }) => {
  const isActive = todo.status === "in_progress"
  const label = isActive && todo.activeForm ? todo.activeForm : todo.content

  return (
    <li className="flex items-start gap-2">
      <TodoStatusIndicator status={todo.status} />
      <span
        className={cn(
          "min-w-0 flex-1 text-xs wrap-break-word",
          isActive ? "text-foreground" : "text-muted-foreground",
          isActive && "shimmer"
        )}
      >
        {label}
      </span>
    </li>
  )
}

// Live task checklist maintained by the `todo_write` tool. Reads the run's live
// snapshot from the transient store; once the turn settles and that store is
// cleared, it falls back to the persisted tool-call input so a re-expanded fold
// still shows the final list. Collapsed to a "completed/total" header line.
export const WorkTodoEntry = ({
  isRunActive = false,
  parentRunId,
  part
}: {
  isRunActive?: boolean
  parentRunId?: string
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const liveTodos = useTodos(parentRunId)
  const todos = liveTodos ?? getTodoPartTodos(part)
  const total = todos.length
  const { completed } = countTodosByStatus(todos)
  const hasInProgress = todos.some((todo) => todo.status === "in_progress")
  const [isExpanded, setIsExpanded] = useState(hasInProgress)

  useEffect(() => {
    if (hasInProgress) {
      setIsExpanded(true)
    }
  }, [hasInProgress])

  // While this run is live its checklist is anchored to the composer's plan
  // queue instead, so suppress the timeline copy to avoid a double render. Gated
  // on live todos actually existing rather than `isRunActive` alone: the next
  // turn's submitted phase keeps `isRunActive` true for the prior settled
  // message, whose run has no live todos in the store, so its finished list
  // stays visible.
  if (isRunActive && liveTodos !== undefined && liveTodos.length > 0) {
    return null
  }

  if (total === 0) {
    return null
  }

  return (
    <Disclosure
      className="overflow-hidden rounded-lg"
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <Disclosure.Heading className="rounded-lg">
        <Button
          aria-label={t("chat.workSection.todoProgressLabel", {
            completed,
            total
          })}
          className={WORK_DISCLOSURE_TRIGGER_CLASS_NAME}
          slot="trigger"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon
              className="shrink-0 text-muted-foreground"
              icon={CheckListIcon}
              size={14}
            />
            <span
              className={cn("truncate text-xs", hasInProgress && "shimmer")}
            >
              {t("chat.workSection.todos")}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-[0.625rem] text-muted-foreground tabular-nums">
              {completed}/{total}
            </span>
            <Disclosure.Indicator />
          </span>
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-2 pt-1 pb-1.5">
          <ul className="flex flex-col gap-1">
            {todos.map((todo, index) => (
              <TodoItemRow key={`${index}-${todo.content}`} todo={todo} />
            ))}
          </ul>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

// A read-only child trace carries no approval to act on, so the handler is
// optional and defaults to a no-op.
const NOOP = (): void => {
  // no-op
}

export const WorkToolGroupEntry = ({
  entry,
  isApprovalActionDisabled,
  onApprovalResponse = NOOP
}: {
  entry: Extract<GroupedChainEntry, { kind: "tool-group" }>
  isApprovalActionDisabled: boolean
  onApprovalResponse?: (
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
