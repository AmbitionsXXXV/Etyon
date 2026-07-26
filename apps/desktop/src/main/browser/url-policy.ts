// Pure, Node-testable URL policy for the in-app browser. No Electron imports so
// it can be unit tested and reused from both the RPC handler and the manager.

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu

/**
 * Normalizes free-form address-bar text into an absolute URL string.
 *
 * Trims the input, prepends `https://` when the text carries no URL scheme, and
 * parses the result with the WHATWG `URL` parser. Returns the canonical `href`
 * on success or `null` when the input is blank or unparseable. This performs no
 * allowlisting: callers must still pass the result through `isAllowedBrowserUrl`
 * before navigating.
 */
export const normalizeBrowserUrlInput = (input: string): string | null => {
  const trimmed = input.trim()

  if (trimmed.length === 0) {
    return null
  }

  const candidate = SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    return new URL(candidate).href
  } catch {
    return null
  }
}

/**
 * Returns true only for `http:`/`https:` URLs. This is the single source of
 * navigation truth, enforced inside the RPC handler, the window-open handler,
 * and before every `loadURL` call (the `will-*` events do not cover
 * main-process navigations). http is intentionally allowed, which inherently
 * permits `http://localhost` and `http://127.0.0.1` so local dev servers can be
 * previewed; every other scheme is rejected.
 */
export const isAllowedBrowserUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url)

    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Normalize + allowlist in one step, for callers that take free-form address
 * text and must end up with something navigable: the agent `browser` tool and
 * the RPC navigate handler. Returns the canonical URL, or null when the text is
 * unparseable or resolves to a scheme the browser refuses — the caller owns the
 * error message, since the two surfaces phrase rejection differently.
 */
export const resolveAllowedBrowserUrl = (input: string): string | null => {
  const normalized = normalizeBrowserUrlInput(input)

  return normalized !== null && isAllowedBrowserUrl(normalized)
    ? normalized
    : null
}
