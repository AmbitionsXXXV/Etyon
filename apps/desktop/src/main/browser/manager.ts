import type { BrowserState } from "@etyon/rpc"
import { session, WebContentsView } from "electron"
import type { Session } from "electron"

import type { BrowserLruEntry } from "@/main/browser/lru"
import { selectBrowserViewToEvict } from "@/main/browser/lru"
import { isAllowedBrowserUrl } from "@/main/browser/url-policy"
import { logger } from "@/main/logger"
import { getServerUrl } from "@/main/server/server-url"
import { getMainWindow } from "@/main/window"

export const BROWSER_PARTITION = "persist:browser"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"])

export type BrowserStateInitiator = "agent" | "user"

export interface BrowserStatePush {
  initiator: BrowserStateInitiator
  sessionId: string
  state: BrowserState
}

type BrowserStateListener = (push: BrowserStatePush) => void

interface BrowserSession {
  faviconUrl?: string
  hasBounds: boolean
  initiator: BrowserStateInitiator
  isVisible: boolean
  lastUrl: string
  lastUsedAt: number
  leaseCount: number
  pendingRejects: Set<(error: Error) => void>
  view: WebContentsView
}

interface EnsureBrowserViewInput {
  sessionId: string
  url?: string
}

interface NavigateBrowserViewInput {
  sessionId: string
  url: string
}

interface SetBrowserViewBoundsInput {
  bounds: { height: number; width: number; x: number; y: number }
  sessionId: string
}

interface SetBrowserViewVisibleInput {
  sessionId: string
  visible: boolean
}

/**
 * Rejects any in-flight lease-guarded operation when its view is torn down so
 * awaiting callers never hang. PR3's agent tool relies on this to surface
 * abort/dispose as a typed failure.
 */
export class BrowserViewDisposedError extends Error {
  constructor(sessionId: string) {
    super(`Browser view disposed: ${sessionId}`)
    this.name = "BrowserViewDisposedError"
  }
}

const browserStateListeners = new Set<BrowserStateListener>()
const browserSessions = new Map<string, BrowserSession>()
// Last URL of views reclaimed by the LRU, restored on the next ensure.
const evictedUrls = new Map<string, string>()

let browsingSession: Session | null = null

const getLoopbackServerPort = (): string | null => {
  const serverUrl = getServerUrl()

  if (!serverUrl) {
    return null
  }

  try {
    return new URL(serverUrl).port || null
  } catch {
    return null
  }
}

// Blocks the browsing partition from reaching Etyon's own loopback server as
// defense-in-depth behind the server's bearer token. Partition isolation is not
// network isolation, so a hostile page could otherwise probe 127.0.0.1.
const targetsLoopbackServer = (requestUrl: string): boolean => {
  const port = getLoopbackServerPort()

  if (!port) {
    return false
  }

  try {
    const { hostname, port: requestPort } = new URL(requestUrl)

    return LOOPBACK_HOSTS.has(hostname) && requestPort === port
  } catch {
    return false
  }
}

const installBrowsingSessionHardening = (
  browserPartitionSession: Session
): void => {
  browserPartitionSession.setPermissionRequestHandler(
    (_webContents, _permission, grant) => {
      grant(false)
    }
  )
  browserPartitionSession.setPermissionCheckHandler(() => false)
  browserPartitionSession.setDevicePermissionHandler(() => false)
  browserPartitionSession.on("select-hid-device", (event, _details, cancel) => {
    event.preventDefault()
    cancel()
  })
  browserPartitionSession.on(
    "select-serial-port",
    (event, _portList, _webContents, cancel) => {
      event.preventDefault()
      cancel("")
    }
  )
  browserPartitionSession.on("select-usb-device", (event, _details, cancel) => {
    event.preventDefault()
    cancel()
  })
  browserPartitionSession.webRequest.onBeforeRequest((details, respond) => {
    respond({ cancel: targetsLoopbackServer(details.url) })
  })
}

const getBrowsingSession = (): Session => {
  if (browsingSession) {
    return browsingSession
  }

  const browserPartitionSession = session.fromPartition(BROWSER_PARTITION)

  installBrowsingSessionHardening(browserPartitionSession)
  browsingSession = browserPartitionSession

  return browsingSession
}

const getBrowserSession = (sessionId: string): BrowserSession => {
  const browserSession = browserSessions.get(sessionId)

  if (!browserSession) {
    throw new Error(`Browser session not found: ${sessionId}`)
  }

  return browserSession
}

const deriveBrowserState = (browserSession: BrowserSession): BrowserState => {
  const { webContents } = browserSession.view
  const state: BrowserState = {
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    isLoading: webContents.isLoading(),
    title: webContents.getTitle(),
    url: webContents.getURL()
  }

  if (browserSession.faviconUrl !== undefined) {
    state.faviconUrl = browserSession.faviconUrl
  }

  return state
}

const emitBrowserState = (
  sessionId: string,
  browserSession: BrowserSession
): void => {
  const push: BrowserStatePush = {
    initiator: browserSession.initiator,
    sessionId,
    state: deriveBrowserState(browserSession)
  }

  for (const listener of browserStateListeners) {
    listener(push)
  }
}

const runBrowserLoad = async (
  view: WebContentsView,
  url: string
): Promise<void> => {
  try {
    await view.webContents.loadURL(url)
  } catch (error) {
    // loadURL rejects on aborted loads and network errors; log and move on so
    // the fire-and-forget navigation never surfaces an unhandled rejection.
    logger.error("browser_load_url_failed", { error, url })
  }
}

// The single navigation chokepoint. `will-*` events cannot see main-process
// loads, so the allowlist is re-checked here before every `loadURL`.
const loadBrowserUrl = (
  browserSession: BrowserSession,
  url: string,
  initiator: BrowserStateInitiator
): void => {
  if (!isAllowedBrowserUrl(url)) {
    throw new Error(`Browser URL not allowed: ${url}`)
  }

  browserSession.initiator = initiator
  browserSession.lastUrl = url
  browserSession.lastUsedAt = Date.now()
  void runBrowserLoad(browserSession.view, url)
}

const attachViewListeners = (
  sessionId: string,
  browserSession: BrowserSession
): void => {
  const { webContents } = browserSession.view
  const emit = (): void => {
    emitBrowserState(sessionId, browserSession)
  }

  webContents.on("did-navigate", emit)
  webContents.on("did-navigate-in-page", emit)
  webContents.on("did-start-loading", emit)
  webContents.on("did-stop-loading", emit)
  webContents.on("page-title-updated", emit)
  webContents.on("page-favicon-updated", (_event, favicons) => {
    browserSession.faviconUrl = favicons.at(0)
    emit()
  })

  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedBrowserUrl(url)) {
      loadBrowserUrl(browserSession, url, "user")
    }

    return { action: "deny" }
  })

  const blockDisallowedNavigation = (event: {
    preventDefault: () => void
    url: string
  }): void => {
    if (isAllowedBrowserUrl(event.url)) {
      return
    }

    event.preventDefault()
    logger.debug("browser_navigation_blocked", { sessionId, url: event.url })
  }

  webContents.on("will-navigate", blockDisallowedNavigation)
  webContents.on("will-frame-navigate", blockDisallowedNavigation)
  webContents.on("will-redirect", blockDisallowedNavigation)
}

const applyBrowserViewVisibility = (browserSession: BrowserSession): void => {
  // Views stay hidden until a valid bounds arrives so they never flash at (0,0).
  browserSession.view.setVisible(
    browserSession.isVisible && browserSession.hasBounds
  )
}

const createBrowserSession = (sessionId: string): BrowserSession => {
  getBrowsingSession()

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      partition: BROWSER_PARTITION,
      sandbox: true
    }
  })

  view.setVisible(false)
  getMainWindow()?.contentView.addChildView(view)

  const browserSession: BrowserSession = {
    hasBounds: false,
    initiator: "user",
    isVisible: false,
    lastUrl: "",
    lastUsedAt: Date.now(),
    leaseCount: 0,
    pendingRejects: new Set(),
    view
  }

  browserSessions.set(sessionId, browserSession)
  attachViewListeners(sessionId, browserSession)

  return browserSession
}

const evictBrowserViewsIfNeeded = (selectedSessionId: string): void => {
  const entries: BrowserLruEntry[] = [...browserSessions.entries()].map(
    ([entrySessionId, browserSession]) => ({
      activeLeaseCount: browserSession.leaseCount,
      isVisible: browserSession.isVisible,
      lastUsedAt: browserSession.lastUsedAt,
      sessionId: entrySessionId
    })
  )
  const victimId = selectBrowserViewToEvict({ entries, selectedSessionId })

  if (victimId === null) {
    return
  }

  const victim = browserSessions.get(victimId)

  if (victim) {
    evictedUrls.set(victimId, victim.lastUrl)
    disposeBrowserView(victimId)
  }
}

export const ensureBrowserView = ({
  sessionId,
  url
}: EnsureBrowserViewInput): BrowserState => {
  const existing = browserSessions.get(sessionId)

  if (existing) {
    existing.lastUsedAt = Date.now()

    if (url !== undefined && isAllowedBrowserUrl(url)) {
      loadBrowserUrl(existing, url, "user")
    }

    return deriveBrowserState(existing)
  }

  const browserSession = createBrowserSession(sessionId)
  const restoreUrl = evictedUrls.get(sessionId)
  evictedUrls.delete(sessionId)
  const targetUrl = url ?? restoreUrl

  if (targetUrl !== undefined && isAllowedBrowserUrl(targetUrl)) {
    loadBrowserUrl(browserSession, targetUrl, "user")
  }

  evictBrowserViewsIfNeeded(sessionId)

  return deriveBrowserState(browserSession)
}

export const navigateBrowserView = ({
  sessionId,
  url
}: NavigateBrowserViewInput): BrowserState => {
  const browserSession = getBrowserSession(sessionId)

  loadBrowserUrl(browserSession, url, "user")

  return deriveBrowserState(browserSession)
}

export const goBackBrowserView = (sessionId: string): void => {
  const { navigationHistory } = getBrowserSession(sessionId).view.webContents

  if (navigationHistory.canGoBack()) {
    navigationHistory.goBack()
  }
}

export const goForwardBrowserView = (sessionId: string): void => {
  const { navigationHistory } = getBrowserSession(sessionId).view.webContents

  if (navigationHistory.canGoForward()) {
    navigationHistory.goForward()
  }
}

export const reloadBrowserView = (sessionId: string): void => {
  getBrowserSession(sessionId).view.webContents.reload()
}

export const stopBrowserView = (sessionId: string): void => {
  getBrowserSession(sessionId).view.webContents.stop()
}

export const setBrowserViewBounds = ({
  bounds,
  sessionId
}: SetBrowserViewBoundsInput): void => {
  const browserSession = getBrowserSession(sessionId)

  browserSession.view.setBounds(bounds)
  browserSession.hasBounds = true
  applyBrowserViewVisibility(browserSession)
}

export const setBrowserViewVisible = ({
  sessionId,
  visible
}: SetBrowserViewVisibleInput): void => {
  const browserSession = getBrowserSession(sessionId)

  browserSession.isVisible = visible
  applyBrowserViewVisibility(browserSession)
}

export const disposeBrowserView = (sessionId: string): void => {
  const browserSession = browserSessions.get(sessionId)

  if (!browserSession) {
    return
  }

  browserSessions.delete(sessionId)

  // Settle every lease-guarded op still awaiting this view so none can hang.
  for (const reject of browserSession.pendingRejects) {
    reject(new BrowserViewDisposedError(sessionId))
  }
  browserSession.pendingRejects.clear()

  getMainWindow()?.contentView.removeChildView(browserSession.view)

  const { webContents } = browserSession.view

  if (!webContents.isDestroyed()) {
    webContents.close({ waitForBeforeUnload: false })
  }
}

export const disposeAllBrowserViews = (): void => {
  for (const sessionId of browserSessions.keys()) {
    disposeBrowserView(sessionId)
  }

  evictedUrls.clear()
}

/**
 * Holds a lease for the duration of an async op so the LRU cannot evict the
 * view mid-flight, and races the op against a disposal signal so a teardown
 * rejects with `BrowserViewDisposedError` instead of hanging.
 */
export const withBrowserLease = async <T>(
  sessionId: string,
  op: (view: WebContentsView) => Promise<T>
): Promise<T> => {
  const browserSession = browserSessions.get(sessionId)

  if (!browserSession) {
    throw new BrowserViewDisposedError(sessionId)
  }

  browserSession.leaseCount += 1
  browserSession.lastUsedAt = Date.now()

  const { promise: disposed, reject } = Promise.withResolvers<never>()
  browserSession.pendingRejects.add(reject)

  try {
    return await Promise.race([op(browserSession.view), disposed])
  } finally {
    browserSession.pendingRejects.delete(reject)

    const current = browserSessions.get(sessionId)

    if (current === browserSession) {
      current.leaseCount = Math.max(0, current.leaseCount - 1)
    }
  }
}

export const subscribeBrowserState = (
  listener: BrowserStateListener
): (() => void) => {
  browserStateListeners.add(listener)

  return () => {
    browserStateListeners.delete(listener)
  }
}
