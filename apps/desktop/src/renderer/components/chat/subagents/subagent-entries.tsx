import { useI18n } from "@etyon/i18n/react"
import { useQuery } from "@tanstack/react-query"
import { memo, useMemo } from "react"

import { StructuredToolTraceCard } from "@/renderer/components/chat/message-tool-trace"
import { SubagentRowView } from "@/renderer/components/chat/subagents/subagent-row"
import type {
  ChatToolPart,
  GroupedChainEntry
} from "@/renderer/lib/chat/assistant-message-timeline"
import {
  useSubagentApprovals,
  useSubagentChildIds,
  useSubagentLive
} from "@/renderer/lib/chat/subagent-stream-store"
import {
  delegatePartViewModel,
  isUnsettledRunStatus,
  liveSubagentViewModel,
  selectWorkflowChildRuns,
  workflowChildRunViewModel
} from "@/renderer/lib/chat/subagent-view-model"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"
import { orpc } from "@/renderer/lib/rpc"

// Poll a workflow card's history children while any of them is still in flight.
const UNSETTLED_RUN_REFETCH_MS = 2000

// Live delegated/workflow child row. A primitive `childRunId` prop keeps the row
// memoized so a parent card's stream re-renders don't cascade into it — each
// child subscribes to just its own live state.
const SubagentLiveRow = memo(({ childRunId }: { childRunId: string }) => {
  const live = useSubagentLive(childRunId)
  const approvals = useSubagentApprovals(childRunId)
  const model = useMemo(
    () => (live === undefined ? null : liveSubagentViewModel(live, approvals)),
    [live, approvals]
  )

  if (model === null) {
    return null
  }

  return <SubagentRowView model={model} />
})
SubagentLiveRow.displayName = "SubagentLiveRow"

// Settled delegate tool part → row. Everything comes from the recorded input and
// output through the shared view-model adapter.
const DelegateHistoryRow = ({ part }: { part: ChatToolPart }) => {
  const model = useMemo(() => delegatePartViewModel(part), [part])

  return <SubagentRowView model={model} />
}

// History fallback for a workflow card's children. Keeps a single listRuns query
// per parent run (shared across the parent's workflow cards) and scopes it to
// this card's tool call through `selectWorkflowChildRuns`, which falls back to
// the workflow profile for legacy runs recorded before parentToolCallId existed.
const WorkflowHistoryChildren = memo(
  ({
    parentRunId,
    workflowToolCallId
  }: {
    parentRunId: string
    workflowToolCallId: string
  }) => {
    const { t } = useI18n()
    const query = useQuery({
      ...orpc.agents.listRuns.queryOptions({ input: { parentRunId } }),
      refetchInterval: (runsQuery) => {
        const runs = runsQuery.state.data?.runs

        return runs?.some((run) => isUnsettledRunStatus(run.status))
          ? UNSETTLED_RUN_REFETCH_MS
          : false
      }
    })

    if (query.isPending || query.isError || !query.data) {
      return null
    }

    const runs = selectWorkflowChildRuns(query.data.runs, workflowToolCallId)

    if (runs.length === 0) {
      return null
    }

    return (
      <div
        aria-label={t("chat.workSection.ranWorkflow")}
        className="flex flex-col gap-1"
      >
        {runs.map((run) => (
          <SubagentRowView
            key={run.id}
            model={workflowChildRunViewModel(run)}
          />
        ))}
      </div>
    )
  }
)
WorkflowHistoryChildren.displayName = "WorkflowHistoryChildren"

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
          <WorkflowHistoryChildren
            parentRunId={parentRunId}
            workflowToolCallId={part.toolCallId}
          />
        </div>
      ) : null}
    </div>
  )
}

export const WorkSubagentEntry = ({
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
