export const MEMORY_MAX_RETRIEVED_MEMORIES_MAX = 20
export const MEMORY_MAX_RETRIEVED_MEMORIES_MIN = 1
export const MEMORY_SIMILARITY_THRESHOLD_MAX = 100
export const MEMORY_SIMILARITY_THRESHOLD_MIN = 0

export const clampMaxRetrievedMemories = (value: number): number =>
  Math.min(
    MEMORY_MAX_RETRIEVED_MEMORIES_MAX,
    Math.max(MEMORY_MAX_RETRIEVED_MEMORIES_MIN, value)
  )

export const clampSimilarityThresholdPercent = (value: number): number =>
  Math.min(
    MEMORY_SIMILARITY_THRESHOLD_MAX,
    Math.max(MEMORY_SIMILARITY_THRESHOLD_MIN, value)
  )

export const formatSimilarityThreshold = (value: number): string =>
  `${Math.round(value * 100)}%`

export const percentToSimilarityThreshold = (value: number): number =>
  clampSimilarityThresholdPercent(value) / 100

export const similarityThresholdToPercent = (value: number): number =>
  clampSimilarityThresholdPercent(Math.round(value * 100))
