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
  canExecuteRunningNode: boolean
  canRetryFailedNode: boolean
  canRunGraph: boolean
  canSkipFailedNode: boolean
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

export type AgentWorkbenchBackgroundProcessStatus =
  | "exited"
  | "running"
  | "spawn_error"
  | "stopped"
  | "unknown"

export interface AgentWorkbenchBackgroundProcessPreview {
  command?: string
  cwd?: string
  durationMs?: number
  exitCode?: number | null
  finishedAt?: string
  id: string
  lastEventSequence: number
  outputEventCount: number
  pid?: number | null
  processId: string
  sandboxed?: boolean
  startedAt?: string
  status: AgentWorkbenchBackgroundProcessStatus
  stderrChars: number
  stdoutChars: number
}

export type AgentWorkbenchShellCommandStatus =
  | "failed"
  | "running"
  | "success"
  | "unknown"

export type AgentWorkbenchShellFinishedStatus =
  | "aborted"
  | "exited"
  | "spawn_error"
  | "timed_out"

export interface AgentWorkbenchShellCommandPreview {
  command?: string
  cwd?: string
  durationMs?: number
  exitCode?: number | null
  id: string
  lastEventSequence: number
  outputEventCount: number
  pid?: number | null
  sandboxed?: boolean
  shellStatus?: AgentWorkbenchShellFinishedStatus
  startedAt?: string
  status: AgentWorkbenchShellCommandStatus
  stderrChars: number
  stdoutChars: number
}

export interface AgentWorkbenchShellOutputPreview {
  channel: "stderr" | "stdout"
  chunkCount: number
  commandLabel: string
  cwd?: string
  id: string
  lastEventSequence: number
  processId?: string
  text: string
  truncated: boolean
  type: "background_process_output" | "sandbox_command_output"
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

interface AgentWorkbenchBackgroundProcessDraft {
  command?: string
  cwd?: string
  durationMs?: number
  exitCode?: number | null
  finishedAt?: string
  firstEventId: string
  lastEventSequence: number
  outputEventCount: number
  pid?: number | null
  processId: string
  sandboxed?: boolean
  startedAt?: string
  status?: AgentWorkbenchBackgroundProcessStatus
  stderrChars: number
  stdoutChars: number
}

interface AgentWorkbenchShellCommandDraft {
  command?: string
  cwd?: string
  durationMs?: number
  exitCode?: number | null
  firstEventId: string
  lastEventSequence: number
  outputEventCount: number
  pid?: number | null
  sandboxed?: boolean
  shellStatus?: AgentWorkbenchShellFinishedStatus
  startedAt?: string
  status?: AgentWorkbenchShellCommandStatus
  stderrChars: number
  stdoutChars: number
}

export const AGENT_WORKBENCH_RUN_GRAPH_MAX_DEPTH = 6
const AGENT_WORKBENCH_GRAPH_OUTPUT_PREVIEW_MAX_LENGTH = 220
const AGENT_WORKBENCH_SESSION_ENTRY_PREVIEW_MAX_LENGTH = 160
const AGENT_WORKBENCH_SHELL_OUTPUT_PREVIEW_MAX_LENGTH = 1_200

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

const getNullableNumberPayloadValue = (
  payload: unknown,
  key: string
): number | null | undefined => {
  if (!isRecord(payload)) {
    return undefined
  }

  const value = payload[key]

  return typeof value === "number" || value === null ? value : undefined
}

const getStringPayloadValue = (
  payload: unknown,
  key: string
): string | undefined =>
  isRecord(payload) && typeof payload[key] === "string"
    ? payload[key]
    : undefined

const getOutputChannelPayloadValue = (
  payload: unknown
): "stderr" | "stdout" | undefined => {
  const channel = getStringPayloadValue(payload, "channel")

  return channel === "stderr" || channel === "stdout" ? channel : undefined
}

const getBackgroundProcessStatusPayloadValue = (
  payload: unknown
): AgentWorkbenchBackgroundProcessStatus | undefined => {
  const status = getStringPayloadValue(payload, "status")

  return status === "exited" ||
    status === "running" ||
    status === "spawn_error" ||
    status === "stopped"
    ? status
    : undefined
}

const getShellCommandStatusPayloadValue = (
  payload: unknown
): AgentWorkbenchShellCommandStatus | undefined => {
  const status = getStringPayloadValue(payload, "status")

  return status === "failed" || status === "success" ? status : undefined
}

const getShellFinishedStatusPayloadValue = (
  payload: unknown
): AgentWorkbenchShellFinishedStatus | undefined => {
  const status = getStringPayloadValue(payload, "shellStatus")

  return status === "aborted" ||
    status === "exited" ||
    status === "spawn_error" ||
    status === "timed_out"
    ? status
    : undefined
}

const truncateShellOutputPreview = (
  text: string
): { text: string; truncated: boolean } => {
  if (text.length <= AGENT_WORKBENCH_SHELL_OUTPUT_PREVIEW_MAX_LENGTH) {
    return {
      text,
      truncated: false
    }
  }

  return {
    text: text.slice(-AGENT_WORKBENCH_SHELL_OUTPUT_PREVIEW_MAX_LENGTH),
    truncated: true
  }
}

const getSessionEntryMessageData = (message: unknown): unknown =>
  isRecord(message) ? message.data : undefined

const getChatBranchSessionEntryPreview = (
  entry: AgentSessionTreeEntry
): AgentWorkbenchSessionEntryPreview | null => {
  if (
    entry.type !== "custom_message" ||
    getSessionEntryMessageType(entry.message) !== "chat-branch"
  ) {
    return null
  }

  const data = getSessionEntryMessageData(entry.message)
  const branchKind = getStringPayloadValue(data, "branchKind") ?? "chat"
  const messageId = getStringPayloadValue(data, "messageId")
  const retainedMessageCount = getNumberPayloadValue(
    data,
    "retainedMessageCount"
  )
  const trigger = getStringPayloadValue(data, "trigger")
  const detailParts = [
    messageId ? `message ${messageId}` : null,
    retainedMessageCount === undefined
      ? null
      : `retained ${retainedMessageCount}`,
    trigger ? `trigger ${trigger}` : null
  ].filter((part): part is string => typeof part === "string")

  return {
    detail: truncateSessionEntryPreview(
      detailParts.length > 0
        ? detailParts.join("; ")
        : stringifySessionEntryValue(data)
    ),
    id: entry.id,
    label: `#${entry.sequence} ${branchKind} branch`,
    type: entry.type
  }
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

  const chatBranchPreview = getChatBranchSessionEntryPreview(entry)

  if (chatBranchPreview) {
    return chatBranchPreview
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
    canExecuteRunningNode: isGraphRunning && !isPending,
    canRetryFailedNode: failedNode !== null && !isPending,
    canRunGraph: isGraphSelected && !isPending,
    canSkipFailedNode: failedNode !== null && !isGraphRunning && !isPending,
    canStartNextStage: isGraphSelected && !isGraphRunning && !isPending
  }
}

export const getAgentWorkbenchFirstFailedNode = (
  plan: AgentRunGraphExecutionPlan | null
): AgentRunGraphExecutionNode | null =>
  plan?.nodes.find((node) => node.status === "failed") ?? null

export const getAgentWorkbenchFirstRunningNode = (
  plan: AgentRunGraphExecutionPlan | null
): AgentRunGraphExecutionNode | null =>
  plan?.nodes.find((node) => node.status === "running") ?? null

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

const getBackgroundProcessDraft = ({
  event,
  processesById,
  processId
}: {
  event: InspectAgentRunOutput["events"][number]
  processesById: Map<string, AgentWorkbenchBackgroundProcessDraft>
  processId: string
}): AgentWorkbenchBackgroundProcessDraft => {
  const existingProcess = processesById.get(processId)

  if (existingProcess) {
    existingProcess.lastEventSequence = Math.max(
      existingProcess.lastEventSequence,
      event.sequence
    )

    return existingProcess
  }

  const process: AgentWorkbenchBackgroundProcessDraft = {
    firstEventId: event.id,
    lastEventSequence: event.sequence,
    outputEventCount: 0,
    processId,
    stderrChars: 0,
    stdoutChars: 0
  }

  processesById.set(processId, process)

  return process
}

const updateBackgroundProcessCommandMetadata = (
  process: AgentWorkbenchBackgroundProcessDraft,
  payload: unknown
): void => {
  const command = getStringPayloadValue(payload, "command")
  const cwd = getStringPayloadValue(payload, "cwd")

  if (command) {
    process.command = command
  }

  if (cwd) {
    process.cwd = cwd
  }
}

const updateBackgroundProcessSandboxMetadata = (
  process: AgentWorkbenchBackgroundProcessDraft,
  payload: unknown
): void => {
  const sandboxed = getBooleanPayloadValue(payload, "sandboxed")

  if (sandboxed !== undefined) {
    process.sandboxed = sandboxed
  }
}

const applyBackgroundProcessFinishedEvent = (
  process: AgentWorkbenchBackgroundProcessDraft,
  payload: unknown
): void => {
  const durationMs = getNumberPayloadValue(payload, "durationMs")
  const exitCode = getNullableNumberPayloadValue(payload, "exitCode")
  const finishedAt = getStringPayloadValue(payload, "finishedAt")
  const status = getBackgroundProcessStatusPayloadValue(payload)
  const stderrChars = getNumberPayloadValue(payload, "stderrChars")
  const stdoutChars = getNumberPayloadValue(payload, "stdoutChars")

  updateBackgroundProcessCommandMetadata(process, payload)
  updateBackgroundProcessSandboxMetadata(process, payload)

  if (durationMs !== undefined) {
    process.durationMs = durationMs
  }

  if (exitCode !== undefined) {
    process.exitCode = exitCode
  }

  if (finishedAt) {
    process.finishedAt = finishedAt
  }

  if (status) {
    process.status = status
  }

  if (stderrChars !== undefined) {
    process.stderrChars = stderrChars
  }

  if (stdoutChars !== undefined) {
    process.stdoutChars = stdoutChars
  }
}

const applyBackgroundProcessOutputEvent = (
  process: AgentWorkbenchBackgroundProcessDraft,
  payload: unknown
): void => {
  const channel = getOutputChannelPayloadValue(payload)
  const chunk = getStringPayloadValue(payload, "chunk")

  process.outputEventCount += 1

  if (chunk === undefined) {
    return
  }

  if (channel === "stderr") {
    process.stderrChars += chunk.length
    return
  }

  if (channel === "stdout") {
    process.stdoutChars += chunk.length
  }
}

const applyBackgroundProcessStartedEvent = (
  process: AgentWorkbenchBackgroundProcessDraft,
  payload: unknown
): void => {
  const pid = getNullableNumberPayloadValue(payload, "pid")
  const startedAt = getStringPayloadValue(payload, "startedAt")

  updateBackgroundProcessCommandMetadata(process, payload)
  updateBackgroundProcessSandboxMetadata(process, payload)

  if (pid !== undefined) {
    process.pid = pid
  }

  if (startedAt) {
    process.startedAt = startedAt
  }

  process.status ??= "running"
}

const isBackgroundProcessLifecycleEvent = (
  event: InspectAgentRunOutput["events"][number]
): boolean =>
  event.type === "background_process_finished" ||
  event.type === "background_process_output" ||
  event.type === "background_process_started"

const toBackgroundProcessPreview = (
  process: AgentWorkbenchBackgroundProcessDraft
): AgentWorkbenchBackgroundProcessPreview => ({
  ...(process.command ? { command: process.command } : {}),
  ...(process.cwd ? { cwd: process.cwd } : {}),
  ...(process.durationMs === undefined
    ? {}
    : { durationMs: process.durationMs }),
  ...(process.exitCode === undefined ? {} : { exitCode: process.exitCode }),
  ...(process.finishedAt ? { finishedAt: process.finishedAt } : {}),
  id: process.firstEventId,
  lastEventSequence: process.lastEventSequence,
  outputEventCount: process.outputEventCount,
  ...(process.pid === undefined ? {} : { pid: process.pid }),
  processId: process.processId,
  ...(process.sandboxed === undefined ? {} : { sandboxed: process.sandboxed }),
  ...(process.startedAt ? { startedAt: process.startedAt } : {}),
  status: process.status ?? "unknown",
  stderrChars: process.stderrChars,
  stdoutChars: process.stdoutChars
})

export const getAgentWorkbenchBackgroundProcessPreview = (
  trace: InspectAgentRunOutput | undefined
): AgentWorkbenchBackgroundProcessPreview[] => {
  if (!trace) {
    return []
  }

  const processesById = new Map<string, AgentWorkbenchBackgroundProcessDraft>()

  for (const event of trace.events) {
    if (!isBackgroundProcessLifecycleEvent(event)) {
      continue
    }

    const processId = getStringPayloadValue(event.payload, "processId")

    if (!processId) {
      continue
    }

    const process = getBackgroundProcessDraft({
      event,
      processesById,
      processId
    })

    switch (event.type) {
      case "background_process_finished": {
        applyBackgroundProcessFinishedEvent(process, event.payload)
        break
      }
      case "background_process_output": {
        applyBackgroundProcessOutputEvent(process, event.payload)
        break
      }
      case "background_process_started": {
        applyBackgroundProcessStartedEvent(process, event.payload)
        break
      }
      default: {
        break
      }
    }
  }

  return [...processesById.values()]
    .map(toBackgroundProcessPreview)
    .toSorted((left, right) => right.lastEventSequence - left.lastEventSequence)
}

const isSandboxCommandLifecycleEvent = (
  event: InspectAgentRunOutput["events"][number]
): boolean =>
  event.type === "sandbox_command_finished" ||
  event.type === "sandbox_command_output" ||
  event.type === "sandbox_command_started"

const updateShellCommandMetadata = (
  command: AgentWorkbenchShellCommandDraft,
  payload: unknown
): void => {
  const commandText = getStringPayloadValue(payload, "command")
  const cwd = getStringPayloadValue(payload, "cwd")

  if (commandText) {
    command.command = commandText
  }

  if (cwd) {
    command.cwd = cwd
  }
}

const updateShellCommandSandboxMetadata = (
  command: AgentWorkbenchShellCommandDraft,
  payload: unknown
): void => {
  const sandboxed = getBooleanPayloadValue(payload, "sandboxed")

  if (sandboxed !== undefined) {
    command.sandboxed = sandboxed
  }
}

const createShellCommandDraft = (
  event: InspectAgentRunOutput["events"][number]
): AgentWorkbenchShellCommandDraft => {
  const command = getStringPayloadValue(event.payload, "command")
  const cwd = getStringPayloadValue(event.payload, "cwd")

  return {
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    firstEventId: event.id,
    lastEventSequence: event.sequence,
    outputEventCount: 0,
    status: "running",
    stderrChars: 0,
    stdoutChars: 0
  }
}

const getOpenShellCommandDraft = (
  commands: AgentWorkbenchShellCommandDraft[],
  payload: unknown
): AgentWorkbenchShellCommandDraft | undefined => {
  const command = getStringPayloadValue(payload, "command")
  const cwd = getStringPayloadValue(payload, "cwd")

  if (!command) {
    return undefined
  }

  return commands.findLast(
    (draft) =>
      draft.command === command &&
      draft.cwd === cwd &&
      draft.status === "running"
  )
}

const getShellCommandDraftForEvent = ({
  commands,
  event
}: {
  commands: AgentWorkbenchShellCommandDraft[]
  event: InspectAgentRunOutput["events"][number]
}): AgentWorkbenchShellCommandDraft => {
  const existingCommand = getOpenShellCommandDraft(commands, event.payload)

  if (existingCommand) {
    existingCommand.lastEventSequence = Math.max(
      existingCommand.lastEventSequence,
      event.sequence
    )

    return existingCommand
  }

  const command = createShellCommandDraft(event)

  commands.push(command)

  return command
}

const applyShellCommandFinishedEvent = (
  command: AgentWorkbenchShellCommandDraft,
  payload: unknown
): void => {
  const durationMs = getNumberPayloadValue(payload, "durationMs")
  const exitCode = getNullableNumberPayloadValue(payload, "exitCode")
  const shellStatus = getShellFinishedStatusPayloadValue(payload)
  const status = getShellCommandStatusPayloadValue(payload)
  const stderrChars = getNumberPayloadValue(payload, "stderrChars")
  const stdoutChars = getNumberPayloadValue(payload, "stdoutChars")

  updateShellCommandMetadata(command, payload)
  updateShellCommandSandboxMetadata(command, payload)

  if (durationMs !== undefined) {
    command.durationMs = durationMs
  }

  if (exitCode !== undefined) {
    command.exitCode = exitCode
  }

  if (shellStatus) {
    command.shellStatus = shellStatus
  }

  if (status) {
    command.status = status
  }

  if (stderrChars !== undefined) {
    command.stderrChars = stderrChars
  }

  if (stdoutChars !== undefined) {
    command.stdoutChars = stdoutChars
  }
}

const applyShellCommandOutputEvent = (
  command: AgentWorkbenchShellCommandDraft,
  payload: unknown
): void => {
  const channel = getOutputChannelPayloadValue(payload)
  const chunk = getStringPayloadValue(payload, "chunk")

  command.outputEventCount += 1

  if (chunk === undefined) {
    return
  }

  if (channel === "stderr") {
    command.stderrChars += chunk.length
    return
  }

  if (channel === "stdout") {
    command.stdoutChars += chunk.length
  }
}

const applyShellCommandStartedEvent = (
  command: AgentWorkbenchShellCommandDraft,
  payload: unknown
): void => {
  const pid = getNullableNumberPayloadValue(payload, "pid")
  const startedAt = getStringPayloadValue(payload, "startedAt")

  updateShellCommandMetadata(command, payload)
  updateShellCommandSandboxMetadata(command, payload)

  if (pid !== undefined) {
    command.pid = pid
  }

  if (startedAt) {
    command.startedAt = startedAt
  }

  command.status = "running"
}

const toShellCommandPreview = (
  command: AgentWorkbenchShellCommandDraft
): AgentWorkbenchShellCommandPreview => ({
  ...(command.command ? { command: command.command } : {}),
  ...(command.cwd ? { cwd: command.cwd } : {}),
  ...(command.durationMs === undefined
    ? {}
    : { durationMs: command.durationMs }),
  ...(command.exitCode === undefined ? {} : { exitCode: command.exitCode }),
  id: command.firstEventId,
  lastEventSequence: command.lastEventSequence,
  outputEventCount: command.outputEventCount,
  ...(command.pid === undefined ? {} : { pid: command.pid }),
  ...(command.sandboxed === undefined ? {} : { sandboxed: command.sandboxed }),
  ...(command.shellStatus ? { shellStatus: command.shellStatus } : {}),
  ...(command.startedAt ? { startedAt: command.startedAt } : {}),
  status: command.status ?? "unknown",
  stderrChars: command.stderrChars,
  stdoutChars: command.stdoutChars
})

export const getAgentWorkbenchShellCommandPreview = (
  trace: InspectAgentRunOutput | undefined
): AgentWorkbenchShellCommandPreview[] => {
  if (!trace) {
    return []
  }

  const commands: AgentWorkbenchShellCommandDraft[] = []

  for (const event of trace.events) {
    if (!isSandboxCommandLifecycleEvent(event)) {
      continue
    }

    const command =
      event.type === "sandbox_command_started"
        ? createShellCommandDraft(event)
        : getShellCommandDraftForEvent({
            commands,
            event
          })

    if (event.type === "sandbox_command_started") {
      commands.push(command)
    }

    switch (event.type) {
      case "sandbox_command_finished": {
        applyShellCommandFinishedEvent(command, event.payload)
        break
      }
      case "sandbox_command_output": {
        applyShellCommandOutputEvent(command, event.payload)
        break
      }
      case "sandbox_command_started": {
        applyShellCommandStartedEvent(command, event.payload)
        break
      }
      default: {
        break
      }
    }
  }

  return commands
    .map(toShellCommandPreview)
    .toSorted((left, right) => right.lastEventSequence - left.lastEventSequence)
}

export const getAgentWorkbenchShellOutputPreview = (
  trace: InspectAgentRunOutput | undefined
): AgentWorkbenchShellOutputPreview[] => {
  if (!trace) {
    return []
  }

  const outputsById = new Map<
    string,
    {
      channel: "stderr" | "stdout"
      chunks: string[]
      commandLabel: string
      cwd?: string
      firstEventId: string
      lastEventSequence: number
      processId?: string
      type: "background_process_output" | "sandbox_command_output"
    }
  >()

  for (const event of trace.events) {
    if (
      event.type !== "sandbox_command_output" &&
      event.type !== "background_process_output"
    ) {
      continue
    }

    const channel = getOutputChannelPayloadValue(event.payload)
    const chunk = getStringPayloadValue(event.payload, "chunk")

    if (!channel || chunk === undefined) {
      continue
    }

    const command = getStringPayloadValue(event.payload, "command")
    const cwd = getStringPayloadValue(event.payload, "cwd")
    const processId = getStringPayloadValue(event.payload, "processId")
    const commandLabel =
      command ??
      (processId ? `process ${processId}` : event.type.replaceAll("_", " "))
    const id = [
      event.type,
      channel,
      processId ?? "",
      command ?? "",
      cwd ?? ""
    ].join(":")
    const existingOutput = outputsById.get(id)

    if (existingOutput) {
      existingOutput.chunks.push(chunk)
      existingOutput.lastEventSequence = event.sequence
      continue
    }

    outputsById.set(id, {
      channel,
      chunks: [chunk],
      commandLabel,
      ...(cwd ? { cwd } : {}),
      firstEventId: event.id,
      lastEventSequence: event.sequence,
      ...(processId ? { processId } : {}),
      type: event.type
    })
  }

  return [...outputsById.values()]
    .map((output) => {
      const preview = truncateShellOutputPreview(output.chunks.join(""))

      return {
        channel: output.channel,
        chunkCount: output.chunks.length,
        commandLabel: output.commandLabel,
        ...(output.cwd ? { cwd: output.cwd } : {}),
        id: output.firstEventId,
        lastEventSequence: output.lastEventSequence,
        ...(output.processId ? { processId: output.processId } : {}),
        text: preview.text,
        truncated: preview.truncated,
        type: output.type
      }
    })
    .toSorted((left, right) => right.lastEventSequence - left.lastEventSequence)
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
  childRun,
  childRuns = [],
  run,
  startedRuns = []
}: {
  childRun?: AgentRunTraceRun
  childRuns?: AgentRunTraceRun[]
  run: AgentRunTraceRun
  startedRuns?: AgentRunTraceRun[]
}): string[] => [
  ...new Set([
    run.id,
    ...(childRun ? [childRun.id] : []),
    ...childRuns.map((runGraphChildRun) => runGraphChildRun.id),
    ...startedRuns.map((startedRun) => startedRun.id)
  ])
]

export const getGraphApprovalOperationRunIds = ({
  childRun,
  continuedGraph,
  run,
  startedRuns = []
}: {
  childRun: AgentRunTraceRun
  continuedGraph?: {
    childRuns?: AgentRunTraceRun[]
    run: AgentRunTraceRun
    startedRuns?: AgentRunTraceRun[]
  }
  run: AgentRunTraceRun
  startedRuns?: AgentRunTraceRun[]
}): string[] => [
  ...new Set([
    run.id,
    childRun.id,
    ...startedRuns.map((startedRun) => startedRun.id),
    ...(continuedGraph ? getGraphOperationRunIds(continuedGraph) : [])
  ])
]

export const hasRunningRunGraphNode = (
  plan: AgentRunGraphExecutionPlan | null
): boolean => plan?.nodes.some((node) => node.status === "running") ?? false
