import type {
  AgentRetrySettings,
  AgentRunGraphExecutionNode,
  AgentRunGraphExecutionPlan,
  AgentRunTraceRun,
  AgentSessionSnapshotOutput,
  AgentSessionTreeEntry,
  GitProjectDiffOutput,
  InspectAgentRunOutput,
  PendingAgentApproval
} from "@etyon/rpc"

import {
  buildAgentRunTracePreview,
  getAgentRunGraphPlanFromTrace
} from "@/renderer/lib/chat/agent-run-trace"
import {
  getProjectDiffFileStats,
  getProjectDiffSummary,
  parseProjectDiffFiles
} from "@/renderer/lib/chat/project-context-panel"

export type AgentRunTracePreview = ReturnType<typeof buildAgentRunTracePreview>

export interface AgentWorkbenchControlState {
  canAdvanceGraph: boolean
  canCreateGraph: boolean
  canRetryFailedNode: boolean
  canStartNextStage: boolean
}

export interface AgentWorkbenchDiffFilePreview {
  additions: number
  deletions: number
  path: string
}

export interface AgentWorkbenchDiffPreview {
  additions: number
  changedFileCount: number
  deletions: number
  files: AgentWorkbenchDiffFilePreview[]
  hasChanges: boolean
  truncated: boolean
}

export interface AgentWorkbenchGraphEdgePreview {
  fromLabel: string
  fromNodeId: string
  toLabel: string
  toNodeId: string
}

export interface AgentWorkbenchGraphNodePreview {
  activeToolCount: number
  attempt: number
  childRunId?: string
  dependsOn: AgentWorkbenchGraphEdgePreview[]
  errorMessage?: string
  id: string
  label: string
  lastOutputPreview?: string
  outputContract: string
  profileId: string
  role: string
  status: AgentRunGraphExecutionNode["status"]
  toolScope: string
}

export interface AgentWorkbenchGraphRetryPreview {
  attempt?: number
  automatic: boolean
  childRunId?: string
  errorMessage?: string
  eventId: string
  nodeId: string
  sequence: number
}

export interface AgentWorkbenchRetryPolicyPreview {
  automaticRetryEnabled: boolean
  maxAutomaticRetries: number
  retryTransientFailures: boolean
}

export interface AgentWorkbenchGraphPreview {
  edges: AgentWorkbenchGraphEdgePreview[]
  name: string
  stages: AgentWorkbenchGraphStagePreview[]
  task?: string
  totalNodeCount: number
}

export interface AgentWorkbenchGraphStagePreview {
  id: string
  index: number
  nodes: AgentWorkbenchGraphNodePreview[]
  parallel: boolean
}

export interface AgentWorkbenchSessionEntryPreview {
  detail: string
  id: string
  label: string
  type: AgentSessionTreeEntry["type"]
}

export interface AgentWorkbenchSessionPreview {
  contextCount: number
  entries: AgentWorkbenchSessionEntryPreview[]
  leafEntryId: string | null
  sessionEventCount: number
}

interface AgentWorkbenchRunGraphOptions {
  maxDepth?: number
  run: AgentRunTraceRun
  runsById: Map<string, AgentRunTraceRun>
  visitedIds?: Set<string>
}

interface AgentWorkbenchRootTraceOptions {
  inspectedRootRun: InspectAgentRunOutput | undefined
  inspectedRun: InspectAgentRunOutput | undefined
  rootRun: AgentRunTraceRun | null
  selectedRun: AgentRunTraceRun | null
}

interface AgentWorkbenchSelectedRunOptions {
  runsById: Map<string, AgentRunTraceRun>
  selectedRunId: string | null
}

export const AGENT_WORKBENCH_RUN_GRAPH_MAX_DEPTH = 6
const AGENT_WORKBENCH_GRAPH_OUTPUT_PREVIEW_MAX_LENGTH = 220
const AGENT_WORKBENCH_SESSION_ENTRY_PREVIEW_MAX_LENGTH = 160

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const truncateSessionEntryPreview = (value: string): string =>
  value.length > AGENT_WORKBENCH_SESSION_ENTRY_PREVIEW_MAX_LENGTH
    ? `${value.slice(0, AGENT_WORKBENCH_SESSION_ENTRY_PREVIEW_MAX_LENGTH)}...`
    : value

const stringifySessionEntryValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(stringifySessionEntryValue).join(" ")
  }

  if (isRecord(value)) {
    return JSON.stringify(value)
  }

  if (value === null || value === undefined) {
    return ""
  }

  return String(value)
}

const getSessionEntryMessageRole = (message: unknown): string | undefined =>
  isRecord(message) && typeof message.role === "string"
    ? message.role
    : undefined

const getSessionEntryMessageType = (message: unknown): string | undefined =>
  isRecord(message) && typeof message.type === "string"
    ? message.type
    : undefined

const getSessionEntryMessageContent = (message: unknown): string => {
  if (!isRecord(message)) {
    return stringifySessionEntryValue(message)
  }

  return stringifySessionEntryValue(message.content)
}

const getSessionEntryPreview = (
  entry: AgentSessionTreeEntry
): AgentWorkbenchSessionEntryPreview | null => {
  if (entry.type === "leaf") {
    return null
  }

  if (entry.type === "message") {
    const role = getSessionEntryMessageRole(entry.message) ?? "message"

    return {
      detail: truncateSessionEntryPreview(
        getSessionEntryMessageContent(entry.message)
      ),
      id: entry.id,
      label: `#${entry.sequence} ${role}`,
      type: entry.type
    }
  }

  if (entry.type === "branch_summary" || entry.type === "compaction_summary") {
    return {
      detail: truncateSessionEntryPreview(entry.summary ?? ""),
      id: entry.id,
      label: `#${entry.sequence} ${entry.type.replaceAll("_", " ")}`,
      type: entry.type
    }
  }

  const type = getSessionEntryMessageType(entry.message) ?? "custom"

  return {
    detail: truncateSessionEntryPreview(
      stringifySessionEntryValue(entry.message)
    ),
    id: entry.id,
    label: `#${entry.sequence} ${type}`,
    type: entry.type
  }
}

const getBooleanPayloadValue = (
  payload: unknown,
  key: string
): boolean | undefined =>
  isRecord(payload) && typeof payload[key] === "boolean"
    ? payload[key]
    : undefined

const getNumberPayloadValue = (
  payload: unknown,
  key: string
): number | undefined =>
  isRecord(payload) && typeof payload[key] === "number"
    ? payload[key]
    : undefined

const getStringPayloadValue = (
  payload: unknown,
  key: string
): string | undefined =>
  isRecord(payload) && typeof payload[key] === "string"
    ? payload[key]
    : undefined

const getGraphOutputPreview = (value: string | undefined): string | undefined =>
  value
    ? value.slice(0, AGENT_WORKBENCH_GRAPH_OUTPUT_PREVIEW_MAX_LENGTH)
    : value

const getGraphEdgePreview = ({
  nodesById,
  sourceNodeId,
  targetNode
}: {
  nodesById: Map<string, AgentRunGraphExecutionNode>
  sourceNodeId: string
  targetNode: AgentRunGraphExecutionNode
}): AgentWorkbenchGraphEdgePreview => {
  const sourceNode = nodesById.get(sourceNodeId)

  return {
    fromLabel: sourceNode?.label ?? sourceNodeId,
    fromNodeId: sourceNodeId,
    toLabel: targetNode.label,
    toNodeId: targetNode.id
  }
}

const getGraphNodePreview = ({
  node,
  nodesById
}: {
  node: AgentRunGraphExecutionNode
  nodesById: Map<string, AgentRunGraphExecutionNode>
}): AgentWorkbenchGraphNodePreview => ({
  activeToolCount: node.activeToolNames.length,
  attempt: node.attempt,
  ...(node.childRunId ? { childRunId: node.childRunId } : {}),
  dependsOn: node.dependsOn.map((sourceNodeId) =>
    getGraphEdgePreview({
      nodesById,
      sourceNodeId,
      targetNode: node
    })
  ),
  ...(node.errorMessage ? { errorMessage: node.errorMessage } : {}),
  id: node.id,
  label: node.label,
  ...(node.lastOutput
    ? { lastOutputPreview: getGraphOutputPreview(node.lastOutput) }
    : {}),
  outputContract: node.outputContract,
  profileId: node.profileId,
  role: node.role,
  status: node.status,
  toolScope: node.toolScope
})

export const getAgentWorkbenchControlState = ({
  failedNode,
  graphPlan,
  isPending,
  templateCount
}: {
  failedNode: AgentRunGraphExecutionNode | null
  graphPlan: AgentRunGraphExecutionPlan | null
  isPending: boolean
  templateCount: number
}): AgentWorkbenchControlState => {
  const isGraphRunning = hasRunningRunGraphNode(graphPlan)
  const isGraphSelected = graphPlan !== null

  return {
    canAdvanceGraph: isGraphSelected && !isPending,
    canCreateGraph: templateCount > 0 && !isPending,
    canRetryFailedNode: failedNode !== null && !isPending,
    canStartNextStage: isGraphSelected && !isGraphRunning && !isPending
  }
}

export const getAgentWorkbenchFirstFailedNode = (
  plan: AgentRunGraphExecutionPlan | null
): AgentRunGraphExecutionNode | null =>
  plan?.nodes.find((node) => node.status === "failed") ?? null

export const getAgentWorkbenchDiffPreview = (
  gitDiff?: GitProjectDiffOutput
): AgentWorkbenchDiffPreview => {
  const diffFiles = parseProjectDiffFiles({
    fileSnapshots: gitDiff?.fileSnapshots ?? [],
    patch: gitDiff?.patch ?? ""
  })
  const summary = getProjectDiffSummary({
    diffFiles
  })

  return {
    additions: summary.additions,
    changedFileCount: summary.changedFileCount,
    deletions: summary.deletions,
    files: diffFiles.map((fileDiff) => {
      const stats = getProjectDiffFileStats(fileDiff)

      return {
        additions: stats.additions,
        deletions: stats.deletions,
        path: fileDiff.name
      }
    }),
    hasChanges: summary.changedFileCount > 0 || gitDiff?.hasPatch === true,
    truncated: gitDiff?.truncated === true
  }
}

export const getAgentWorkbenchGraphPlan = (
  trace: InspectAgentRunOutput | undefined
): AgentRunGraphExecutionPlan | null =>
  trace ? getAgentRunGraphPlanFromTrace(trace) : null

export const getAgentWorkbenchGraphPreview = (
  plan: AgentRunGraphExecutionPlan | null
): AgentWorkbenchGraphPreview | null => {
  if (!plan) {
    return null
  }

  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]))
  const stagedNodeIds = new Set<string>()
  const stages = plan.stages.map((stage) => {
    const nodes = stage.nodeIds.flatMap((nodeId) => {
      const node = nodesById.get(nodeId)

      if (!node) {
        return []
      }

      stagedNodeIds.add(node.id)

      return [
        getGraphNodePreview({
          node,
          nodesById
        })
      ]
    })

    return {
      id: stage.id,
      index: stage.index,
      nodes,
      parallel: stage.parallel
    }
  })
  const looseNodes = plan.nodes.filter((node) => !stagedNodeIds.has(node.id))

  if (looseNodes.length > 0) {
    stages.push({
      id: "unassigned",
      index: stages.length,
      nodes: looseNodes.map((node) =>
        getGraphNodePreview({
          node,
          nodesById
        })
      ),
      parallel: looseNodes.length > 1
    })
  }

  return {
    edges: plan.nodes.flatMap((node) =>
      node.dependsOn.map((sourceNodeId) =>
        getGraphEdgePreview({
          nodesById,
          sourceNodeId,
          targetNode: node
        })
      )
    ),
    name: plan.name,
    stages,
    ...(plan.task ? { task: plan.task } : {}),
    totalNodeCount: plan.nodes.length
  }
}

export const getAgentWorkbenchGraphRetryPreview = (
  trace?: InspectAgentRunOutput
): AgentWorkbenchGraphRetryPreview[] => {
  if (!trace) {
    return []
  }

  return trace.events.flatMap((event) => {
    if (event.type !== "agent_run_graph_node_retrying") {
      return []
    }

    const nodeId = getStringPayloadValue(event.payload, "nodeId")

    if (!nodeId) {
      return []
    }

    const attempt = getNumberPayloadValue(event.payload, "attempt")
    const childRunId = getStringPayloadValue(event.payload, "childRunId")
    const errorMessage = getStringPayloadValue(event.payload, "errorMessage")

    return [
      {
        ...(attempt === undefined ? {} : { attempt }),
        automatic: getBooleanPayloadValue(event.payload, "automatic") ?? false,
        ...(childRunId ? { childRunId } : {}),
        ...(errorMessage ? { errorMessage } : {}),
        eventId: event.id,
        nodeId,
        sequence: event.sequence
      }
    ]
  })
}

export const getAgentWorkbenchRetryPolicyPreview = (
  retrySettings?: AgentRetrySettings | null
): AgentWorkbenchRetryPolicyPreview => {
  const maxAutomaticRetries = Math.max(
    0,
    retrySettings?.maxAutomaticRetries ?? 0
  )
  const retryTransientFailures = retrySettings?.retryTransientFailures === true

  return {
    automaticRetryEnabled: retryTransientFailures && maxAutomaticRetries > 0,
    maxAutomaticRetries,
    retryTransientFailures
  }
}

export const getAgentWorkbenchOperationErrorMessage = (
  error: unknown
): string | null => {
  if (!error) {
    return null
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export const getAgentWorkbenchPreview = (
  trace: InspectAgentRunOutput | undefined
): AgentRunTracePreview | null =>
  trace ? buildAgentRunTracePreview(trace) : null

export const getAgentWorkbenchSessionPreview = (
  snapshot: AgentSessionSnapshotOutput | null | undefined
): AgentWorkbenchSessionPreview | null => {
  if (!snapshot?.run) {
    return null
  }

  const leafEntry = snapshot.entries.findLast((entry) => entry.type === "leaf")

  return {
    contextCount: snapshot.context.length,
    entries: snapshot.entries.flatMap((entry) => {
      const preview = getSessionEntryPreview(entry)

      return preview ? [preview] : []
    }),
    leafEntryId: leafEntry?.targetEntryId ?? null,
    sessionEventCount: snapshot.events.length
  }
}

export const getAgentWorkbenchPendingApprovals = ({
  approvals,
  rootRun,
  runsById
}: {
  approvals: PendingAgentApproval[]
  rootRun: AgentRunTraceRun | null
  runsById: Map<string, AgentRunTraceRun>
}): PendingAgentApproval[] => {
  if (!rootRun) {
    return []
  }

  return approvals.filter((approval) => {
    const approvalRun = runsById.get(approval.runId)

    if (!approvalRun) {
      return approval.runId === rootRun.id
    }

    return (
      getAgentWorkbenchRootRun({
        run: approvalRun,
        runsById
      }).id === rootRun.id
    )
  })
}

export const getAgentWorkbenchRootRun = ({
  maxDepth = AGENT_WORKBENCH_RUN_GRAPH_MAX_DEPTH,
  run,
  runsById,
  visitedIds = new Set<string>()
}: AgentWorkbenchRunGraphOptions): AgentRunTraceRun => {
  if (
    !run.parentRunId ||
    visitedIds.has(run.id) ||
    visitedIds.size >= maxDepth
  ) {
    return run
  }

  const parentRun = runsById.get(run.parentRunId)

  if (!parentRun) {
    return run
  }

  visitedIds.add(run.id)

  return getAgentWorkbenchRootRun({
    maxDepth,
    run: parentRun,
    runsById,
    visitedIds
  })
}

export const getAgentWorkbenchRootRunOrNull = ({
  run,
  runsById
}: {
  run: AgentRunTraceRun | null
  runsById: Map<string, AgentRunTraceRun>
}): AgentRunTraceRun | null =>
  run
    ? getAgentWorkbenchRootRun({
        run,
        runsById
      })
    : null

export const getAgentWorkbenchRootTrace = ({
  inspectedRootRun,
  inspectedRun,
  rootRun,
  selectedRun
}: AgentWorkbenchRootTraceOptions): InspectAgentRunOutput | undefined =>
  rootRun?.id === selectedRun?.id ? inspectedRun : inspectedRootRun

export const getAgentWorkbenchRunDepth = ({
  maxDepth = AGENT_WORKBENCH_RUN_GRAPH_MAX_DEPTH,
  run,
  runsById,
  visitedIds = new Set<string>()
}: AgentWorkbenchRunGraphOptions): number => {
  if (
    !run.parentRunId ||
    visitedIds.has(run.id) ||
    visitedIds.size >= maxDepth
  ) {
    return 0
  }

  const parentRun = runsById.get(run.parentRunId)

  if (!parentRun) {
    return 0
  }

  visitedIds.add(run.id)

  return (
    getAgentWorkbenchRunDepth({
      maxDepth,
      run: parentRun,
      runsById,
      visitedIds
    }) + 1
  )
}

export const getAgentWorkbenchSelectedRun = ({
  runsById,
  selectedRunId
}: AgentWorkbenchSelectedRunOptions): AgentRunTraceRun | null =>
  selectedRunId ? (runsById.get(selectedRunId) ?? null) : null

export const getGraphOperationRunIds = ({
  run,
  startedRuns = []
}: {
  run: AgentRunTraceRun
  startedRuns?: AgentRunTraceRun[]
}): string[] => [run.id, ...startedRuns.map((startedRun) => startedRun.id)]

export const getGraphApprovalOperationRunIds = ({
  childRun,
  run,
  startedRuns = []
}: {
  childRun: AgentRunTraceRun
  run: AgentRunTraceRun
  startedRuns?: AgentRunTraceRun[]
}): string[] => [
  ...new Set([
    run.id,
    childRun.id,
    ...startedRuns.map((startedRun) => startedRun.id)
  ])
]

export const hasRunningRunGraphNode = (
  plan: AgentRunGraphExecutionPlan | null
): boolean => plan?.nodes.some((node) => node.status === "running") ?? false
