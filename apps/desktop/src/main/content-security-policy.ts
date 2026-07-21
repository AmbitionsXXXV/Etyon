import { session } from "electron"

/**
 * Content-Security-Policy for the app's OWN renderer document — the window that
 * hosts the preload IPC bridge (open-external-url, terminal, orpc MessagePort).
 * This is defense-in-depth against untrusted agent output: even if model text
 * ever reached the DOM as live markup, a `script-src` with no `'unsafe-inline'`
 * and no remote origins means it cannot execute inline or remote script.
 *
 * This does NOT govern artifact HTML previews — those run in a sandboxed
 * `srcdoc` iframe with their own stricter, separately-injected CSP (see
 * lib/chat/artifact-panel). A srcdoc frame is not a network load, so the policy
 * here never touches it.
 *
 * Directive rationale (prod):
 * - `script-src 'self' 'wasm-unsafe-eval'`: bundled modules load from the app
 *   origin; `'wasm-unsafe-eval'` is required for Shiki's oniguruma WASM engine
 *   (`shiki/bundle/web`, used by the code viewer). Omitting `'unsafe-inline'`
 *   and `'unsafe-eval'` is the actual XSS protection.
 * - `style-src 'self' 'unsafe-inline'`: React inline `style=` attributes plus
 *   Tailwind v4 / HeroUI / Shiki runtime style injection all need inline styles.
 * - `img-src`: `etyon-attachment:` serves persisted vision images; `data:`/
 *   `blob:` cover generated images. Remote hosts stay blocked, which also
 *   neutralizes remote image beacons embedded in agent markdown.
 * - `connect-src`: MessagePort RPC is not subject to CSP, while AI SDK chat
 *   streams use the main-process Hono server on a random `127.0.0.1` port.
 *   Only that loopback HTTP origin is allowed; arbitrary remote fetches remain
 *   blocked.
 * - `frame-src 'self'`: permits the same-origin `srcdoc` artifact iframe.
 */
const LOCAL_CHAT_SERVER_CSP_SOURCE = "http://127.0.0.1:*"

const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: etyon-attachment:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' ${LOCAL_CHAT_SERVER_CSP_SOURCE}`,
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ")

/**
 * Dev relaxes exactly what the Vite dev server needs and nothing more: React
 * Fast Refresh injects an inline preamble script, HMR pushes over a WebSocket,
 * and modules/assets are served from the dev origin over http. This branch is
 * unreachable in a packaged build (the global is undefined there).
 */
const buildDevCsp = (devOrigin: string): string =>
  [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${devOrigin}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: etyon-attachment:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ${LOCAL_CHAT_SERVER_CSP_SOURCE} ${devOrigin} ws: wss:`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ")

export const buildRendererContentSecurityPolicy = (
  devServerUrl?: string
): string =>
  devServerUrl ? buildDevCsp(new URL(devServerUrl).origin) : PROD_CSP

const getRendererCsp = (): string =>
  buildRendererContentSecurityPolicy(MAIN_WINDOW_VITE_DEV_SERVER_URL)

/**
 * Stamps the renderer CSP onto document responses in the default session. Must
 * run after `app` is ready and before the first window loads. Only frame
 * document responses carry the header — a CSP on sub-resource responses is
 * ignored by the engine — so images, fonts, and the local API server are left
 * untouched.
 */
export const registerRendererContentSecurityPolicy = (): void => {
  const csp = getRendererCsp()

  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Electron's webRequest.onHeadersReceived is a synchronous callback API with no promise form.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDocument =
      details.resourceType === "mainFrame" ||
      details.resourceType === "subFrame"
    // A CSP header on sub-resource responses is ignored by the engine, so only
    // frame documents get it stamped; everything else passes through unchanged.
    const responseHeaders = isDocument
      ? { ...details.responseHeaders, "Content-Security-Policy": [csp] }
      : details.responseHeaders

    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Same synchronous Electron callback; there is no awaitable form.
    callback({ responseHeaders })
  })
}
