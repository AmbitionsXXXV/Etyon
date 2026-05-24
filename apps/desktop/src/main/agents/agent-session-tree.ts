import type {
  AgentCustomMessage,
  AgentMessage
} from "@/main/agents/agent-messages"

export type AgentSessionTreeEntryType =
  | "branch_summary"
  | "compaction_summary"
  | "custom_message"
  | "leaf"
  | "message"

export interface AgentSessionTreeEntryBase {
  id: string
  parentId: null | string
  sequence: number
  type: AgentSessionTreeEntryType
}

export interface AgentSessionMessageEntry extends AgentSessionTreeEntryBase {
  message: AgentMessage
  type: "message"
}

export interface AgentSessionLeafEntry extends AgentSessionTreeEntryBase {
  targetEntryId: null | string
  type: "leaf"
}

export interface AgentSessionBranchSummaryEntry extends AgentSessionTreeEntryBase {
  summary: string
  type: "branch_summary"
}

export interface AgentSessionCompactionSummaryEntry extends AgentSessionTreeEntryBase {
  summary: string
  type: "compaction_summary"
}

export interface AgentSessionCustomMessageEntry extends AgentSessionTreeEntryBase {
  message: AgentCustomMessage
  type: "custom_message"
}

export type AgentSessionTreeEntry =
  | AgentSessionBranchSummaryEntry
  | AgentSessionCompactionSummaryEntry
  | AgentSessionCustomMessageEntry
  | AgentSessionLeafEntry
  | AgentSessionMessageEntry

export interface AgentSessionTree {
  appendCompactionSummary: (
    summary: string
  ) => AgentSessionCompactionSummaryEntry
  appendCustomMessage: (
    message: AgentCustomMessage
  ) => AgentSessionCustomMessageEntry
  appendMessage: (message: AgentMessage) => AgentSessionMessageEntry
  buildContext: () => AgentMessage[]
  getLeafEntryId: () => null | string
  listEntries: () => AgentSessionTreeEntry[]
  moveTo: (
    entryId: null | string,
    branchSummary?: string
  ) => AgentSessionBranchSummaryEntry | AgentSessionLeafEntry
}

const createEntryId = (sequence: number): string => `entry-${sequence}`

const createSummaryMessage = ({
  label,
  summary
}: {
  label: string
  summary: string
}): AgentMessage => ({
  content: `${label}:\n${summary}`,
  role: "system",
  type: "model"
})

export const createAgentSessionTree = (): AgentSessionTree => {
  const entries: AgentSessionTreeEntry[] = []
  const entriesById = new Map<string, AgentSessionTreeEntry>()
  let leafEntryId: null | string = null

  const appendEntry = <TEntry extends AgentSessionTreeEntry>(
    entry: Omit<TEntry, "id" | "sequence">
  ): TEntry => {
    const sequence = entries.length + 1
    const nextEntry = {
      ...entry,
      id: createEntryId(sequence),
      sequence
    } as TEntry

    entries.push(nextEntry)
    entriesById.set(nextEntry.id, nextEntry)

    return nextEntry
  }

  const appendLeafEntry = (parentId: null | string): AgentSessionLeafEntry =>
    appendEntry<AgentSessionLeafEntry>({
      parentId,
      targetEntryId: leafEntryId,
      type: "leaf"
    })

  const getLeafPath = (): AgentSessionTreeEntry[] => {
    const path: AgentSessionTreeEntry[] = []
    let currentEntryId = leafEntryId

    while (currentEntryId) {
      const entry = entriesById.get(currentEntryId)

      if (!entry) {
        break
      }

      path.push(entry)
      currentEntryId = entry.parentId
    }

    return path.toReversed()
  }

  const buildContextFromPath = (
    path: AgentSessionTreeEntry[]
  ): AgentMessage[] => {
    const context: AgentMessage[] = []

    for (const entry of path) {
      if (entry.type === "message") {
        context.push(entry.message)
      }

      if (entry.type === "branch_summary") {
        context.push(
          createSummaryMessage({
            label: "Branch summary",
            summary: entry.summary
          })
        )
      }

      if (entry.type === "compaction_summary") {
        context.splice(
          0,
          context.length,
          createSummaryMessage({
            label: "Compaction summary",
            summary: entry.summary
          })
        )
      }
    }

    return context
  }

  return {
    appendCompactionSummary: (summary) => {
      const entry = appendEntry<AgentSessionCompactionSummaryEntry>({
        parentId: leafEntryId,
        summary,
        type: "compaction_summary"
      })
      leafEntryId = entry.id
      appendLeafEntry(entry.parentId)

      return entry
    },
    appendCustomMessage: (message) => {
      const entry = appendEntry<AgentSessionCustomMessageEntry>({
        message,
        parentId: leafEntryId,
        type: "custom_message"
      })
      leafEntryId = entry.id
      appendLeafEntry(entry.parentId)

      return entry
    },
    appendMessage: (message) => {
      const entry = appendEntry<AgentSessionMessageEntry>({
        message,
        parentId: leafEntryId,
        type: "message"
      })
      leafEntryId = entry.id
      appendLeafEntry(entry.parentId)

      return entry
    },
    buildContext: () => buildContextFromPath(getLeafPath()),
    getLeafEntryId: () => leafEntryId,
    listEntries: () => [...entries],
    moveTo: (entryId, branchSummary) => {
      if (entryId !== null && !entriesById.has(entryId)) {
        throw new Error(`Unknown agent session tree entry: ${entryId}`)
      }

      leafEntryId = entryId

      if (branchSummary) {
        const entry = appendEntry<AgentSessionBranchSummaryEntry>({
          parentId: leafEntryId,
          summary: branchSummary,
          type: "branch_summary"
        })
        leafEntryId = entry.id
        appendLeafEntry(entry.parentId)

        return entry
      }

      return appendLeafEntry(entryId)
    }
  }
}
