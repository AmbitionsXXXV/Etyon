import { createHash, randomUUID } from "node:crypto"

import type { AgentSettings, MemorySettings } from "@etyon/rpc"
import type {
  LanguageModel,
  ModelMessage,
  ToolExecutionOptions,
  ToolSet
} from "ai"

import { recordAgentToolOutputArtifacts } from "@/main/agents/agent-artifacts"
import type { AgentRun } from "@/main/agents/agent-event-store"
import {
  appendAgentEvent,
  createAgentRun,
  getAgentRun,
  getAgentRunForToolApproval,
  listAgentEvents,
  recordAgentToolCall,
  updateAgentRun,
  updateAgentToolCall
} from "@/main/agents/agent-event-store"
import { runAgentLoop } from "@/main/agents/agent-loop"
import type {
  AgentLoopExecutedToolResult,
  AgentLoopMessage,
  AgentLoopModel,
  AgentLoopResources,
  AgentLoopStopReason,
  AgentLoopTool,
  AgentLoopToolCall
} from "@/main/agents/agent-loop"
import {
  convertAgentLoopMessagesToModelMessages,
  createAiSdkAgentLoopModel,
  createAiSdkAgentLoopTools,
  createAiSdkToolResultSummaryProcessor
} from "@/main/agents/agent-loop-ai-sdk"
import {
  getAgentModelFallbackCandidates,
  resolveAgentModelRoute
} from "@/main/agents/agent-model-router"
import type { AgentModelRoute } from "@/main/agents/agent-model-router"
import { isRetryableAgentFailure } from "@/main/agents/agent-plan-progress"
import {
  createAgentLoopToolRetryPolicy,
  isAgentToolAutoRetrySafe
} from "@/main/agents/agent-retry-policy"
import type {
  AgentRunGraphTemplate,
  AgentRunGraphTemplateId,
  AgentRunGraphTemplateNode
} from "@/main/agents/agent-run-graph-templates"
import {
  getAgentRunGraphTemplate,
  listAgentRunGraphTemplates
} from "@/main/agents/agent-run-graph-templates"
import { resolveActiveAgentProfile } from "@/main/agents/profiles"
import { compileAgentToolNames } from "@/main/agents/tool-policy"
import { buildAgentTools } from "@/main/agents/tool-registry"
import {
  createToolResultSummaryCache,
  formatToolResultSummaryAnnotation
} from "@/main/agents/truncate"
import type {
  AgentToolResultSummary,
  AgentToolResultSummaryCache,
  AgentToolResultSummaryProcessor
} from "@/main/agents/truncate"
import type { AgentToolName } from "@/main/agents/types"
import type { AppDatabase } from "@/main/db"

export type AgentRunGraphExecutionNodeStatus =
  | "failed"
  | "pending"
  | "running"
  | "skipped"
  | "succeeded"
  | "suspended"

const RUN_GRAPH_DEPENDENCY_SUMMARY_MAX_CHARS = 4000
const RUN_GRAPH_TOOL_RESULT_SUMMARY_CACHE_MAX_ENTRIES = 500
const runGraphToolResultSummaryCache = createToolResultSummaryCache({
  maxChars: RUN_GRAPH_DEPENDENCY_SUMMARY_MAX_CHARS,
  maxEntries: RUN_GRAPH_TOOL_RESULT_SUMMARY_CACHE_MAX_ENTRIES
})

export interface AgentRunGraphExecutionNode {
  activeToolNames: AgentToolName[]
  attempt: number
  childRunId?: string
  dependsOn: string[]
  errorMessage?: string
  id: string
  label: string
  lastOutput?: string
  outputContract: string
  parallelGroup?: string
  profileId: string
  role: AgentRunGraphTemplateNode["role"]
  stage: number
  status: AgentRunGraphExecutionNodeStatus
  toolScope: AgentRunGraphTemplateNode["toolScope"]
}

export interface AgentRunGraphExecutionStage {
  id: string
  index: number
  nodeIds: string[]
  parallel: boolean
}

export interface AgentRunGraphExecutionPlan {
  description: string
  id: AgentRunGraphTemplateId
  name: string
  nodes: AgentRunGraphExecutionNode[]
  retryPolicy?: AgentSettings["retry"]
  stages: AgentRunGraphExecutionStage[]
  task?: string
}

interface RunGraphToolResultSummaryCachedEvent {
  dependencyNodeId: string
  summary: AgentToolResultSummary
  summaryCacheId: string
}

export interface InstantiateAgentRunGraphTemplateOptions {
  chatSessionId: string
  db: AppDatabase
  modelId?: string | null
  task?: string
  templateId: AgentRunGraphTemplateId | string
}

export interface AgentRunGraphInstance {
  plan: AgentRunGraphExecutionPlan
  rootRun: AgentRun
}

export interface GetAgentRunGraphStateOptions {
  chatSessionId?: string
  db: AppDatabase
  rootRunId: string
}

export type StartAgentRunGraphNextStageOptions = GetAgentRunGraphStateOptions

export type AdvanceAgentRunGraphOptions = GetAgentRunGraphStateOptions

export interface RetryAgentRunGraphNodeOptions extends GetAgentRunGraphStateOptions {
  automatic?: boolean
  nodeId: string
}

export interface SkipAgentRunGraphNodeOptions extends GetAgentRunGraphStateOptions {
  nodeId: string
  reason?: string
}

export interface UpdateAgentRunGraphRetryPolicyOptions extends GetAgentRunGraphStateOptions {
  retryPolicy: AgentSettings["retry"]
}

export interface ExecuteAgentRunGraphNodeOptions extends GetAgentRunGraphStateOptions {
  abortSignal?: AbortSignal
  initialMessages?: readonly AgentLoopMessage[]
  maxTurns?: number
  model: AgentLoopModel
  nodeId?: string
  toolNeedsApproval?: (
    toolCall: AgentLoopToolCall,
    context: {
      messages: readonly AgentLoopMessage[]
    }
  ) => boolean | Promise<boolean>
  resources?: AgentLoopResources
  thinkingLevel?: string
  toolResultSummaryProcessor?: AgentToolResultSummaryProcessor
  tools?: Readonly<Record<string, AgentLoopTool>>
}

export interface ExecuteAgentRunGraphNodeWithAiSdkOptions extends Omit<
  ExecuteAgentRunGraphNodeOptions,
  "model" | "toolNeedsApproval" | "tools"
> {
  headers?: Readonly<Record<string, string>>
  memorySettings?: MemorySettings
  metadata?: Readonly<Record<string, unknown>>
  model: LanguageModel
  projectPath: string
  resolveModel?: (modelId?: string) => LanguageModel
  skillCapabilities?: readonly string[]
  systemPrompts?: readonly string[]
}

export interface RunAgentRunGraphUntilIdleWithAiSdkOptions extends Omit<
  ExecuteAgentRunGraphNodeWithAiSdkOptions,
  "nodeId"
> {
  maxIterations?: number
}

export interface ResumeAgentRunGraphNodeApprovalWithAiSdkOptions extends Omit<
  ExecuteAgentRunGraphNodeWithAiSdkOptions,
  "initialMessages" | "nodeId"
> {
  approvalId: string
  approved: boolean
  reason?: string
  toolCallId: string
}

export interface AgentRunGraphScheduleResult {
  plan: AgentRunGraphExecutionPlan
  rootRun: AgentRun
  stage: AgentRunGraphExecutionStage | null
  startedNodeIds: string[]
  startedRuns: AgentRun[]
}

export interface AgentRunGraphAdvanceResult extends AgentRunGraphScheduleResult {
  settledNodeIds: string[]
}

export interface AgentRunGraphRetryResult extends AgentRunGraphScheduleResult {
  retriedNodeId: string
}

export interface AgentRunGraphSkipResult extends AgentRunGraphScheduleResult {
  skippedNodeId: string
}

export interface AgentRunGraphRetryPolicyUpdateResult {
  plan: AgentRunGraphExecutionPlan
  retryPolicy: AgentSettings["retry"]
  rootRun: AgentRun
}

export interface AgentRunGraphNodeExecutionResult extends AgentRunGraphAdvanceResult {
  childRun: AgentRun
  nodeId: string
  stopReason: AgentLoopStopReason
  turns: number
}

export type AgentRunGraphUntilIdleStopReason =
  | "blocked"
  | "completed"
  | "iteration-limit"
  | "suspended"

export interface AgentRunGraphUntilIdleResult extends AgentRunGraphAdvanceResult {
  childRuns: AgentRun[]
  executedNodeIds: string[]
  iterations: number
  stopReason: AgentRunGraphUntilIdleStopReason
}

export type AgentRunSource =
  | "chat"
  | "delegation"
  | "run-graph"
  | "run-graph-node"

export type AgentRunStartedMetadata = Readonly<Record<string, unknown>>

export interface StartExistingAgentRunOptions {
  metadata?: AgentRunStartedMetadata
  run: AgentRun
  source: AgentRunSource
}

export interface StartNewAgentRunOptions {
  chatSessionId: string
  db: AppDatabase
  metadata?: AgentRunStartedMetadata
  modelId?: string | null
  parentRunId?: string | null
  profileId: string
  source: AgentRunSource
}

export type StartAgentRunOptions =
  | StartExistingAgentRunOptions
  | StartNewAgentRunOptions

export interface AgentKernel {
  advanceRunGraph: (
    options: AdvanceAgentRunGraphOptions
  ) => Promise<AgentRunGraphAdvanceResult>
  executeRunGraphNode: (
    options: ExecuteAgentRunGraphNodeOptions
  ) => Promise<AgentRunGraphNodeExecutionResult>
  executeRunGraphNodeWithAiSdk: (
    options: ExecuteAgentRunGraphNodeWithAiSdkOptions
  ) => Promise<AgentRunGraphNodeExecutionResult>
  getRunGraphState: (
    options: GetAgentRunGraphStateOptions
  ) => Promise<AgentRunGraphInstance>
  instantiateRunGraphTemplate: (
    options: InstantiateAgentRunGraphTemplateOptions
  ) => Promise<AgentRunGraphInstance>
  listRunGraphTemplates: () => readonly AgentRunGraphTemplate[]
  previewRunGraphTemplate: (
    templateId: AgentRunGraphTemplateId | string
  ) => AgentRunGraphExecutionPlan
  retryRunGraphNode: (
    options: RetryAgentRunGraphNodeOptions
  ) => Promise<AgentRunGraphRetryResult>
  resumeRunGraphNodeApprovalWithAiSdk: (
    options: ResumeAgentRunGraphNodeApprovalWithAiSdkOptions
  ) => Promise<AgentRunGraphNodeExecutionResult>
  runGraphUntilIdleWithAiSdk: (
    options: RunAgentRunGraphUntilIdleWithAiSdkOptions
  ) => Promise<AgentRunGraphUntilIdleResult>
  startRun: (options: StartAgentRunOptions) => Promise<AgentRun>
  skipRunGraphNode: (
    options: SkipAgentRunGraphNodeOptions
  ) => Promise<AgentRunGraphSkipResult>
  startNextRunGraphStage: (
    options: StartAgentRunGraphNextStageOptions
  ) => Promise<AgentRunGraphScheduleResult>
  updateRunGraphRetryPolicy: (
    options: UpdateAgentRunGraphRetryPolicyOptions
  ) => Promise<AgentRunGraphRetryPolicyUpdateResult>
}

const DEFAULT_RUN_GRAPH_UNTIL_IDLE_MAX_ITERATIONS = 20

const isStartExistingAgentRunOptions = (
  options: StartAgentRunOptions
): options is StartExistingAgentRunOptions => "run" in options

export const startAgentRun = async (
  options: StartAgentRunOptions
): Promise<AgentRun> => {
  const run = isStartExistingAgentRunOptions(options)
    ? options.run
    : await createAgentRun({
        chatSessionId: options.chatSessionId,
        db: options.db,
        modelId: options.modelId,
        parentRunId: options.parentRunId,
        profileId: options.profileId
      })
  const metadata = options.metadata ?? {}

  await run.appendEvent({
    payload: {
      ...metadata,
      profileId: run.profileId,
      source: options.source
    },
    type: "agent_run_started"
  })

  return run
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isAgentLoopSuccessStopReason = (
  stopReason: AgentLoopStopReason
): boolean =>
  stopReason === "final" ||
  stopReason === "max_turns" ||
  stopReason === "terminated" ||
  stopReason === "user_stopped"

const LSP_AGENT_TOOL_NAMES = new Set<AgentToolName>([
  "inspect",
  "symbolSearch",
  "symbols"
])

const canUseLspTool = (settings: AgentSettings): boolean =>
  settings.lsp.enabled && settings.sandbox.enabled

const isRunGraphDependencySatisfied = (
  status: AgentRunGraphExecutionNodeStatus | undefined
): boolean => status === "succeeded" || status === "skipped"

const normalizeRunGraphRetryPolicy = (
  retryPolicy: AgentSettings["retry"]
): AgentSettings["retry"] => ({
  maxAutomaticRetries: Math.min(
    5,
    Math.max(0, Math.round(retryPolicy.maxAutomaticRetries))
  ),
  retryTransientFailures: retryPolicy.retryTransientFailures
})

const filterUnavailableNodeToolNames = ({
  settings,
  toolNames
}: {
  settings: AgentSettings
  toolNames: AgentToolName[]
}): AgentToolName[] =>
  toolNames.filter(
    (toolName) => !LSP_AGENT_TOOL_NAMES.has(toolName) || canUseLspTool(settings)
  )

const resolveNodeToolNames = ({
  node,
  settings
}: {
  node: AgentRunGraphTemplateNode
  settings: AgentSettings
}): AgentToolName[] => {
  const profile = resolveActiveAgentProfile(settings, node.profileId)

  if (node.toolScope === "read-only") {
    return filterUnavailableNodeToolNames({
      settings,
      toolNames: compileAgentToolNames({
        allowedToolNames: profile.toolPolicy.allowedToolNames,
        restrictToSafeTools: true
      })
    })
  }

  return filterUnavailableNodeToolNames({
    settings,
    toolNames: [...profile.toolPolicy.allowedToolNames]
  })
}

const createTemplateNodeMap = (
  template: AgentRunGraphTemplate
): Map<string, AgentRunGraphTemplateNode> => {
  const nodesById = new Map<string, AgentRunGraphTemplateNode>()

  for (const node of template.nodes) {
    if (nodesById.has(node.id)) {
      throw new Error(
        `Agent graph template "${template.id}" has duplicate node "${node.id}".`
      )
    }

    nodesById.set(node.id, node)
  }

  return nodesById
}

const assertTemplateDependencies = ({
  nodesById,
  template
}: {
  nodesById: Map<string, AgentRunGraphTemplateNode>
  template: AgentRunGraphTemplate
}): void => {
  for (const node of template.nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!nodesById.has(dependencyId)) {
        throw new Error(
          `Agent graph template "${template.id}" node "${node.id}" depends on unknown node "${dependencyId}".`
        )
      }
    }
  }
}

const buildExecutionStages = (
  template: AgentRunGraphTemplate
): AgentRunGraphExecutionStage[] => {
  const scheduledNodeIds = new Set<string>()
  const stages: AgentRunGraphExecutionStage[] = []

  while (scheduledNodeIds.size < template.nodes.length) {
    const readyNodes = template.nodes.filter(
      (node) =>
        !scheduledNodeIds.has(node.id) &&
        node.dependsOn.every((dependencyId) =>
          scheduledNodeIds.has(dependencyId)
        )
    )

    if (readyNodes.length === 0) {
      throw new Error(
        `Agent graph template "${template.id}" contains a dependency cycle.`
      )
    }

    const index = stages.length
    const nodeIds = readyNodes.map((node) => node.id)

    stages.push({
      id: `stage-${index + 1}`,
      index,
      nodeIds,
      parallel: nodeIds.length > 1
    })

    for (const nodeId of nodeIds) {
      scheduledNodeIds.add(nodeId)
    }
  }

  return stages
}

const getStageByNodeId = (
  stages: readonly AgentRunGraphExecutionStage[]
): Map<string, number> => {
  const stageByNodeId = new Map<string, number>()

  for (const stage of stages) {
    for (const nodeId of stage.nodeIds) {
      stageByNodeId.set(nodeId, stage.index)
    }
  }

  return stageByNodeId
}

const createExecutionPlan = ({
  settings,
  template
}: {
  settings: AgentSettings
  template: AgentRunGraphTemplate
}): AgentRunGraphExecutionPlan => {
  const nodesById = createTemplateNodeMap(template)

  assertTemplateDependencies({
    nodesById,
    template
  })

  const stages = buildExecutionStages(template)
  const stageByNodeId = getStageByNodeId(stages)
  const nodes = template.nodes.map((node) => ({
    activeToolNames: resolveNodeToolNames({
      node,
      settings
    }),
    attempt: 0,
    dependsOn: [...node.dependsOn],
    id: node.id,
    label: node.label,
    outputContract: node.outputContract,
    ...(node.parallelGroup ? { parallelGroup: node.parallelGroup } : {}),
    profileId: node.profileId,
    role: node.role,
    stage: stageByNodeId.get(node.id) ?? 0,
    status: "pending" as const,
    toolScope: node.toolScope
  }))

  return {
    description: template.description,
    id: template.id,
    name: template.name,
    nodes,
    retryPolicy: normalizeRunGraphRetryPolicy(settings.retry),
    stages
  }
}

const getExecutionPlan = ({
  settings,
  templateId
}: {
  settings: AgentSettings
  templateId: AgentRunGraphTemplateId | string
}): AgentRunGraphExecutionPlan => {
  const template = getAgentRunGraphTemplate(templateId)

  if (!template) {
    throw new Error(`Unknown agent graph template: ${templateId}`)
  }

  return createExecutionPlan({
    settings,
    template
  })
}

const cloneExecutionPlan = (
  plan: AgentRunGraphExecutionPlan
): AgentRunGraphExecutionPlan => ({
  description: plan.description,
  id: plan.id,
  name: plan.name,
  nodes: plan.nodes.map((node) => ({
    activeToolNames: [...node.activeToolNames],
    attempt: node.attempt,
    ...(node.childRunId ? { childRunId: node.childRunId } : {}),
    dependsOn: [...node.dependsOn],
    ...(node.errorMessage ? { errorMessage: node.errorMessage } : {}),
    id: node.id,
    label: node.label,
    ...(node.lastOutput ? { lastOutput: node.lastOutput } : {}),
    outputContract: node.outputContract,
    ...(node.parallelGroup ? { parallelGroup: node.parallelGroup } : {}),
    profileId: node.profileId,
    role: node.role,
    stage: node.stage,
    status: node.status,
    toolScope: node.toolScope
  })),
  ...(plan.retryPolicy
    ? { retryPolicy: normalizeRunGraphRetryPolicy(plan.retryPolicy) }
    : {}),
  stages: plan.stages.map((stage) => ({
    id: stage.id,
    index: stage.index,
    nodeIds: [...stage.nodeIds],
    parallel: stage.parallel
  })),
  ...(plan.task ? { task: plan.task } : {})
})

const getStringPayloadValue = (
  payload: unknown,
  key: string
): string | null => {
  if (!isRecord(payload)) {
    return null
  }

  const value = payload[key]

  return typeof value === "string" ? value : null
}

const getNumberPayloadValue = (
  payload: unknown,
  key: string
): number | null => {
  if (!isRecord(payload)) {
    return null
  }

  const value = payload[key]

  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const getBooleanPayloadValue = (
  payload: unknown,
  key: string
): boolean | null => {
  if (!isRecord(payload)) {
    return null
  }

  const value = payload[key]

  return typeof value === "boolean" ? value : null
}

const getRunGraphRetryPolicyFromPayload = (
  payload: unknown
): AgentSettings["retry"] | null => {
  if (!isRecord(payload) || !isRecord(payload.retryPolicy)) {
    return null
  }

  const maxAutomaticRetries = getNumberPayloadValue(
    payload.retryPolicy,
    "maxAutomaticRetries"
  )
  const retryTransientFailures = getBooleanPayloadValue(
    payload.retryPolicy,
    "retryTransientFailures"
  )

  if (maxAutomaticRetries === null || retryTransientFailures === null) {
    return null
  }

  return normalizeRunGraphRetryPolicy({
    maxAutomaticRetries,
    retryTransientFailures
  })
}

const getGraphPlanFromInstantiationPayload = (
  payload: unknown
): AgentRunGraphExecutionPlan | null => {
  if (!isRecord(payload)) {
    return null
  }

  const { plan } = payload

  if (!isRecord(plan) || typeof plan.id !== "string") {
    return null
  }

  return cloneExecutionPlan(plan as unknown as AgentRunGraphExecutionPlan)
}

const setNodeState = ({
  attempt,
  childRunId,
  errorMessage,
  lastOutput,
  nodeId,
  plan,
  status,
  updateErrorMessage = false,
  updateLastOutput = false
}: {
  attempt?: number | null
  childRunId?: string | null
  errorMessage?: string | null
  lastOutput?: string | null
  nodeId: string
  plan: AgentRunGraphExecutionPlan
  status: AgentRunGraphExecutionNodeStatus
  updateErrorMessage?: boolean
  updateLastOutput?: boolean
}): void => {
  const node = plan.nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return
  }

  node.status = status

  if (typeof attempt === "number") {
    node.attempt = attempt
  }

  if (childRunId) {
    node.childRunId = childRunId
  }

  if (updateErrorMessage) {
    if (errorMessage) {
      node.errorMessage = errorMessage
    } else {
      delete node.errorMessage
    }
  }

  if (updateLastOutput) {
    if (lastOutput) {
      node.lastOutput = lastOutput
    } else {
      delete node.lastOutput
    }
  }
}

const getRunGraphPlanFromEvents = (
  events: Awaited<ReturnType<typeof listAgentEvents>>
): AgentRunGraphExecutionPlan => {
  let plan: AgentRunGraphExecutionPlan | null = null

  for (const event of events) {
    if (
      event.type === "agent_run_graph_instantiated" ||
      event.type === "agent_run_graph_checkpoint_created"
    ) {
      plan = getGraphPlanFromInstantiationPayload(event.payload)
      continue
    }

    if (!plan) {
      continue
    }

    if (event.type === "agent_run_graph_retry_policy_updated") {
      const retryPolicy = getRunGraphRetryPolicyFromPayload(event.payload)

      if (retryPolicy) {
        plan.retryPolicy = retryPolicy
      }

      continue
    }

    const nodeId = getStringPayloadValue(event.payload, "nodeId")

    if (!nodeId) {
      continue
    }

    if (event.type === "agent_run_graph_node_retrying") {
      setNodeState({
        errorMessage: getStringPayloadValue(event.payload, "errorMessage"),
        childRunId: getStringPayloadValue(event.payload, "childRunId"),
        nodeId,
        plan,
        status: "pending",
        updateErrorMessage: true
      })
      continue
    }

    if (event.type === "agent_run_graph_node_started") {
      setNodeState({
        attempt: getNumberPayloadValue(event.payload, "attempt"),
        childRunId: getStringPayloadValue(event.payload, "childRunId"),
        nodeId,
        plan,
        status: "running"
      })
      continue
    }

    if (event.type === "agent_run_graph_node_suspended") {
      setNodeState({
        childRunId: getStringPayloadValue(event.payload, "childRunId"),
        nodeId,
        plan,
        status: "suspended"
      })
      continue
    }

    if (event.type === "agent_run_graph_node_resumed") {
      setNodeState({
        childRunId: getStringPayloadValue(event.payload, "childRunId"),
        nodeId,
        plan,
        status: "running"
      })
      continue
    }

    if (event.type === "agent_run_graph_node_succeeded") {
      setNodeState({
        errorMessage: null,
        lastOutput: getStringPayloadValue(event.payload, "output"),
        nodeId,
        plan,
        status: "succeeded",
        updateErrorMessage: true,
        updateLastOutput: true
      })
      continue
    }

    if (event.type === "agent_run_graph_node_failed") {
      setNodeState({
        errorMessage: getStringPayloadValue(event.payload, "errorMessage"),
        lastOutput: getStringPayloadValue(event.payload, "output"),
        nodeId,
        plan,
        status: "failed",
        updateErrorMessage: true,
        updateLastOutput: true
      })
      continue
    }

    if (event.type === "agent_run_graph_node_skipped") {
      setNodeState({
        nodeId,
        plan,
        status: "skipped"
      })
    }
  }

  if (!plan) {
    throw new Error("Agent run graph has not been instantiated.")
  }

  return plan
}

const requireRunGraphRootRun = async ({
  chatSessionId,
  db,
  rootRunId
}: GetAgentRunGraphStateOptions): Promise<AgentRun> => {
  const run = await getAgentRun({
    chatSessionId,
    db,
    runId: rootRunId
  })

  if (!run) {
    throw new Error(`Agent run graph root not found: ${rootRunId}`)
  }

  return run
}

const getRunGraphState = async ({
  chatSessionId,
  db,
  rootRunId
}: GetAgentRunGraphStateOptions): Promise<AgentRunGraphInstance> => {
  const [rootRun, events] = await Promise.all([
    requireRunGraphRootRun({
      chatSessionId,
      db,
      rootRunId
    }),
    listAgentEvents({
      db,
      runId: rootRunId
    })
  ])

  return {
    plan: getRunGraphPlanFromEvents(events),
    rootRun
  }
}

const appendRunGraphCheckpoint = async ({
  plan,
  reason,
  rootRun
}: {
  plan: AgentRunGraphExecutionPlan
  reason: string
  rootRun: AgentRun
}): Promise<void> => {
  await rootRun.appendEvent({
    payload: {
      checkpointId: randomUUID(),
      plan: cloneExecutionPlan(plan),
      reason
    },
    type: "agent_run_graph_checkpoint_created"
  })
}

const getNextReadyNodes = (
  plan: AgentRunGraphExecutionPlan
): AgentRunGraphExecutionNode[] => {
  const statusByNodeId = new Map(
    plan.nodes.map((node) => [node.id, node.status])
  )

  if (
    plan.nodes.some(
      (node) => node.status === "running" || node.status === "suspended"
    )
  ) {
    return []
  }

  const readyNodes = plan.nodes.filter(
    (node) =>
      node.status === "pending" &&
      node.dependsOn.every((dependencyId) =>
        isRunGraphDependencySatisfied(statusByNodeId.get(dependencyId))
      )
  )

  if (readyNodes.length === 0) {
    return []
  }

  const nextStage = Math.min(...readyNodes.map((node) => node.stage))

  return readyNodes.filter((node) => node.stage === nextStage)
}

const getStageForNodes = ({
  nodes,
  plan
}: {
  nodes: readonly AgentRunGraphExecutionNode[]
  plan: AgentRunGraphExecutionPlan
}): AgentRunGraphExecutionStage | null => {
  const [firstNode] = nodes

  if (!firstNode) {
    return null
  }

  return plan.stages.find((stage) => stage.index === firstNode.stage) ?? null
}

const getTerminalEventTypeForChildRunStatus = (status: AgentRun["status"]) => {
  if (status === "succeeded") {
    return "agent_run_graph_node_succeeded"
  }

  if (status === "failed") {
    return "agent_run_graph_node_failed"
  }

  return null
}

const getChildRunTerminalPayload = async ({
  db,
  runId,
  status
}: {
  db: AppDatabase
  runId: string
  status: AgentRun["status"]
}): Promise<{
  errorMessage: string | null
  output: string | null
}> => {
  const events = await listAgentEvents({
    db,
    runId
  })
  const terminalEvent = events.findLast(
    (event) =>
      event.type === "agent_run_finished" || event.type === "agent_run_failed"
  )
  const output = getStringPayloadValue(terminalEvent?.payload, "output")
  const errorMessage =
    getStringPayloadValue(terminalEvent?.payload, "error") ??
    getStringPayloadValue(terminalEvent?.payload, "errorMessage")

  return {
    errorMessage: status === "failed" ? errorMessage : null,
    output
  }
}

const settleFinishedRunGraphNodes = async ({
  chatSessionId,
  db,
  plan,
  rootRun
}: {
  chatSessionId?: string
  db: AppDatabase
  plan: AgentRunGraphExecutionPlan
  rootRun: AgentRun
}): Promise<string[]> => {
  const settledNodeIds: string[] = []
  const runningNodes = plan.nodes.filter(
    (node) => node.status === "running" && node.childRunId
  )

  for (const node of runningNodes) {
    if (!node.childRunId) {
      continue
    }

    const childRun = await getAgentRun({
      chatSessionId,
      db,
      runId: node.childRunId
    })

    if (!childRun || childRun.parentRunId !== rootRun.id) {
      continue
    }

    const eventType = getTerminalEventTypeForChildRunStatus(childRun.status)

    if (!eventType) {
      continue
    }

    const terminalPayload = await getChildRunTerminalPayload({
      db,
      runId: childRun.id,
      status: childRun.status
    })

    await rootRun.appendEvent({
      payload: {
        childRunId: childRun.id,
        errorMessage: terminalPayload.errorMessage ?? childRun.errorMessage,
        nodeId: node.id,
        output: terminalPayload.output,
        status: childRun.status
      },
      type: eventType
    })
    settledNodeIds.push(node.id)
  }

  return settledNodeIds
}

const startRunGraphNode = async ({
  db,
  node,
  retryOfChildRunId,
  rootRun,
  settings
}: {
  db: AppDatabase
  node: AgentRunGraphExecutionNode
  retryOfChildRunId?: string
  rootRun: AgentRun
  settings: AgentSettings
}): Promise<AgentRun> => {
  const attempt = node.attempt + 1
  const profile = resolveActiveAgentProfile(settings, node.profileId)
  const modelRoute = resolveAgentModelRoute({
    fallbackChain: [rootRun.modelId],
    profile,
    stepKind: node.role,
    userSelectedModel: rootRun.modelId
  })
  const childRun = await startAgentRun({
    chatSessionId: rootRun.chatSessionId,
    db,
    metadata: {
      activeToolNames: node.activeToolNames,
      attempt,
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      graphStage: node.stage,
      modelRoute,
      outputContract: node.outputContract,
      parentRunId: rootRun.id,
      ...(retryOfChildRunId ? { retryOfChildRunId } : {}),
      role: node.role,
      toolScope: node.toolScope
    },
    modelId: modelRoute.modelId,
    parentRunId: rootRun.id,
    profileId: node.profileId,
    source: "run-graph-node"
  })

  await rootRun.appendEvent({
    payload: {
      activeToolNames: node.activeToolNames,
      attempt,
      childRunId: childRun.id,
      modelId: modelRoute.modelId,
      modelRoute,
      nodeId: node.id,
      outputContract: node.outputContract,
      profileId: node.profileId,
      ...(retryOfChildRunId ? { retryOfChildRunId } : {}),
      role: node.role,
      stage: node.stage,
      toolScope: node.toolScope
    },
    type: "agent_run_graph_node_started"
  })

  return childRun
}

const getRunGraphToolResultSummaryCacheId = ({
  content,
  dependencyNodeId,
  rootRunId
}: {
  content: string
  dependencyNodeId: string
  rootRunId: string
}): string => {
  const contentHash = createHash("sha256").update(content).digest("hex")

  return `${rootRunId}:${dependencyNodeId}:${contentHash}`
}

const getCachedRunGraphDependencySummary = async ({
  cache,
  content,
  dependencyNodeId,
  onCached,
  rootRunId,
  toolResultSummaryProcessor
}: {
  cache: AgentToolResultSummaryCache
  content: string
  dependencyNodeId: string
  onCached?: (
    event: RunGraphToolResultSummaryCachedEvent
  ) => Promise<void> | void
  rootRunId: string
  toolResultSummaryProcessor?: AgentToolResultSummaryProcessor
}): Promise<AgentToolResultSummary> => {
  const summaryCacheId = getRunGraphToolResultSummaryCacheId({
    content,
    dependencyNodeId,
    rootRunId
  })
  const cachedSummary = cache.get(summaryCacheId)

  if (cachedSummary) {
    return cachedSummary
  }

  const summary = await cache.setWithProcessor(summaryCacheId, content, {
    processor: toolResultSummaryProcessor
  })

  await onCached?.({
    dependencyNodeId,
    summary,
    summaryCacheId
  })

  return summary
}

const getRunGraphNodePrompt = async ({
  node,
  onToolResultSummaryCached,
  plan,
  rootRunId,
  summaryCache = runGraphToolResultSummaryCache,
  toolResultSummaryProcessor
}: {
  node: AgentRunGraphExecutionNode
  onToolResultSummaryCached?: (
    event: RunGraphToolResultSummaryCachedEvent
  ) => Promise<void> | void
  plan: AgentRunGraphExecutionPlan
  rootRunId: string
  summaryCache?: AgentToolResultSummaryCache
  toolResultSummaryProcessor?: AgentToolResultSummaryProcessor
}): Promise<string> => {
  const dependencies =
    node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "none"
  const task = plan.task?.trim() || "Execute the assigned graph node."
  const dependencyOutputBlocks = []

  for (const dependencyId of node.dependsOn) {
    const dependencyNode = plan.nodes.find(
      (candidate) => candidate.id === dependencyId
    )

    if (!dependencyNode) {
      continue
    }

    if (dependencyNode.status === "skipped") {
      dependencyOutputBlocks.push(
        `Dependency ${dependencyNode.id} was skipped after failure.${
          dependencyNode.errorMessage
            ? ` Previous error: ${dependencyNode.errorMessage}`
            : ""
        }`
      )
      continue
    }

    if (!dependencyNode.lastOutput) {
      continue
    }

    const summary = await getCachedRunGraphDependencySummary({
      cache: summaryCache,
      content: dependencyNode.lastOutput,
      dependencyNodeId: dependencyNode.id,
      onCached: onToolResultSummaryCached,
      rootRunId,
      toolResultSummaryProcessor
    })
    const annotation = formatToolResultSummaryAnnotation(summary)

    dependencyOutputBlocks.push(
      `Dependency ${dependencyNode.id} output:\n${summary.content}${
        annotation ? `\n${annotation}` : ""
      }`
    )
  }

  return [
    "You are executing one node in an Etyon agent run graph.",
    `Task: ${task}`,
    `Template: ${plan.id} (${plan.name})`,
    `Node: ${node.id} (${node.label})`,
    `Role: ${node.role}`,
    `Attempt: ${Math.max(1, node.attempt)}`,
    `Dependencies: ${dependencies}`,
    node.errorMessage
      ? `Previous error for this node: ${node.errorMessage}`
      : "",
    dependencyOutputBlocks.length > 0
      ? ["Dependency outputs:", ...dependencyOutputBlocks].join("\n\n")
      : "",
    `Output contract: ${node.outputContract}`,
    "Return a concise result that satisfies the output contract."
  ]
    .filter(Boolean)
    .join("\n")
}

const getRunnableGraphNode = ({
  nodeId,
  plan
}: {
  nodeId?: string
  plan: AgentRunGraphExecutionPlan
}): AgentRunGraphExecutionNode => {
  const node = nodeId
    ? plan.nodes.find((candidate) => candidate.id === nodeId)
    : plan.nodes.find((candidate) => candidate.status === "running")

  if (!node) {
    throw new Error(
      nodeId
        ? `Agent graph node is not running or does not exist: ${nodeId}`
        : "Agent run graph has no running node to execute."
    )
  }

  if (node.status !== "running" || !node.childRunId) {
    throw new Error(`Agent graph node is not ready to execute: ${node.id}`)
  }

  return node
}

const getRunningRunGraphNode = (
  plan: AgentRunGraphExecutionPlan
): AgentRunGraphExecutionNode | null =>
  plan.nodes.find((node) => node.status === "running") ?? null

const isRunGraphCompleted = (plan: AgentRunGraphExecutionPlan): boolean =>
  plan.nodes.every(
    (node) => node.status === "succeeded" || node.status === "skipped"
  )

const hasSuspendedRunGraphNode = (plan: AgentRunGraphExecutionPlan): boolean =>
  plan.nodes.some((node) => node.status === "suspended")

const getRunGraphIdleStopReason = (
  plan: AgentRunGraphExecutionPlan
): AgentRunGraphUntilIdleStopReason => {
  if (isRunGraphCompleted(plan)) {
    return "completed"
  }

  return hasSuspendedRunGraphNode(plan) ? "suspended" : "blocked"
}

const pushUnique = <Value>(
  target: Value[],
  values: readonly Value[],
  getKey: (value: Value) => string
): void => {
  const existingKeys = new Set(target.map(getKey))

  for (const value of values) {
    const key = getKey(value)

    if (existingKeys.has(key)) {
      continue
    }

    existingKeys.add(key)
    target.push(value)
  }
}

const getLastAssistantContent = (
  messages: readonly AgentLoopMessage[]
): string => {
  const lastAssistantMessage = messages.findLast(
    (message) => message.role === "assistant"
  )

  return lastAssistantMessage?.role === "assistant"
    ? lastAssistantMessage.content
    : ""
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  isRecord(value) && Symbol.asyncIterator in value

const collectAsyncIterable = async (
  iterable: AsyncIterable<unknown>
): Promise<unknown[]> => {
  const values: unknown[] = []

  for await (const value of iterable) {
    values.push(value)
  }

  return values
}

const getToolExecutionErrorMessage = (output: unknown): string => {
  if (
    isRecord(output) &&
    typeof output.error === "string" &&
    output.error.trim()
  ) {
    return output.error
  }

  return getErrorMessage(output)
}

const createGraphToolApprovalId = (): string =>
  `graph-tool-approval-${randomUUID()}`

const createGraphApprovalModelMessages = ({
  approvalId,
  approved,
  reason,
  toolCall
}: {
  approvalId: string
  approved: boolean
  reason?: string
  toolCall: AgentLoopToolCall
}): ModelMessage[] => [
  {
    content: [
      {
        approvalId,
        input: toolCall.input,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        type: "tool-approval-request"
      }
    ],
    role: "assistant"
  } as unknown as ModelMessage,
  {
    content: [
      {
        approvalId,
        approved,
        ...(reason === undefined ? {} : { reason }),
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        type: "tool-approval-response"
      }
    ],
    role: "tool"
  } as unknown as ModelMessage
]

const getAiSdkToolNeedsApproval = async ({
  messages,
  input,
  metadata,
  toolCallId,
  toolName,
  tools
}: {
  input: unknown
  messages: readonly AgentLoopMessage[]
  metadata?: Readonly<Record<string, unknown>>
  toolCallId: string
  toolName: string
  tools: ToolSet
}): Promise<boolean> => {
  const needsApproval = tools[toolName]?.needsApproval

  if (!needsApproval) {
    return false
  }

  if (typeof needsApproval === "boolean") {
    return needsApproval
  }

  return Boolean(
    await needsApproval(input, {
      experimental_context: metadata,
      messages: convertAgentLoopMessagesToModelMessages(messages),
      toolCallId
    })
  )
}

const recordRunGraphToolCallStart = async ({
  childRun,
  db,
  node,
  rootRun,
  toolCall
}: {
  childRun: AgentRun
  db: AppDatabase
  node: AgentRunGraphExecutionNode
  rootRun: AgentRun
  toolCall: AgentLoopToolCall
}): Promise<void> => {
  await recordAgentToolCall({
    approvalState: "not_required",
    db,
    id: toolCall.toolCallId,
    input: toolCall.input,
    runId: childRun.id,
    state: "running",
    toolName: toolCall.toolName
  })
  await childRun.appendEvent({
    payload: {
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      input: toolCall.input,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName
    },
    type: "tool_call_started"
  })
}

const recordRunGraphToolCallApprovalRequest = async ({
  childRun,
  db,
  messages,
  node,
  rootRun,
  toolCall
}: {
  childRun: AgentRun
  db: AppDatabase
  messages: readonly AgentLoopMessage[]
  node: AgentRunGraphExecutionNode
  rootRun: AgentRun
  toolCall: AgentLoopToolCall
}): Promise<void> => {
  const approvalId = createGraphToolApprovalId()

  await recordAgentToolCall({
    approvalState: "pending",
    db,
    id: toolCall.toolCallId,
    input: toolCall.input,
    runId: childRun.id,
    state: "approval_requested",
    toolName: toolCall.toolName
  })
  await childRun.appendEvent({
    payload: {
      approvalId,
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      input: toolCall.input,
      messages,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName
    },
    type: "tool_call_approval_requested"
  })
  await childRun.appendEvent({
    payload: {
      approvalId,
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      messages,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName
    },
    type: "agent_run_graph_node_suspended"
  })
  await rootRun.appendEvent({
    payload: {
      approvalId,
      childRunId: childRun.id,
      nodeId: node.id,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName
    },
    type: "agent_run_graph_node_suspended"
  })
  await updateAgentRun({
    db,
    id: childRun.id,
    status: "suspended"
  })
  const { plan } = await getRunGraphState({
    chatSessionId: rootRun.chatSessionId,
    db,
    rootRunId: rootRun.id
  })

  await appendRunGraphCheckpoint({
    plan,
    reason: "node-suspended",
    rootRun
  })
}

const recordRunGraphToolCallFinish = async ({
  childRun,
  db,
  node,
  result,
  rootRun
}: {
  childRun: AgentRun
  db: AppDatabase
  node: AgentRunGraphExecutionNode
  result: AgentLoopExecutedToolResult
  rootRun: AgentRun
}): Promise<void> => {
  if (result.isError) {
    const errorMessage = getToolExecutionErrorMessage(result.output)

    await updateAgentToolCall({
      db,
      errorMessage,
      id: result.toolCall.toolCallId,
      runId: childRun.id,
      state: "failed"
    })
    await childRun.appendEvent({
      payload: {
        error: errorMessage,
        graphNodeId: node.id,
        graphRootRunId: rootRun.id,
        toolCallId: result.toolCall.toolCallId,
        toolName: result.toolCall.toolName
      },
      type: "tool_call_failed"
    })
    return
  }

  const artifacts = await recordAgentToolOutputArtifacts({
    db,
    output: result.output,
    runId: childRun.id,
    toolCallId: result.toolCall.toolCallId,
    toolName: result.toolCall.toolName
  })

  await updateAgentToolCall({
    db,
    id: result.toolCall.toolCallId,
    output: result.output,
    runId: childRun.id,
    state: "finished"
  })
  await childRun.appendEvent({
    payload: {
      ...(artifacts.length > 0
        ? { artifactIds: artifacts.map((artifact) => artifact.id) }
        : {}),
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      output: result.output,
      toolCallId: result.toolCall.toolCallId,
      toolName: result.toolCall.toolName
    },
    type: "tool_call_finished"
  })
}

const getRunGraphNodeSystemPrompt = ({
  node,
  settings,
  systemPrompts
}: {
  node: AgentRunGraphExecutionNode
  settings: AgentSettings
  systemPrompts?: readonly string[]
}): string => {
  const profile = resolveActiveAgentProfile(settings, node.profileId)

  return [
    profile.instructions,
    `Active graph node: ${node.id}`,
    `Tool scope: ${node.toolScope}`,
    ...((systemPrompts ?? []) as readonly string[])
  ]
    .filter(Boolean)
    .join("\n\n")
}

const getRunGraphNodeSettings = ({
  node,
  settings
}: {
  node: AgentRunGraphExecutionNode
  settings: AgentSettings
}): AgentSettings => {
  const profile = resolveActiveAgentProfile(settings, node.profileId)

  return {
    ...settings,
    defaultProfileId: profile.id,
    maxSteps: Math.min(settings.maxSteps, profile.budgetPolicy.maxSteps)
  }
}

const createRoutedAgentLoopModel = ({
  childRun,
  createModel,
  fallbackChain,
  graphNodeId,
  graphRootRunId,
  modelRoute,
  primaryModel,
  resolveModel
}: {
  childRun?: AgentRun | null
  createModel: (model: LanguageModel) => AgentLoopModel
  fallbackChain: readonly string[]
  graphNodeId: string
  graphRootRunId: string
  modelRoute: AgentModelRoute
  primaryModel: LanguageModel
  resolveModel?: (modelId?: string) => LanguageModel
}): AgentLoopModel => {
  const primaryLoopModel = createModel(primaryModel)

  if (!resolveModel || fallbackChain.length === 0) {
    return primaryLoopModel
  }

  return async (context) => {
    let failedModelId = modelRoute.modelId

    try {
      return await primaryLoopModel(context)
    } catch (error) {
      let lastError = error

      for (const fallbackModelId of fallbackChain) {
        await childRun?.appendEvent({
          payload: {
            error:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
            fallbackModelId,
            fromModelId: failedModelId,
            graphNodeId,
            graphRootRunId,
            modelRoute
          },
          type: "agent_model_fallback_used"
        })

        try {
          return await createModel(resolveModel(fallbackModelId))(context)
        } catch (fallbackError) {
          failedModelId = fallbackModelId
          lastError = fallbackError
        }
      }

      throw lastError
    }
  }
}

const startNextRunGraphStage = async ({
  chatSessionId,
  db,
  rootRunId,
  settings
}: StartAgentRunGraphNextStageOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphScheduleResult> => {
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const readyNodes = getNextReadyNodes(plan)
  const stage = getStageForNodes({
    nodes: readyNodes,
    plan
  })

  if (!stage || readyNodes.length === 0) {
    return {
      plan,
      rootRun,
      stage: null,
      startedNodeIds: [],
      startedRuns: []
    }
  }

  await rootRun.appendEvent({
    payload: {
      nodeIds: readyNodes.map((node) => node.id),
      stageId: stage.id,
      stageIndex: stage.index
    },
    type: "agent_run_graph_stage_started"
  })

  const startedRuns: AgentRun[] = []

  for (const node of readyNodes) {
    startedRuns.push(
      await startRunGraphNode({
        db,
        node,
        rootRun,
        settings
      })
    )
  }

  const { plan: scheduledPlan } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })

  await appendRunGraphCheckpoint({
    plan: scheduledPlan,
    reason: "stage-started",
    rootRun
  })

  return {
    plan: scheduledPlan,
    rootRun,
    stage,
    startedNodeIds: readyNodes.map((node) => node.id),
    startedRuns
  }
}

const updateRunGraphRetryPolicy = async ({
  chatSessionId,
  db,
  retryPolicy,
  rootRunId
}: UpdateAgentRunGraphRetryPolicyOptions): Promise<AgentRunGraphRetryPolicyUpdateResult> => {
  const { rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const normalizedRetryPolicy = normalizeRunGraphRetryPolicy(retryPolicy)

  await rootRun.appendEvent({
    payload: {
      retryPolicy: normalizedRetryPolicy
    },
    type: "agent_run_graph_retry_policy_updated"
  })

  const { plan } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })

  await appendRunGraphCheckpoint({
    plan,
    reason: "retry-policy-updated",
    rootRun
  })

  return {
    plan,
    retryPolicy: normalizedRetryPolicy,
    rootRun
  }
}

const advanceRunGraph = async ({
  chatSessionId,
  db,
  rootRunId,
  settings
}: AdvanceAgentRunGraphOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphAdvanceResult> => {
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const settledNodeIds = await settleFinishedRunGraphNodes({
    chatSessionId,
    db,
    plan,
    rootRun
  })
  const { plan: settledPlan } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const autoRetryNode = getAutoRetryableFailedNode({
    plan: settledPlan,
    retrySettings: settledPlan.retryPolicy ?? settings.retry,
    settledNodeIds
  })

  if (autoRetryNode) {
    const retryResult = await retryRunGraphNode({
      automatic: true,
      chatSessionId,
      db,
      nodeId: autoRetryNode.id,
      rootRunId,
      settings
    })

    return {
      ...retryResult,
      settledNodeIds
    }
  }

  const scheduleResult = await startNextRunGraphStage({
    chatSessionId,
    db,
    rootRunId,
    settings
  })

  if (settledNodeIds.length > 0 && scheduleResult.startedNodeIds.length === 0) {
    await appendRunGraphCheckpoint({
      plan: scheduleResult.plan,
      reason: "nodes-settled",
      rootRun
    })
  }

  return {
    ...scheduleResult,
    settledNodeIds
  }
}

const getAutoRetryableFailedNode = ({
  plan,
  retrySettings,
  settledNodeIds
}: {
  plan: AgentRunGraphExecutionPlan
  retrySettings: AgentSettings["retry"]
  settledNodeIds: readonly string[]
}): AgentRunGraphExecutionNode | null => {
  const settledNodeIdSet = new Set(settledNodeIds)

  return (
    plan.nodes.find(
      (node) =>
        settledNodeIdSet.has(node.id) &&
        node.status === "failed" &&
        node.toolScope === "read-only" &&
        node.activeToolNames.every(isAgentToolAutoRetrySafe) &&
        retrySettings.retryTransientFailures &&
        node.attempt <= retrySettings.maxAutomaticRetries &&
        Boolean(node.errorMessage) &&
        isRetryableAgentFailure(node.errorMessage ?? "")
    ) ?? null
  )
}

const retryRunGraphNode = async ({
  automatic = false,
  chatSessionId,
  db,
  nodeId,
  rootRunId,
  settings
}: RetryAgentRunGraphNodeOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphRetryResult> => {
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const node = plan.nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    throw new Error(`Agent graph node does not exist: ${nodeId}`)
  }

  if (node.status !== "failed") {
    throw new Error(`Agent graph node is not failed: ${nodeId}`)
  }

  const statusByNodeId = new Map(
    plan.nodes.map((candidate) => [candidate.id, candidate.status])
  )

  if (
    node.dependsOn.some(
      (dependencyId) =>
        !isRunGraphDependencySatisfied(statusByNodeId.get(dependencyId))
    )
  ) {
    throw new Error(
      `Agent graph node dependencies are not satisfied for retry: ${nodeId}`
    )
  }

  await rootRun.appendEvent({
    payload: {
      automatic,
      attempt: node.attempt + 1,
      childRunId: node.childRunId,
      errorMessage: node.errorMessage,
      nodeId: node.id
    },
    type: "agent_run_graph_node_retrying"
  })

  const retryRun = await startRunGraphNode({
    db,
    node,
    retryOfChildRunId: node.childRunId,
    rootRun,
    settings
  })
  const { plan: retriedPlan } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })

  await appendRunGraphCheckpoint({
    plan: retriedPlan,
    reason: "node-retried",
    rootRun
  })

  const stage =
    retriedPlan.stages.find((candidate) => candidate.index === node.stage) ??
    null

  return {
    plan: retriedPlan,
    retriedNodeId: node.id,
    rootRun,
    stage,
    startedNodeIds: [node.id],
    startedRuns: [retryRun]
  }
}

const skipRunGraphNode = async ({
  chatSessionId,
  db,
  nodeId,
  reason,
  rootRunId,
  settings
}: SkipAgentRunGraphNodeOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphSkipResult> => {
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const node = plan.nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    throw new Error(`Agent graph node does not exist: ${nodeId}`)
  }

  if (node.status !== "failed") {
    throw new Error(`Agent graph node is not failed: ${nodeId}`)
  }

  if (getRunningRunGraphNode(plan) || hasSuspendedRunGraphNode(plan)) {
    throw new Error(
      `Agent graph node cannot be skipped while the graph has active nodes: ${nodeId}`
    )
  }

  const trimmedReason = reason?.trim()

  await rootRun.appendEvent({
    payload: {
      nodeId: node.id,
      ...(node.childRunId ? { childRunId: node.childRunId } : {}),
      ...(node.errorMessage ? { errorMessage: node.errorMessage } : {}),
      ...(trimmedReason ? { reason: trimmedReason } : {})
    },
    type: "agent_run_graph_node_skipped"
  })

  const { plan: skippedPlan } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })

  await appendRunGraphCheckpoint({
    plan: skippedPlan,
    reason: "node-skipped",
    rootRun
  })

  const scheduleResult = await startNextRunGraphStage({
    chatSessionId,
    db,
    rootRunId,
    settings
  })

  return {
    ...scheduleResult,
    skippedNodeId: node.id
  }
}

interface SuspendedGraphToolCall {
  messages: AgentLoopMessage[]
  toolCall: AgentLoopToolCall
}

const isAgentLoopMessage = (value: unknown): value is AgentLoopMessage => {
  if (!isRecord(value) || typeof value.role !== "string") {
    return false
  }

  if (value.role === "assistant") {
    return Array.isArray(value.toolCalls) && typeof value.content === "string"
  }

  if (value.role === "tool") {
    return (
      typeof value.toolCallId === "string" && typeof value.toolName === "string"
    )
  }

  return value.role === "system" || value.role === "user"
}

const getSuspendedGraphToolCall = async ({
  approvalId,
  db,
  runId,
  toolCallId
}: {
  approvalId: string
  db: AppDatabase
  runId: string
  toolCallId: string
}): Promise<SuspendedGraphToolCall> => {
  const events = await listAgentEvents({
    db,
    runId
  })
  const approvalEvent = events.findLast((event) => {
    if (event.type !== "tool_call_approval_requested") {
      return false
    }

    return (
      getStringPayloadValue(event.payload, "approvalId") === approvalId &&
      getStringPayloadValue(event.payload, "toolCallId") === toolCallId
    )
  })

  if (!approvalEvent || !isRecord(approvalEvent.payload)) {
    throw new Error(`Graph approval request not found: ${approvalId}`)
  }

  const { messages } = approvalEvent.payload
  const toolName = getStringPayloadValue(approvalEvent.payload, "toolName")

  if (!Array.isArray(messages) || !messages.every(isAgentLoopMessage)) {
    throw new Error(
      `Graph approval request has no resumable context: ${approvalId}`
    )
  }

  const assistantMessage = messages.findLast(
    (message): message is Extract<AgentLoopMessage, { role: "assistant" }> =>
      message.role === "assistant"
  )
  const assistantToolCall = assistantMessage?.toolCalls.find(
    (candidate) => candidate.toolCallId === toolCallId
  )

  if (!assistantToolCall) {
    throw new Error(`Graph approval request has no tool call: ${toolCallId}`)
  }

  return {
    messages: [...messages],
    toolCall: {
      ...assistantToolCall,
      ...(toolName ? { toolName } : {})
    }
  }
}

const executeApprovedAiSdkGraphTool = async ({
  abortSignal,
  approvalId,
  metadata,
  messages,
  reason,
  toolCall,
  tools
}: {
  abortSignal?: AbortSignal
  approvalId: string
  metadata?: Readonly<Record<string, unknown>>
  messages: readonly AgentLoopMessage[]
  reason?: string
  toolCall: AgentLoopToolCall
  tools: ToolSet
}): Promise<unknown> => {
  const execute = tools[toolCall.toolName]?.execute

  if (!execute) {
    throw new Error(`Tool is not executable: ${toolCall.toolName}`)
  }

  const output = await execute(toolCall.input, {
    abortSignal,
    experimental_context: {
      approvalId,
      approved: true,
      graphApprovalResume: true,
      ...metadata,
      ...(reason === undefined ? {} : { reason }),
      toolName: toolCall.toolName
    },
    messages: [
      ...convertAgentLoopMessagesToModelMessages(messages),
      ...createGraphApprovalModelMessages({
        approvalId,
        approved: true,
        reason,
        toolCall
      })
    ],
    toolCallId: toolCall.toolCallId
  } satisfies ToolExecutionOptions)

  return isAsyncIterable(output) ? await collectAsyncIterable(output) : output
}

const createGraphDeniedToolMessage = ({
  reason,
  toolCall
}: {
  reason?: string
  toolCall: AgentLoopToolCall
}): AgentLoopMessage => ({
  isError: true,
  output: {
    error: reason ?? "Tool approval denied."
  },
  role: "tool",
  toolCallId: toolCall.toolCallId,
  toolName: toolCall.toolName
})

const resumeRunGraphNodeApprovalWithAiSdk = async ({
  abortSignal,
  approvalId,
  approved,
  chatSessionId,
  db,
  headers,
  maxTurns,
  memorySettings,
  metadata,
  model,
  projectPath,
  reason,
  resolveModel,
  resources,
  rootRunId,
  settings,
  skillCapabilities,
  systemPrompts,
  thinkingLevel,
  toolCallId
}: ResumeAgentRunGraphNodeApprovalWithAiSdkOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphNodeExecutionResult> => {
  const childRun = await getAgentRunForToolApproval({
    approvalId,
    chatSessionId,
    db,
    pendingApprovalOnly: true,
    toolCallId
  })

  if (!childRun) {
    throw new Error(`Pending graph approval not found: ${approvalId}`)
  }

  if (childRun.parentRunId !== rootRunId) {
    throw new Error("Graph approval run is outside the requested graph.")
  }

  const { messages, toolCall } = await getSuspendedGraphToolCall({
    approvalId,
    db,
    runId: childRun.id,
    toolCallId
  })
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const node = plan.nodes.find(
    (candidate) => candidate.childRunId === childRun.id
  )

  if (!node) {
    throw new Error(`Graph node not found for approval: ${approvalId}`)
  }

  if (node.status !== "suspended") {
    throw new Error(`Graph node is not suspended: ${node.id}`)
  }

  const nodeSettings = getRunGraphNodeSettings({
    node,
    settings
  })
  const profile = resolveActiveAgentProfile(settings, node.profileId)
  const modelRoute = resolveAgentModelRoute({
    fallbackChain: [rootRun.modelId],
    profile,
    stepKind: node.role,
    userSelectedModel: rootRun.modelId
  })
  const routedModel = resolveModel
    ? resolveModel(modelRoute.modelId ?? undefined)
    : model
  const fallbackChain = getAgentModelFallbackCandidates(modelRoute)
  const tools = buildAgentTools({
    chatSessionId,
    db,
    eventSink: async (event) => {
      await childRun.appendEvent(event)
    },
    memorySettings,
    projectPath,
    settings: nodeSettings,
    skillCapabilities
  })
  const graphMetadata = {
    ...metadata,
    graphNodeId: node.id,
    graphRootRunId: rootRunId,
    modelRoute,
    profileId: node.profileId
  }
  const system = getRunGraphNodeSystemPrompt({
    node,
    settings,
    systemPrompts
  })
  const loopModel = createRoutedAgentLoopModel({
    childRun,
    createModel: (nextModel) =>
      createAiSdkAgentLoopModel({
        headers,
        metadata: graphMetadata,
        model: nextModel,
        system,
        tools
      }),
    fallbackChain,
    graphNodeId: node.id,
    graphRootRunId: rootRunId,
    modelRoute,
    primaryModel: routedModel,
    resolveModel
  })
  const errorMessage = approved ? null : (reason ?? "Tool approval denied.")

  await updateAgentToolCall({
    approvalState: approved ? "approved" : "denied",
    db,
    errorMessage,
    id: toolCallId,
    runId: childRun.id,
    state: approved ? "running" : "failed"
  })
  await childRun.appendEvent({
    payload: {
      approvalId,
      approved,
      ...(reason === undefined ? {} : { reason }),
      toolCallId,
      toolName: toolCall.toolName
    },
    type: approved ? "tool_call_approved" : "tool_call_denied"
  })
  await updateAgentRun({
    db,
    id: childRun.id,
    status: "running"
  })
  await rootRun.appendEvent({
    payload: {
      approvalId,
      approved,
      childRunId: childRun.id,
      nodeId: node.id,
      toolCallId,
      toolName: toolCall.toolName
    },
    type: "agent_run_graph_node_resumed"
  })

  const { plan: resumedPlan } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })

  await appendRunGraphCheckpoint({
    plan: resumedPlan,
    reason: "node-resumed",
    rootRun
  })

  let toolResultMessage: AgentLoopMessage

  if (approved) {
    try {
      const output = await executeApprovedAiSdkGraphTool({
        abortSignal,
        approvalId,
        messages,
        metadata: graphMetadata,
        reason,
        toolCall,
        tools
      })
      const artifacts = await recordAgentToolOutputArtifacts({
        db,
        output,
        runId: childRun.id,
        toolCallId,
        toolName: toolCall.toolName
      })

      await updateAgentToolCall({
        db,
        id: toolCallId,
        output,
        runId: childRun.id,
        state: "finished"
      })
      await childRun.appendEvent({
        payload: {
          ...(artifacts.length > 0
            ? { artifactIds: artifacts.map((artifact) => artifact.id) }
            : {}),
          graphNodeId: node.id,
          graphRootRunId: rootRun.id,
          output,
          toolCallId,
          toolName: toolCall.toolName
        },
        type: "tool_call_finished"
      })

      toolResultMessage = {
        isError: false,
        output,
        role: "tool",
        toolCallId,
        toolName: toolCall.toolName
      }
    } catch (error) {
      const toolErrorMessage = getErrorMessage(error)

      await updateAgentToolCall({
        db,
        errorMessage: toolErrorMessage,
        id: toolCallId,
        runId: childRun.id,
        state: "failed"
      })
      await childRun.appendEvent({
        payload: {
          error: toolErrorMessage,
          graphNodeId: node.id,
          graphRootRunId: rootRun.id,
          toolCallId,
          toolName: toolCall.toolName
        },
        type: "tool_call_failed"
      })

      toolResultMessage = {
        isError: true,
        output: {
          error: toolErrorMessage
        },
        role: "tool",
        toolCallId,
        toolName: toolCall.toolName
      }
    }
  } else {
    toolResultMessage = createGraphDeniedToolMessage({
      reason,
      toolCall
    })
  }

  const defaultMaxTurns = Math.min(
    nodeSettings.maxSteps,
    resolveActiveAgentProfile(settings, node.profileId).budgetPolicy.maxSteps
  )

  return await executeRunGraphNode({
    abortSignal,
    chatSessionId,
    db,
    initialMessages: [...messages, toolResultMessage],
    maxTurns: maxTurns ?? defaultMaxTurns,
    model: loopModel,
    nodeId: node.id,
    resources,
    rootRunId,
    settings,
    thinkingLevel,
    toolNeedsApproval: (nextToolCall, context) =>
      getAiSdkToolNeedsApproval({
        input: nextToolCall.input,
        messages: context.messages,
        metadata: graphMetadata,
        toolCallId: nextToolCall.toolCallId,
        toolName: nextToolCall.toolName,
        tools
      }),
    tools: createAiSdkAgentLoopTools({
      tools
    })
  })
}

const executeRunGraphNode = async ({
  abortSignal,
  chatSessionId,
  db,
  initialMessages,
  maxTurns = 1,
  model,
  nodeId,
  resources,
  rootRunId,
  settings,
  thinkingLevel,
  toolNeedsApproval,
  toolResultSummaryProcessor,
  tools = {}
}: ExecuteAgentRunGraphNodeOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphNodeExecutionResult> => {
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const node = getRunnableGraphNode({
    nodeId,
    plan
  })
  const childRun = await requireRunGraphRootRun({
    chatSessionId,
    db,
    rootRunId: node.childRunId ?? ""
  })

  if (childRun.parentRunId !== rootRun.id) {
    throw new Error(`Agent graph node child run is outside graph: ${node.id}`)
  }

  await childRun.appendEvent({
    payload: {
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      outputContract: node.outputContract
    },
    type: "agent_step_started"
  })

  const messages = initialMessages ?? [
    {
      content: await getRunGraphNodePrompt({
        node,
        onToolResultSummaryCached: async ({
          dependencyNodeId,
          summary,
          summaryCacheId
        }) => {
          await rootRun.appendEvent({
            payload: {
              dependencyNodeId,
              graphNodeId: node.id,
              graphRootRunId: rootRun.id,
              summary,
              summaryCacheId
            },
            type: "agent_tool_result_summary_cached"
          })
        },
        plan,
        rootRunId,
        toolResultSummaryProcessor
      }),
      role: "user" as const
    }
  ]

  const result = await runAgentLoop({
    abortSignal,
    activeToolNames: node.activeToolNames,
    afterToolCall: async (tool_result) => {
      await recordRunGraphToolCallFinish({
        childRun,
        db,
        node,
        result: tool_result,
        rootRun
      })

      return {}
    },
    beforeToolCall: async (toolCall, context) => {
      if (
        await toolNeedsApproval?.(toolCall, {
          messages: context.messages
        })
      ) {
        await recordRunGraphToolCallApprovalRequest({
          childRun,
          db,
          messages: context.messages,
          node,
          rootRun,
          toolCall
        })

        return {
          reason: `${toolCall.toolName} requires approval before execution.`,
          suspend: true
        }
      }

      await recordRunGraphToolCallStart({
        childRun,
        db,
        node,
        rootRun,
        toolCall
      })

      return {}
    },
    maxTurns,
    messages,
    model,
    onEvent: async (event) => {
      await childRun.appendEvent({
        payload: {
          event,
          graphNodeId: node.id,
          graphRootRunId: rootRun.id
        },
        type: "agent_loop_event"
      })
    },
    resources,
    thinkingLevel,
    toolRetry: createAgentLoopToolRetryPolicy(
      plan.retryPolicy ?? settings.retry
    ),
    tools: { ...tools }
  })
  const succeeded = isAgentLoopSuccessStopReason(result.stopReason)
  const childStatus = succeeded ? "succeeded" : "failed"

  if (result.stopReason === "suspended") {
    const suspendedChildRun =
      (await getAgentRun({
        chatSessionId,
        db,
        runId: childRun.id
      })) ?? childRun
    const { plan: suspendedPlan } = await getRunGraphState({
      chatSessionId,
      db,
      rootRunId
    })

    return {
      childRun: suspendedChildRun,
      nodeId: node.id,
      plan: suspendedPlan,
      rootRun,
      settledNodeIds: [],
      stage: null,
      startedNodeIds: [],
      startedRuns: [],
      stopReason: result.stopReason,
      turns: result.turns
    }
  }

  await childRun.appendEvent({
    payload: {
      graphNodeId: node.id,
      graphRootRunId: rootRun.id,
      output: getLastAssistantContent(result.messages),
      stopReason: result.stopReason,
      turns: result.turns
    },
    type: succeeded ? "agent_run_finished" : "agent_run_failed"
  })
  const updatedChildRun = await updateAgentRun({
    db,
    errorMessage: succeeded
      ? null
      : `Agent graph node stopped with ${result.stopReason}.`,
    id: childRun.id,
    status: childStatus
  })
  const advanced = await advanceRunGraph({
    chatSessionId,
    db,
    rootRunId,
    settings
  })

  return {
    ...advanced,
    childRun: updatedChildRun,
    nodeId: node.id,
    stopReason: result.stopReason,
    turns: result.turns
  }
}

const executeRunGraphNodeWithAiSdk = async ({
  abortSignal,
  chatSessionId,
  db,
  headers,
  maxTurns,
  memorySettings,
  metadata,
  model,
  nodeId,
  projectPath,
  resolveModel,
  resources,
  rootRunId,
  settings,
  skillCapabilities,
  systemPrompts,
  thinkingLevel
}: ExecuteAgentRunGraphNodeWithAiSdkOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphNodeExecutionResult> => {
  const { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  const node = getRunnableGraphNode({
    nodeId,
    plan
  })
  const childRun = node.childRunId
    ? await requireRunGraphRootRun({
        chatSessionId,
        db,
        rootRunId: node.childRunId
      })
    : null
  const nodeSettings = getRunGraphNodeSettings({
    node,
    settings
  })
  const profile = resolveActiveAgentProfile(settings, node.profileId)
  const modelRoute = resolveAgentModelRoute({
    fallbackChain: [rootRun.modelId],
    profile,
    stepKind: node.role,
    userSelectedModel: rootRun.modelId
  })
  const routedModel = resolveModel
    ? resolveModel(modelRoute.modelId ?? undefined)
    : model
  const fallbackChain = getAgentModelFallbackCandidates(modelRoute)
  const tools = buildAgentTools({
    chatSessionId,
    db,
    memorySettings,
    projectPath,
    settings: nodeSettings,
    skillCapabilities
  })
  const graphMetadata = {
    ...metadata,
    graphNodeId: node.id,
    graphRootRunId: rootRunId,
    modelRoute,
    profileId: node.profileId
  }
  const system = getRunGraphNodeSystemPrompt({
    node,
    settings,
    systemPrompts
  })
  const loopModel = createRoutedAgentLoopModel({
    childRun,
    createModel: (nextModel) =>
      createAiSdkAgentLoopModel({
        headers,
        metadata: graphMetadata,
        model: nextModel,
        system,
        tools
      }),
    fallbackChain,
    graphNodeId: node.id,
    graphRootRunId: rootRunId,
    modelRoute,
    primaryModel: routedModel,
    resolveModel
  })
  const defaultMaxTurns = Math.min(
    nodeSettings.maxSteps,
    resolveActiveAgentProfile(settings, node.profileId).budgetPolicy.maxSteps
  )

  return await executeRunGraphNode({
    abortSignal,
    chatSessionId,
    db,
    maxTurns: maxTurns ?? defaultMaxTurns,
    model: loopModel,
    nodeId,
    resources,
    rootRunId,
    settings,
    thinkingLevel,
    toolResultSummaryProcessor: createAiSdkToolResultSummaryProcessor({
      headers,
      metadata: graphMetadata,
      model: routedModel
    }),
    toolNeedsApproval: (toolCall, context) =>
      getAiSdkToolNeedsApproval({
        input: toolCall.input,
        messages: context.messages,
        metadata: graphMetadata,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        tools
      }),
    tools: createAiSdkAgentLoopTools({
      tools
    })
  })
}

const runGraphUntilIdleWithAiSdk = async ({
  abortSignal,
  chatSessionId,
  db,
  headers,
  maxIterations = DEFAULT_RUN_GRAPH_UNTIL_IDLE_MAX_ITERATIONS,
  maxTurns,
  memorySettings,
  metadata,
  model,
  projectPath,
  resources,
  rootRunId,
  settings,
  skillCapabilities,
  systemPrompts,
  thinkingLevel
}: RunAgentRunGraphUntilIdleWithAiSdkOptions & {
  settings: AgentSettings
}): Promise<AgentRunGraphUntilIdleResult> => {
  let { plan, rootRun } = await getRunGraphState({
    chatSessionId,
    db,
    rootRunId
  })
  let iterations = 0
  let stage: AgentRunGraphExecutionStage | null = null
  const childRuns: AgentRun[] = []
  const executedNodeIds: string[] = []
  const settledNodeIds: string[] = []
  const startedNodeIds: string[] = []
  const startedRuns: AgentRun[] = []

  while (iterations < maxIterations) {
    const advanced = await advanceRunGraph({
      chatSessionId,
      db,
      rootRunId,
      settings
    })
    const advancedPlan = advanced.plan
    const advancedRootRun = advanced.rootRun
    const advancedStage = advanced.stage

    plan = advancedPlan
    rootRun = advancedRootRun
    stage = advancedStage
    pushUnique(settledNodeIds, advanced.settledNodeIds, (nodeId) => nodeId)
    pushUnique(startedNodeIds, advanced.startedNodeIds, (nodeId) => nodeId)
    pushUnique(startedRuns, advanced.startedRuns, (run) => run.id)

    if (advanced.startedNodeIds.length > 0) {
      iterations += 1
      continue
    }

    const runningNode = getRunningRunGraphNode(plan)

    if (!runningNode) {
      return {
        childRuns,
        executedNodeIds,
        iterations,
        plan,
        rootRun,
        settledNodeIds,
        stage,
        startedNodeIds,
        startedRuns,
        stopReason: getRunGraphIdleStopReason(plan)
      }
    }

    const executed = await executeRunGraphNodeWithAiSdk({
      abortSignal,
      chatSessionId,
      db,
      headers,
      maxTurns,
      memorySettings,
      metadata,
      model,
      nodeId: runningNode.id,
      projectPath,
      resources,
      rootRunId,
      settings,
      skillCapabilities,
      systemPrompts,
      thinkingLevel
    })

    const executedPlan = executed.plan
    const executedRootRun = executed.rootRun
    const executedStage = executed.stage

    iterations += 1
    plan = executedPlan
    rootRun = executedRootRun
    stage = executedStage
    pushUnique(childRuns, [executed.childRun], (run) => run.id)
    pushUnique(executedNodeIds, [executed.nodeId], (nodeId) => nodeId)
    pushUnique(settledNodeIds, executed.settledNodeIds, (nodeId) => nodeId)
    pushUnique(startedNodeIds, executed.startedNodeIds, (nodeId) => nodeId)
    pushUnique(startedRuns, executed.startedRuns, (run) => run.id)

    if (executed.stopReason === "suspended") {
      return {
        childRuns,
        executedNodeIds,
        iterations,
        plan,
        rootRun,
        settledNodeIds,
        stage,
        startedNodeIds,
        startedRuns,
        stopReason: "suspended"
      }
    }

    const executedNode = plan.nodes.find((node) => node.id === executed.nodeId)

    if (executedNode?.status === "failed") {
      return {
        childRuns,
        executedNodeIds,
        iterations,
        plan,
        rootRun,
        settledNodeIds,
        stage,
        startedNodeIds,
        startedRuns,
        stopReason: "blocked"
      }
    }
  }

  return {
    childRuns,
    executedNodeIds,
    iterations,
    plan,
    rootRun,
    settledNodeIds,
    stage,
    startedNodeIds,
    startedRuns,
    stopReason: "iteration-limit"
  }
}

export const createAgentKernel = ({
  settings
}: {
  settings: AgentSettings
}): AgentKernel => ({
  advanceRunGraph: (options) =>
    advanceRunGraph({
      ...options,
      settings
    }),
  executeRunGraphNode: (options) =>
    executeRunGraphNode({
      ...options,
      settings
    }),
  executeRunGraphNodeWithAiSdk: (options) =>
    executeRunGraphNodeWithAiSdk({
      ...options,
      settings
    }),
  getRunGraphState,
  instantiateRunGraphTemplate: async ({
    chatSessionId,
    db,
    modelId = null,
    task,
    templateId
  }) => {
    const basePlan = getExecutionPlan({
      settings,
      templateId
    })
    const normalizedTask = task?.trim()
    const plan: AgentRunGraphExecutionPlan = {
      ...basePlan,
      ...(normalizedTask ? { task: normalizedTask } : {})
    }
    const rootRun = await startAgentRun({
      chatSessionId,
      db,
      metadata: {
        planId: plan.id,
        templateId: plan.id
      },
      modelId,
      profileId: "general-purpose",
      source: "run-graph"
    })

    await appendAgentEvent({
      db,
      payload: {
        plan,
        templateId: plan.id
      },
      runId: rootRun.id,
      type: "agent_run_graph_instantiated"
    })

    return {
      plan,
      rootRun
    }
  },
  listRunGraphTemplates: listAgentRunGraphTemplates,
  previewRunGraphTemplate: (templateId) =>
    getExecutionPlan({
      settings,
      templateId
    }),
  retryRunGraphNode: (options) =>
    retryRunGraphNode({
      ...options,
      settings
    }),
  resumeRunGraphNodeApprovalWithAiSdk: (options) =>
    resumeRunGraphNodeApprovalWithAiSdk({
      ...options,
      settings
    }),
  runGraphUntilIdleWithAiSdk: (options) =>
    runGraphUntilIdleWithAiSdk({
      ...options,
      settings
    }),
  startRun: startAgentRun,
  skipRunGraphNode: (options) =>
    skipRunGraphNode({
      ...options,
      settings
    }),
  startNextRunGraphStage: (options) =>
    startNextRunGraphStage({
      ...options,
      settings
    }),
  updateRunGraphRetryPolicy
})
