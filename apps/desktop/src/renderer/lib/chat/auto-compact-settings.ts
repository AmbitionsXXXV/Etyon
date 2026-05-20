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
