export const AUTO_COMPACT_KEEP_RECENT_MESSAGES_MAX = 20
export const AUTO_COMPACT_KEEP_RECENT_MESSAGES_MIN = 2
export const AUTO_COMPACT_THRESHOLD_MAX = 95
export const AUTO_COMPACT_THRESHOLD_MIN = 5

export const clampAutoCompactKeepRecentMessages = (value: number): number =>
  Math.min(
    AUTO_COMPACT_KEEP_RECENT_MESSAGES_MAX,
    Math.max(AUTO_COMPACT_KEEP_RECENT_MESSAGES_MIN, Math.round(value))
  )

export const clampAutoCompactThreshold = (value: number): number =>
  Math.min(
    AUTO_COMPACT_THRESHOLD_MAX,
    Math.max(AUTO_COMPACT_THRESHOLD_MIN, Math.round(value))
  )

const RECOMMENDED_KEEP_RECENT_MESSAGES = 4
const RECOMMENDED_THRESHOLD_FALLBACK = 80
const RECOMMENDED_THRESHOLD_MAX = 90
const RECOMMENDED_THRESHOLD_MIN = 60
// Room for the next reply plus the compaction summary itself, capped so small
// windows still keep most of their space for history.
const RECOMMENDED_RESERVE_TOKENS = 40_000
const RECOMMENDED_RESERVE_MAX_RATIO = 0.2

export interface AutoCompactRecommendation {
  keepRecentMessages: number
  /** Tokens left free when compaction triggers; null when the window is unknown. */
  reserveTokens: number | null
  threshold: number
}

/**
 * The threshold that leaves about {@link RECOMMENDED_RESERVE_TOKENS} free in
 * the model's context window, rounded to 5% and kept within 60–90%.
 */
export const getRecommendedAutoCompact = (
  contextWindow?: number
): AutoCompactRecommendation => {
  if (!contextWindow || contextWindow <= 0) {
    return {
      keepRecentMessages: RECOMMENDED_KEEP_RECENT_MESSAGES,
      reserveTokens: null,
      threshold: RECOMMENDED_THRESHOLD_FALLBACK
    }
  }

  const reserve = Math.min(
    RECOMMENDED_RESERVE_TOKENS,
    contextWindow * RECOMMENDED_RESERVE_MAX_RATIO
  )
  const rawThreshold = (1 - reserve / contextWindow) * 100
  const threshold = Math.min(
    RECOMMENDED_THRESHOLD_MAX,
    Math.max(RECOMMENDED_THRESHOLD_MIN, Math.round(rawThreshold / 5) * 5)
  )

  return {
    keepRecentMessages: RECOMMENDED_KEEP_RECENT_MESSAGES,
    reserveTokens: Math.round(contextWindow * (1 - threshold / 100)),
    threshold
  }
}
