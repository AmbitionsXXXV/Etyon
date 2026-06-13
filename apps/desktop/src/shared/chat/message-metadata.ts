const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const parseExistingMetadata = (
  metadata: unknown
): Record<string, unknown> | undefined => {
  if (!isRecord(metadata)) {
    return undefined
  }

  return metadata
}

export const attachAgentProjectionToAssistantMessages = <
  MESSAGE extends { metadata?: unknown; role: string }
>(
  messages: MESSAGE[],
  {
    runId,
    startIndex = 0
  }: {
    runId: string
    startIndex?: number
  }
): MESSAGE[] =>
  messages.map((message, index) => {
    if (message.role !== "assistant" || index < startIndex) {
      return message
    }

    const metadata = parseExistingMetadata(message.metadata)

    return {
      ...message,
      metadata: {
        ...metadata,
        agentProjection: {
          runId,
          source: "agent_events"
        }
      }
    }
  })

/** Reads the agent run id a message was projected from, if any. */
export const getAgentProjectionRunId = (message: {
  metadata?: unknown
}): string | null => {
  const metadata = parseExistingMetadata(message.metadata)
  const agentProjection = metadata?.agentProjection

  if (!isRecord(agentProjection)) {
    return null
  }

  return typeof agentProjection.runId === "string"
    ? agentProjection.runId
    : null
}

export const attachWorkTimeToLatestAssistantMessage = <
  MESSAGE extends { metadata?: unknown; role: string }
>(
  messages: MESSAGE[],
  workTimeMs: number
): MESSAGE[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message?.role !== "assistant") {
      continue
    }

    const metadata = parseExistingMetadata(message.metadata)

    return messages.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? {
            ...candidate,
            metadata: {
              ...metadata,
              workTimeMs
            }
          }
        : candidate
    )
  }

  return messages
}
