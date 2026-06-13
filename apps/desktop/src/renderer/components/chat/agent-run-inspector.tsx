import { useI18n } from "@etyon/i18n/react"
import type {
  AgentRunStatus,
  AgentRunTraceEvent,
  AgentRunTraceToolCall,
  InspectAgentRunOutput
} from "@etyon/rpc"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@etyon/ui/components/dialog"
import { Button } from "@heroui/react"
import { WorkflowSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { getToolIcon } from "@/renderer/lib/chat/message-tool-trace"
import { orpc } from "@/renderer/lib/rpc"
import { summarizeToolOutput } from "@/shared/agents/tool-output-summary"
import { getAgentProjectionRunId } from "@/shared/chat/message-metadata"

type Translate = ReturnType<typeof useI18n>["t"]

const STATUS_CLASS_NAME: Record<AgentRunStatus, string> = {
  failed: "bg-destructive/10 text-destructive",
  running: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  suspended: "bg-amber-500/10 text-amber-700 dark:text-amber-300"
}

const formatOutput = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const RunEventRow = ({ event }: { event: AgentRunTraceEvent }) => (
  <li className="flex items-baseline gap-2 text-xs">
    <span className="w-6 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
      {event.sequence}
    </span>
    <span className="font-medium">{event.type}</span>
  </li>
)

const ToolCallRow = ({ toolCall }: { toolCall: AgentRunTraceToolCall }) => {
  const summary = summarizeToolOutput(toolCall.output)
  const fullOutput = formatOutput(toolCall.output)

  return (
    <div className="rounded-md border border-border/70 bg-background p-2">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={getToolIcon(toolCall.toolName)} size={13} />
        <span className="text-xs font-medium">{toolCall.toolName}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {toolCall.state}
        </span>
      </div>
      {fullOutput.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            {summary.summary}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[11px] whitespace-pre-wrap">
            {fullOutput}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

const RunInspectorBody = ({
  data,
  isError,
  isPending,
  t
}: {
  data: InspectAgentRunOutput | undefined
  isError: boolean
  isPending: boolean
  t: Translate
}) => {
  if (isPending) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>
  }

  if (isError || !data) {
    return <p className="text-sm text-destructive">{t("error")}</p>
  }

  const { events, run, toolCalls } = data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{run.profileId}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS_NAME[run.status]}`}
        >
          {run.status}
        </span>
        {run.modelId ? (
          <span className="text-muted-foreground">{run.modelId}</span>
        ) : null}
        {run.parentRunId ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t("childRun")}
          </span>
        ) : null}
      </div>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold text-muted-foreground">
          {t("toolCalls")}
        </h3>
        {toolCalls.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {toolCalls.map((toolCall) => (
              <ToolCallRow key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold text-muted-foreground">
          {t("events")}
        </h3>
        <ul className="space-y-1">
          {events.map((event) => (
            <RunEventRow event={event} key={event.id} />
          ))}
        </ul>
      </section>
    </div>
  )
}

const AgentRunInspectorControl = ({ runId }: { runId: string }) => {
  const { t } = useI18n({ keyPrefix: "chat.runInspector" })
  const [open, setOpen] = useState(false)
  const query = useQuery({
    ...orpc.agents.inspectRun.queryOptions({ input: { runId } }),
    enabled: open
  })

  return (
    <>
      <div className="invisible mt-1.5 flex h-8 items-center opacity-0 transition-opacity group-focus-within/message:visible group-focus-within/message:opacity-100 group-hover/message:visible group-hover/message:opacity-100">
        <Button
          className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
          onPress={() => setOpen(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            icon={WorkflowSquare02Icon}
            size={14}
            strokeWidth={2}
          />
          {t("trigger")}
        </Button>
      </div>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <RunInspectorBody
            data={query.data}
            isError={query.isError}
            isPending={query.isPending}
            t={t}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

export const AgentRunInspector = ({
  message
}: {
  message: { metadata?: unknown }
}) => {
  const runId = getAgentProjectionRunId(message)

  if (!runId) {
    return null
  }

  return <AgentRunInspectorControl runId={runId} />
}
