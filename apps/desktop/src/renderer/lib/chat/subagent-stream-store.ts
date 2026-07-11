import type { UIMessage } from "ai"
import { useSyncExternalStore } from "react"

import type {
  ChatSubagentApprovalData,
  ChatSubagentEndData,
  ChatSubagentEndState,
  ChatSubagentStartData
} from "@/shared/chat/stream-data"

/**
 * External store for a delegated child run's live UI, mirroring
 * `workflow-progress-store`. Three transient data parts flow through the chat
 * stream's `onData`: `subagent-start` opens a row, `subagent-chunk` carries the
 * child's forwarded `toUIMessageStream()` chunks (reduced here into renderable
 * message parts), and `subagent-end` settles it. Keyed by child run id so a
 * deeply-nested row can subscribe to only its own state; a parent index lets a
 * delegate/workflow card list every child that hangs under its tool call.
 *
 * Pure and free of `window`/rpc imports so the chunk reducer is node-testable.
 */

export type SubagentLiveStatus = "running" | ChatSubagentEndState

export interface SubagentLiveState {
  activity?: string
  /** Internal: chunk id / tool-call id → index into `parts`. */
  blockIndexById: Record<string, number>
  childRunId: string
  durationMs?: number
  errorMessage?: string
  meta: ChatSubagentStartData
  parts: UIMessage["parts"]
  startedAtMs: number
  status: SubagentLiveStatus
}

export interface SubagentPartsAcc {
  activity?: string
  blockIndexById: Record<string, number>
  parts: UIMessage["parts"]
}

type MutablePart = Record<string, unknown> & { type: string }

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null

const getString = (
  record: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = record[key]

  return typeof value === "string" ? value : undefined
}

/** Compact, code-ish activity label from a tool call (untranslated by design). */
const describeToolActivity = (
  toolName: string,
  input: unknown
): string | undefined => {
  const record = asRecord(input)
  const subject =
    record &&
    (getString(record, "path") ??
      getString(record, "pattern") ??
      getString(record, "glob"))

  return subject ? `${toolName} ${subject}` : toolName
}

type BlockIndex = Record<string, number>

const openTextBlock = (
  parts: MutablePart[],
  blockIndexById: BlockIndex,
  kind: "reasoning" | "text",
  id: unknown
): number => {
  const key = typeof id === "string" ? id : `${kind}:auto`
  const existing = blockIndexById[key]

  if (existing !== undefined) {
    return existing
  }

  parts.push({ state: "streaming", text: "", type: kind })
  const index = parts.length - 1
  blockIndexById[key] = index

  return index
}

const appendDelta = (
  parts: MutablePart[],
  index: number,
  delta: unknown
): void => {
  const part = parts[index]

  if (typeof delta === "string" && part) {
    parts[index] = { ...part, text: `${String(part.text ?? "")}${delta}` }
  }
}

const closeTextBlock = (
  parts: MutablePart[],
  blockIndexById: BlockIndex,
  kind: "reasoning" | "text",
  id: unknown
): void => {
  const key = typeof id === "string" ? id : `${kind}:auto`
  const index = blockIndexById[key]
  const part = index === undefined ? undefined : parts[index]

  if (index !== undefined && part) {
    parts[index] = { ...part, state: "done" }
  }
}

const upsertToolPart = (
  parts: MutablePart[],
  blockIndexById: BlockIndex,
  toolCallId: string,
  patch: Record<string, unknown>,
  toolName?: string
): void => {
  const existing = blockIndexById[toolCallId]

  if (existing === undefined) {
    parts.push({
      toolCallId,
      type: toolName ? `tool-${toolName}` : "dynamic-tool",
      ...(toolName ? {} : { toolName: "tool" }),
      ...patch
    })
    blockIndexById[toolCallId] = parts.length - 1

    return
  }

  const part = parts[existing]

  if (part) {
    parts[existing] = { ...part, ...patch }
  }
}

// text-* / reasoning-* share one lifecycle: kind from the prefix, action from
// the suffix, so the six chunk types collapse to three branches.
const applyTextChunk = (
  parts: MutablePart[],
  blockIndexById: BlockIndex,
  chunk: Record<string, unknown>
): void => {
  const type = chunk.type as string
  const kind: "reasoning" | "text" = type.startsWith("reasoning")
    ? "reasoning"
    : "text"

  if (type.endsWith("-delta")) {
    appendDelta(
      parts,
      openTextBlock(parts, blockIndexById, kind, chunk.id),
      chunk.delta
    )
  } else if (type.endsWith("-end")) {
    closeTextBlock(parts, blockIndexById, kind, chunk.id)
  } else {
    openTextBlock(parts, blockIndexById, kind, chunk.id)
  }
}

// Returns the activity label this tool chunk implies, or undefined to keep the
// previous one.
const applyToolChunk = (
  parts: MutablePart[],
  blockIndexById: BlockIndex,
  chunk: Record<string, unknown>
): string | undefined => {
  const { toolCallId } = chunk

  if (typeof toolCallId !== "string") {
    return undefined
  }

  const toolName =
    typeof chunk.toolName === "string" ? chunk.toolName : undefined

  switch (chunk.type) {
    case "tool-input-available": {
      upsertToolPart(
        parts,
        blockIndexById,
        toolCallId,
        { input: chunk.input, state: "input-available" },
        toolName
      )

      return describeToolActivity(toolName ?? "tool", chunk.input)
    }
    case "tool-input-start": {
      upsertToolPart(
        parts,
        blockIndexById,
        toolCallId,
        { state: "input-streaming" },
        toolName
      )

      return toolName
    }
    case "tool-output-available": {
      upsertToolPart(parts, blockIndexById, toolCallId, {
        output: chunk.output,
        state: "output-available"
      })

      return undefined
    }
    case "tool-output-error": {
      upsertToolPart(parts, blockIndexById, toolCallId, {
        errorText:
          typeof chunk.errorText === "string" ? chunk.errorText : "error",
        state: "output-error"
      })

      return undefined
    }
    default: {
      return undefined
    }
  }
}

/**
 * Folds one forwarded child chunk into the accumulated message parts. Covers the
 * text, reasoning, and tool lifecycles the read-only child emits; unknown chunk
 * types (start/finish/step markers, sources, files) are ignored.
 */
export const reduceSubagentChunk = (
  acc: SubagentPartsAcc,
  chunkValue: unknown
): SubagentPartsAcc => {
  const chunk = asRecord(chunkValue)

  if (!chunk || typeof chunk.type !== "string") {
    return acc
  }

  const isTextChunk =
    chunk.type.startsWith("text-") || chunk.type.startsWith("reasoning-")
  const isToolChunk = chunk.type.startsWith("tool-")

  if (!(isTextChunk || isToolChunk)) {
    return acc
  }

  const parts = [...acc.parts] as MutablePart[]
  const blockIndexById = { ...acc.blockIndexById }
  let { activity } = acc

  if (isTextChunk) {
    applyTextChunk(parts, blockIndexById, chunk)
  } else {
    activity = applyToolChunk(parts, blockIndexById, chunk) ?? activity
  }

  return {
    ...(activity === undefined ? {} : { activity }),
    blockIndexById,
    parts: parts as UIMessage["parts"]
  }
}

const liveByChild = new Map<string, SubagentLiveState>()
const listeners = new Set<() => void>()
const EMPTY_IDS: string[] = []
const EMPTY_APPROVALS: ChatSubagentApprovalData[] = []
// childRunId → (approvalId → its pending prompt). A resolved part removes the
// entry; the child is dropped once it has no pending approvals left.
const approvalsByChild = new Map<
  string,
  Map<string, ChatSubagentApprovalData>
>()
let childApprovalsCache = new Map<string, ChatSubagentApprovalData[]>()
// Parent tool-call id → its child run ids. Rebuilt on every mutation but each
// entry keeps its prior array reference while membership is unchanged, so a
// parent card only re-renders when a child is added/removed — per-chunk updates
// reach just the one row subscribed via `useSubagentLive`.
let parentChildIdsCache = new Map<string, string[]>()

const sameOrder = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

const rebuildParentIndex = (): void => {
  const grouped = new Map<string, string[]>()

  for (const state of liveByChild.values()) {
    const key = state.meta.parentToolCallId

    if (key === undefined) {
      continue
    }

    const list = grouped.get(key)

    if (list) {
      list.push(state.childRunId)
    } else {
      grouped.set(key, [state.childRunId])
    }
  }

  const next = new Map<string, string[]>()

  for (const [key, ids] of grouped) {
    const previous = parentChildIdsCache.get(key)

    next.set(key, previous && sameOrder(previous, ids) ? previous : ids)
  }

  parentChildIdsCache = next
}

const sameApprovals = (
  a: ChatSubagentApprovalData[],
  b: ChatSubagentApprovalData[]
): boolean =>
  a.length === b.length &&
  a.every(
    (value, index) =>
      value.approvalId === b[index]?.approvalId &&
      value.resolved === b[index]?.resolved
  )

// Rebuilds the per-child approval arrays, keeping a child's prior array reference
// while its pending set is unchanged so a row only re-renders when an approval
// appears or resolves.
const rebuildApprovalsIndex = (): void => {
  const next = new Map<string, ChatSubagentApprovalData[]>()

  for (const [childRunId, childMap] of approvalsByChild) {
    const approvals = [...childMap.values()]
    const previous = childApprovalsCache.get(childRunId)

    next.set(
      childRunId,
      previous && sameApprovals(previous, approvals) ? previous : approvals
    )
  }

  childApprovalsCache = next
}

const commit = (): void => {
  rebuildParentIndex()
  rebuildApprovalsIndex()

  for (const listener of listeners) {
    listener()
  }
}

const placeholder = (childRunId: string): SubagentLiveState => ({
  blockIndexById: {},
  childRunId,
  meta: { childRunId, profileId: "", task: "" },
  parts: [],
  startedAtMs: Date.now(),
  status: "running"
})

export const setSubagentStart = (data: ChatSubagentStartData): void => {
  const previous = liveByChild.get(data.childRunId)

  liveByChild.set(data.childRunId, {
    ...(previous ?? placeholder(data.childRunId)),
    meta: data
  })
  commit()
}

export const applySubagentChunk = (
  childRunId: string,
  chunk: unknown
): void => {
  const base = liveByChild.get(childRunId) ?? placeholder(childRunId)
  const reduced = reduceSubagentChunk(
    {
      ...(base.activity === undefined ? {} : { activity: base.activity }),
      blockIndexById: base.blockIndexById,
      parts: base.parts
    },
    chunk
  )

  liveByChild.set(childRunId, {
    ...base,
    ...(reduced.activity === undefined ? {} : { activity: reduced.activity }),
    blockIndexById: reduced.blockIndexById,
    parts: reduced.parts
  })
  commit()
}

export const setSubagentEnd = (data: ChatSubagentEndData): void => {
  const base = liveByChild.get(data.childRunId) ?? placeholder(data.childRunId)

  liveByChild.set(data.childRunId, {
    ...base,
    durationMs: data.durationMs,
    ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
    status: data.state
  })
  commit()
}

/**
 * Records a writable child's approval prompt. The first (unresolved) part opens
 * the buttons; the follow-up part carrying `resolved` (same approvalId) drops
 * them once the user, an abort, or a timeout answered.
 */
export const applySubagentApproval = (data: ChatSubagentApprovalData): void => {
  const childMap =
    approvalsByChild.get(data.childRunId) ??
    new Map<string, ChatSubagentApprovalData>()

  if (data.resolved) {
    childMap.delete(data.approvalId)
  } else {
    childMap.set(data.approvalId, data)
  }

  if (childMap.size === 0) {
    approvalsByChild.delete(data.childRunId)
  } else {
    approvalsByChild.set(data.childRunId, childMap)
  }

  commit()
}

/** Drops all live subagent state, e.g. once a turn finishes and ticks go stale. */
export const clearSubagents = (): void => {
  if (liveByChild.size === 0 && approvalsByChild.size === 0) {
    return
  }

  liveByChild.clear()
  approvalsByChild.clear()
  commit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Live state for one child run, or undefined if none has arrived. */
export const useSubagentLive = (
  childRunId: string
): SubagentLiveState | undefined => {
  const getSnapshot = (): SubagentLiveState | undefined =>
    liveByChild.get(childRunId)

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Child run ids hanging under one delegate/workflow tool call, in start order.
 * The array reference is stable while membership is unchanged, so a subscribing
 * parent card re-renders only when a child appears or disappears — each child's
 * live ticks are consumed by its own `useSubagentLive` row.
 */
export const useSubagentChildIds = (parentToolCallId: string): string[] => {
  const getSnapshot = (): string[] =>
    parentChildIdsCache.get(parentToolCallId) ?? EMPTY_IDS

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Non-hook snapshot of one child's pending approvals (exported for testing). */
export const getSubagentApprovalsSnapshot = (
  childRunId: string
): ChatSubagentApprovalData[] =>
  childApprovalsCache.get(childRunId) ?? EMPTY_APPROVALS

/** Non-hook snapshot of whether any child awaits approval (exported for testing). */
export const getHasSubagentApprovalPendingSnapshot = (): boolean =>
  approvalsByChild.size > 0

/** Pending approval prompts for one child run, in arrival order. */
export const useSubagentApprovals = (
  childRunId: string
): ChatSubagentApprovalData[] => {
  const getSnapshot = (): ChatSubagentApprovalData[] =>
    getSubagentApprovalsSnapshot(childRunId)

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Whether any live child anywhere is awaiting an approval decision. Folded into
 * the active turn's work-section header so it surfaces "Waiting for approval…". */
export const useHasSubagentApprovalPending = (): boolean =>
  useSyncExternalStore(
    subscribe,
    getHasSubagentApprovalPendingSnapshot,
    getHasSubagentApprovalPendingSnapshot
  )
