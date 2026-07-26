// Pure, Node-testable eviction logic for the in-app browser view pool. Each
// WebContentsView owns a renderer process, so live views cannot leak until
// quit; this module decides which one to reclaim.

export const BROWSER_VIEW_LRU_MAX = 3

export interface BrowserLruEntry {
  activeLeaseCount: number
  isVisible: boolean
  lastUsedAt: number
  sessionId: string
}

interface SelectBrowserViewToEvictInput {
  entries: BrowserLruEntry[]
  selectedSessionId: string | null
}

/**
 * Picks the browser view to evict when the number of live views exceeds
 * `BROWSER_VIEW_LRU_MAX`. A view is only eligible when it is hidden, holds no
 * active operation lease, and is not the currently selected session. Among the
 * eligible views the least-recently-used one wins. Returns the victim's
 * `sessionId`, or `null` when nothing should be evicted.
 */
export const selectBrowserViewToEvict = ({
  entries,
  selectedSessionId
}: SelectBrowserViewToEvictInput): string | null => {
  if (entries.length <= BROWSER_VIEW_LRU_MAX) {
    return null
  }

  let victim: BrowserLruEntry | null = null

  for (const entry of entries) {
    const isEligible =
      !entry.isVisible &&
      entry.activeLeaseCount === 0 &&
      entry.sessionId !== selectedSessionId

    if (!isEligible) {
      continue
    }

    if (victim === null || entry.lastUsedAt < victim.lastUsedAt) {
      victim = entry
    }
  }

  return victim?.sessionId ?? null
}
