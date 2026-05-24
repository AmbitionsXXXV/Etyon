import type { InspectAgentRunOutput } from "@etyon/rpc"

export interface AgentRunTracePreviewItem {
  detail: string
  id: string
  label: string
}

export interface AgentRunTracePreview {
  eventCount: number
  events: AgentRunTracePreviewItem[]
  profileId: string
  status: InspectAgentRunOutput["run"]["status"]
  toolCallCount: number
  toolCalls: AgentRunTracePreviewItem[]
}

export interface AgentRunGraphPreviewNode {
  depth: number
  eventCount: number
  id: string
  parentRunId: string | null
  profileId: string
  status: InspectAgentRunOutput["run"]["status"]
  toolCallCount: number
}

export interface AgentRunGraphPreviewEdge {
  childRunId: string
  parentRunId: string
}

export interface AgentRunGraphPreview {
  edges: AgentRunGraphPreviewEdge[]
  nodes: AgentRunGraphPreviewNode[]
}

export interface AgentRunGraphPreviewDisplayNode {
  depth: number
  detailItems: string[]
  id: string
  label: string
  parentRunId: string | null
}

export interface AgentRunGraphPreviewDisplayEdge {
  childRunId: string
  id: string
  label: string
  parentRunId: string
}

export interface AgentRunGraphPreviewDisplay {
  edges: AgentRunGraphPreviewDisplayEdge[]
  nodes: AgentRunGraphPreviewDisplayNode[]
}

const DEFAULT_TRACE_ITEM_LIMIT = 6
const TRACE_DETAIL_MAX_LENGTH = 180

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const formatTraceDetail = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }

  if (typeof value === "string") {
    return value.slice(0, TRACE_DETAIL_MAX_LENGTH)
  }

  try {
    return JSON.stringify(value).slice(0, TRACE_DETAIL_MAX_LENGTH)
  } catch {
    return String(value).slice(0, TRACE_DETAIL_MAX_LENGTH)
  }
}

export const getAgentRunIdFromToolOutput = (output: unknown): string | null => {
  if (!isRecord(output) || typeof output.subRunId !== "string") {
    return null
  }

  const runId = output.subRunId.trim()

  return runId.length > 0 ? runId : null
}

export const buildAgentRunTracePreview = (
  trace: InspectAgentRunOutput,
  limit = DEFAULT_TRACE_ITEM_LIMIT
): AgentRunTracePreview => {
  const boundedLimit = Math.max(0, limit)
  const events = trace.events.slice(-boundedLimit).map((event) => ({
    detail: formatTraceDetail(event.payload),
    id: event.id,
    label: `#${event.sequence} ${event.type}`
  }))
  const toolCalls = trace.toolCalls.slice(-boundedLimit).map((toolCall) => ({
    detail: toolCall.state,
    id: toolCall.id,
    label: toolCall.toolName
  }))

  return {
    eventCount: trace.events.length,
    events,
    profileId: trace.run.profileId,
    status: trace.run.status,
    toolCallCount: trace.toolCalls.length,
    toolCalls
  }
}

export const buildAgentRunGraphPreview = (
  traces: readonly InspectAgentRunOutput[]
): AgentRunGraphPreview => {
  const nodeOrder = new Map<string, number>()
  const nodesById = new Map<string, AgentRunGraphPreviewNode>()

  for (const [index, trace] of traces.entries()) {
    if (nodesById.has(trace.run.id)) {
      continue
    }

    nodeOrder.set(trace.run.id, index)
    nodesById.set(trace.run.id, {
      depth: 0,
      eventCount: trace.events.length,
      id: trace.run.id,
      parentRunId: trace.run.parentRunId,
      profileId: trace.run.profileId,
      status: trace.run.status,
      toolCallCount: trace.toolCalls.length
    })
  }

  const getDepth = (
    node: AgentRunGraphPreviewNode,
    visitedIds = new Set<string>()
  ): number => {
    if (!node.parentRunId || visitedIds.has(node.id)) {
      return 0
    }

    const parentNode = nodesById.get(node.parentRunId)

    if (!parentNode) {
      return 0
    }

    visitedIds.add(node.id)

    return getDepth(parentNode, visitedIds) + 1
  }

  const nodes = [...nodesById.values()]
    .map((node) => ({
      ...node,
      depth: getDepth(node)
    }))
    .toSorted((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth
      }

      return (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
    })
  const edges = nodes
    .filter((node) => node.parentRunId !== null)
    .map((node) => ({
      childRunId: node.id,
      parentRunId: node.parentRunId ?? ""
    }))

  return {
    edges,
    nodes
  }
}

const formatCountLabel = ({
  count,
  singular
}: {
  count: number
  singular: string
}): string => `${count} ${singular}${count === 1 ? "" : "s"}`

export const buildAgentRunGraphPreviewDisplay = (
  graph: AgentRunGraphPreview
): AgentRunGraphPreviewDisplay => ({
  edges: graph.edges.map((edge) => ({
    ...edge,
    id: `${edge.parentRunId}:${edge.childRunId}`,
    label: `${edge.parentRunId} -> ${edge.childRunId}`
  })),
  nodes: graph.nodes.map((node) => ({
    depth: node.depth,
    detailItems: [
      node.status,
      formatCountLabel({
        count: node.eventCount,
        singular: "event"
      }),
      formatCountLabel({
        count: node.toolCallCount,
        singular: "tool"
      })
    ],
    id: node.id,
    label: node.profileId,
    parentRunId: node.parentRunId
  }))
})
