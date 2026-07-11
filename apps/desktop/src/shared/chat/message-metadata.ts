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

const patchLatestAssistantMetadata = <
  MESSAGE extends { metadata?: unknown; role: string }
>(
  messages: MESSAGE[],
  patch: Record<string, unknown>
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
              ...patch
            }
          }
        : candidate
    )
  }

  return messages
}

export const attachWorkTimeToLatestAssistantMessage = <
  MESSAGE extends { metadata?: unknown; role: string }
>(
  messages: MESSAGE[],
  workTimeMs: number
): MESSAGE[] => patchLatestAssistantMetadata(messages, { workTimeMs })

/**
 * Stamps the finished agent run's timing and outcome onto the latest assistant
 * message (alongside `workTimeMs`) so the renderer can settle the work section:
 * `exitReason` drives the Worked/Stopped/Failed header, and `thoughtDurationsMs`
 * gives each thinking block its final "Thought for Xs".
 */
export const attachRunOutcomeToLatestAssistantMessage = <
  MESSAGE extends { metadata?: unknown; role: string }
>(
  messages: MESSAGE[],
  {
    exitReason,
    thoughtDurationsMs,
    workTimeMs
  }: {
    exitReason?: string | null
    thoughtDurationsMs: number[]
    workTimeMs: number
  }
): MESSAGE[] =>
  patchLatestAssistantMetadata(messages, {
    ...(exitReason ? { exitReason } : {}),
    ...(thoughtDurationsMs.length > 0 ? { thoughtDurationsMs } : {}),
    workTimeMs
  })
