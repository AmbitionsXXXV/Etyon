import type { StreamTextTransform, ToolSet } from "ai"
import { smoothStream } from "ai"

// CJK-aware pacing: providers emit whole CJK sentences per delta (no
// whitespace to chunk on), so the renderer's typewriter stagger receives one
// huge burst and the next delta interrupts its cascade. A word-granularity
// Intl.Segmenter re-chunks mixed zh/ja/en into small even increments, and the
// 10ms drain keeps up with realistic token rates so no lag accumulates.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" })

/**
 * Server-side re-chunking transform for chat text streams. Typed against the
 * widest `ToolSet` so it drops into both the plain-chat `streamText` call and
 * the agent loop's tool-carrying call without casts.
 */
export const createChatSmoothingTransform = (): StreamTextTransform<ToolSet> =>
  smoothStream<ToolSet>({ chunking: SEGMENTER, delayInMs: 10 })
