// Pure, Node-testable policies for what the agent pulls out of a browsed page.
// No Electron imports, so the truncation budget and the downscale math can be
// unit tested outside the main process (mirrors url-policy.ts).

/**
 * Page text budget for a `browser` read. Deliberately NOT bash's dual-tail
 * policy: a shell log is interesting at the end, whereas a page is front-loaded
 * (title, nav, lede, main copy), so the head carries the bulk of the budget and
 * a smaller tail preserves footers, pagination, and related links.
 */
export const PAGE_TEXT_HEAD_MAX_CHARS = 9000
export const PAGE_TEXT_TAIL_MAX_CHARS = 3000

export interface TruncatedPageText {
  text: string
  truncated: boolean
}

/**
 * Clamps extracted page text to head + tail with an explicit elision marker so
 * the model can tell a cut page from a short one (and knows how much it lost).
 */
export const truncatePageText = (text: string): TruncatedPageText => {
  if (text.length <= PAGE_TEXT_HEAD_MAX_CHARS + PAGE_TEXT_TAIL_MAX_CHARS) {
    return { text, truncated: false }
  }

  const head = text.slice(0, PAGE_TEXT_HEAD_MAX_CHARS)
  const tail = text.slice(-PAGE_TEXT_TAIL_MAX_CHARS)
  const omittedChars =
    text.length - PAGE_TEXT_HEAD_MAX_CHARS - PAGE_TEXT_TAIL_MAX_CHARS

  return {
    text: `${head}\n\n[... ${omittedChars} characters omitted ...]\n\n${tail}`,
    truncated: true
  }
}

/**
 * Longest-edge budget for a screenshot that may be handed to a vision model.
 * 1568px is Anthropic's documented cap — anything larger is downscaled upstream
 * anyway, so sending more only costs upload bytes and tokens.
 */
export const SCREENSHOT_MAX_EDGE_PX = 1568

export interface ScreenshotSize {
  height: number
  width: number
}

/**
 * Fit-inside downscale preserving aspect ratio. Images already within budget
 * (and degenerate zero-sized ones) are returned untouched so the caller can
 * skip the resize entirely.
 */
export const resolveScreenshotSize = (size: ScreenshotSize): ScreenshotSize => {
  const longestEdge = Math.max(size.width, size.height)

  if (longestEdge <= SCREENSHOT_MAX_EDGE_PX) {
    return size
  }

  const scale = SCREENSHOT_MAX_EDGE_PX / longestEdge

  return {
    height: Math.max(1, Math.round(size.height * scale)),
    width: Math.max(1, Math.round(size.width * scale))
  }
}
