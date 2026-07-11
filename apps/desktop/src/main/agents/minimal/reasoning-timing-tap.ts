/**
 * Measures how long each thinking block takes by tapping a UI message stream:
 * `reasoning-start` → `reasoning-end` per chunk id, accumulated in completion
 * order across every step of a run. Empty blocks (no delta) are dropped so the
 * durations line up 1:1 with the non-empty reasoning parts the UI renders.
 *
 * Pure and dependency-free (a `TransformStream` pass-through), so it wraps both
 * the agent-loop merges and the plain chat stream, and is node-testable.
 */

interface ReasoningChunk {
  delta?: unknown
  id?: unknown
  type?: unknown
}

export interface ReasoningTimingTap {
  getDurationsMs: () => number[]
  wrap: <TChunk>(stream: ReadableStream<TChunk>) => ReadableStream<TChunk>
}

export const createReasoningTimingTap = (
  now: () => number = () => Date.now()
): ReasoningTimingTap => {
  const durations: number[] = []
  const startedAt = new Map<string, number>()
  const seenContent = new Map<string, boolean>()

  const record = (chunk: ReasoningChunk): void => {
    const { id } = chunk

    if (typeof id !== "string") {
      return
    }

    if (chunk.type === "reasoning-start") {
      startedAt.set(id, now())
      seenContent.set(id, false)
      return
    }

    if (chunk.type === "reasoning-delta") {
      if (typeof chunk.delta === "string" && chunk.delta.trim().length > 0) {
        seenContent.set(id, true)
      }
      return
    }

    if (chunk.type === "reasoning-end") {
      const start = startedAt.get(id)

      if (start !== undefined && seenContent.get(id)) {
        durations.push(Math.max(0, now() - start))
      }

      startedAt.delete(id)
      seenContent.delete(id)
    }
  }

  const wrap = <TChunk>(
    stream: ReadableStream<TChunk>
  ): ReadableStream<TChunk> => {
    if (typeof stream.pipeThrough !== "function") {
      return stream
    }

    return stream.pipeThrough(
      new TransformStream<TChunk, TChunk>({
        transform(chunk, controller) {
          record(chunk as ReasoningChunk)
          controller.enqueue(chunk)
        }
      })
    )
  }

  return {
    getDurationsMs: () => [...durations],
    wrap
  }
}
