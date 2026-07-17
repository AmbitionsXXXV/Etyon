/**
 * Formats a model context window as a compact, human-readable magnitude WITHOUT
 * any unit suffix (callers append " ctx" or use it as a badge label):
 * - `>= 1_000_000` → megas with up to one decimal, trailing ".0" trimmed
 *   (1_000_000 → "1M", 1_500_000 → "1.5M", 1_047_576 → "1M", 2_000_000 → "2M").
 * - `>= 1000` → thousands ("202752" → "203K", "400000" → "400K").
 * - otherwise the bare number.
 *
 * Returns `null` for a falsy (missing/zero) window. Dependency-free so it is
 * safe in both the main and renderer processes and node-testable.
 */
export const formatContextWindowCompact = (
  contextWindow?: number
): string | null => {
  if (!contextWindow) {
    return null
  }

  if (contextWindow >= 1_000_000) {
    return `${Math.round(contextWindow / 100_000) / 10}M`
  }

  if (contextWindow >= 1000) {
    return `${Math.round(contextWindow / 1000)}K`
  }

  return `${contextWindow}`
}
