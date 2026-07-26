import { useI18n } from "@etyon/i18n/react"
import { Button, Input, Spinner, TextField, ToggleButton } from "@heroui/react"
import {
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  CursorPointer01Icon,
  GlobeIcon,
  LinkSquare02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { KeyboardEvent } from "react"

import { openExternalUrl } from "@/renderer/lib/chat/assistant-message-timeline"
import {
  BROWSER_BOUNDS_THROTTLE_MS,
  BROWSER_MOUNT_POLL_MS,
  browserPanelReducer,
  formatBrowserAddressForDisplay,
  haveBrowserSurfaceBoundsChanged,
  INITIAL_BROWSER_PANEL_STATE,
  isBrowserSurfaceMeasurable,
  roundBrowserSurfaceBounds
} from "@/renderer/lib/chat/browser-panel"
import type { BrowserSurfaceBounds } from "@/renderer/lib/chat/browser-panel"
import {
  createWebElementMention,
  publishPickedWebElement
} from "@/renderer/lib/chat/web-element-capture"
import { rpcClient } from "@/renderer/lib/rpc"

/** Fire-and-forget browser command; a lost view must not reject unhandled. */
const runBrowserCommand = async (
  command: () => Promise<unknown>
): Promise<void> => {
  try {
    await command()
  } catch {
    // The view may have been evicted or the session switched underneath the
    // click; the next ensure/sync reconciles.
  }
}

const BrowserToolbarButton = ({
  icon,
  isDisabled = false,
  label,
  onPress
}: {
  icon: typeof GlobeIcon
  isDisabled?: boolean
  label: string
  onPress: () => void
}) => (
  <Button
    aria-label={label}
    isDisabled={isDisabled}
    isIconOnly
    onPress={onPress}
    size="sm"
    type="button"
    variant="ghost"
  >
    <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
  </Button>
)

/**
 * Embedded browser bound to a chat session. The page is a `WebContentsView`
 * owned by the main process (keyed by `sessionId`) and survives tab/session
 * switches; this component only renders the chrome and an empty host div whose
 * rectangle the native view is composited over.
 *
 * Two consequences drive the whole design. First, the native view paints *above*
 * the DOM, so no overlay can cover it — the connecting/empty/error states
 * therefore replace the host entirely rather than sitting on top of it, and the
 * view is only ever revealed in the `ready` state. Second, visibility cannot be
 * inferred from mounting: switching tabs unmounts this component, but collapsing
 * the panel only hides its container while leaving it mounted. The route passes
 * `isBrowserSurfaceVisible` for the collapse path and the unmount cleanup covers
 * the rest, so both routes end in `browser.setVisible(false)`.
 *
 * Geometry is pushed the same way the terminal sizes its pty: a debounced
 * ResizeObserver with a plain-timer fallback (observer delivery rides the frame
 * lifecycle, which pauses entirely in an occluded window, and never fires when
 * the host *moves* without resizing) behind a ≥100x48 measurable gate.
 */
export const BrowserPanel = ({
  isBrowserSurfaceVisible,
  sessionId
}: {
  isBrowserSurfaceVisible: boolean
  sessionId: string
}) => {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [state, dispatch] = useReducer(
    browserPanelReducer,
    INITIAL_BROWSER_PANEL_STATE
  )
  const [isSurfaceMeasurable, setSurfaceMeasurable] = useState(false)
  const [connectToken, setConnectToken] = useState(0)
  const [addressDraft, setAddressDraft] = useState<string | null>(null)
  const [isPickingElement, setPickingElement] = useState(false)
  const isReady = state.status === "ready"

  useEffect(() => {
    let isDisposed = false
    let hasReceivedPush = false

    // Subscribe before ensuring so a restore-driven load cannot slip through the
    // gap; the ensure result is then only applied while it is still the freshest
    // thing we know.
    const unsubscribe = window.electron.onBrowserState((payload) => {
      if (isDisposed || payload.sessionId !== sessionId) {
        return
      }

      hasReceivedPush = true
      dispatch({ state: payload.state, type: "state-received" })
    })

    const connect = async (): Promise<void> => {
      try {
        const ensured = await rpcClient.browser.ensure({ sessionId })

        if (isDisposed || hasReceivedPush) {
          return
        }

        dispatch({ state: ensured, type: "state-received" })
      } catch {
        if (!isDisposed) {
          dispatch({ type: "connect-failed" })
        }
      }
    }

    void connect()

    return () => {
      isDisposed = true
      unsubscribe()
    }
  }, [connectToken, sessionId])

  // Keep the native view aligned with the host rectangle. The window is
  // frameless with a hidden title bar, so the viewport-relative rect is already
  // the window-relative rect the main process expects.
  useEffect(() => {
    const host = hostRef.current

    if (!(host && isReady)) {
      return
    }

    let isDisposed = false
    let lastSentBounds: BrowserSurfaceBounds | null = null
    let lastSentAt = 0
    let throttleTimer: number | undefined

    const sendBounds = async (bounds: BrowserSurfaceBounds): Promise<void> => {
      try {
        await rpcClient.browser.setBounds({ bounds, sessionId })
      } catch {
        // A bounds race (the view is not ensured yet, or was evicted) must not
        // surface as an unhandled rejection; the next sync reconciles.
      }
    }

    const sync = (): void => {
      if (isDisposed) {
        return
      }

      const rect = host.getBoundingClientRect()
      const isMeasurable = isBrowserSurfaceMeasurable({
        height: rect.height,
        width: rect.width
      })

      setSurfaceMeasurable(isMeasurable)

      if (!isMeasurable) {
        return
      }

      const bounds = roundBrowserSurfaceBounds({
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y
      })

      if (!haveBrowserSurfaceBoundsChanged(lastSentBounds, bounds)) {
        return
      }

      const elapsed = Date.now() - lastSentAt

      if (elapsed >= BROWSER_BOUNDS_THROTTLE_MS) {
        lastSentAt = Date.now()
        lastSentBounds = bounds
        void sendBounds(bounds)
        return
      }

      // Mid-drag: coalesce onto a trailing edge so the resize handle stays
      // responsive and the final rectangle always lands.
      window.clearTimeout(throttleTimer)
      throttleTimer = window.setTimeout(
        sync,
        BROWSER_BOUNDS_THROTTLE_MS - elapsed
      )
    }

    const observer = new ResizeObserver(sync)
    observer.observe(host)
    const pollTimer = window.setInterval(sync, BROWSER_MOUNT_POLL_MS)

    sync()

    return () => {
      isDisposed = true
      observer.disconnect()
      window.clearInterval(pollTimer)
      window.clearTimeout(throttleTimer)
      setSurfaceMeasurable(false)
    }
  }, [isReady, sessionId])

  useEffect(() => {
    const applyVisibility = async (): Promise<void> => {
      try {
        await rpcClient.browser.setVisible({
          sessionId,
          visible: isBrowserSurfaceVisible && isSurfaceMeasurable
        })
      } catch {
        // Before the first ensure resolves there is no view to address; the
        // measurable flip re-runs this once the host is live.
      }
    }

    void applyVisibility()
  }, [isBrowserSurfaceVisible, isSurfaceMeasurable, sessionId])

  // Collapsing the panel keeps this component mounted, so the effect above owns
  // steady-state visibility. This one covers the unmount routes — tab switch,
  // artifact swap, session switch — where no prop change ever arrives.
  useEffect(
    () => () => {
      void runBrowserCommand(() =>
        rpcClient.browser.setVisible({ sessionId, visible: false })
      )
    },
    [sessionId]
  )

  // A pick stays pending until the user clicks in the page, so the toggle owns
  // both edges: pressing it again sends the cancel that settles the call with a
  // null element, and the same call's `finally` resets the flag either way.
  const togglePickElement = useCallback(async (): Promise<void> => {
    if (isPickingElement) {
      await runBrowserCommand(() =>
        rpcClient.browser.cancelElementPick({ sessionId })
      )
      return
    }

    setPickingElement(true)

    try {
      const { element } = await rpcClient.browser.pickElement({ sessionId })

      if (element) {
        publishPickedWebElement(createWebElementMention(element))
      }
    } catch {
      // The view was evicted or the session switched mid-pick; nothing to add.
    } finally {
      setPickingElement(false)
    }
  }, [isPickingElement, sessionId])

  // Unmount routes (tab switch, session switch) never reach the toggle, and a
  // pick left running would keep a lease on the view.
  useEffect(
    () => () => {
      void runBrowserCommand(() =>
        rpcClient.browser.cancelElementPick({ sessionId })
      )
    },
    [sessionId]
  )

  const navigate = useCallback(
    async (input: string): Promise<void> => {
      const value = input.trim()

      if (value === "") {
        return
      }

      // Hand the field back to the live address; from here the pushed state is
      // the truth, and a lingering draft would pin the bar to the typed text.
      setAddressDraft(null)
      dispatch({ type: "navigate-started" })

      try {
        // The raw text goes over the wire: the main process owns URL
        // normalization and the http(s) allowlist.
        const next = await rpcClient.browser.navigate({
          input: value,
          sessionId
        })

        dispatch({ state: next, type: "state-received" })
      } catch {
        dispatch({ type: "navigate-failed" })
      }
    },
    [sessionId]
  )

  const addressValue = addressDraft ?? formatBrowserAddressForDisplay(state.url)

  const handleAddressKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      void navigate(addressValue)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      // Drop the edit and fall back to the live address.
      setAddressDraft(null)
      event.currentTarget.blur()
    }
  }

  const handleAddressFocus = (): void => {
    // Editing works on the real address, not the shortened display form.
    setAddressDraft((current) => current ?? state.url)
  }

  const handleAddressBlur = (): void => {
    setAddressDraft(null)
  }

  const handleRetry = (): void => {
    dispatch({ type: "connect-started" })
    setConnectToken((token) => token + 1)
  }

  if (state.status === "connecting") {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center bg-card">
        <Spinner size="sm" />
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
        <p className="max-w-xs text-xs leading-5 text-danger">
          {t("chat.projectPanel.browserError")}
        </p>
        <Button onPress={handleRetry} size="sm" type="button" variant="ghost">
          {t("chat.projectPanel.browserRetry")}
        </Button>
      </div>
    )
  }

  if (state.status === "empty") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 bg-card px-6">
        <HugeiconsIcon
          className="text-muted-foreground"
          icon={GlobeIcon}
          size={22}
          strokeWidth={2}
        />
        <p className="max-w-xs text-center text-xs leading-5 text-muted-foreground">
          {t("chat.projectPanel.browserEmptyHint")}
        </p>
        <div className="flex w-full max-w-sm items-center gap-2">
          <TextField
            aria-label={t("chat.projectPanel.browserAddressLabel")}
            className="min-w-0 flex-1"
            onChange={setAddressDraft}
            value={addressValue}
          >
            <Input
              onKeyDown={handleAddressKeyDown}
              placeholder={t("chat.projectPanel.browserAddressPlaceholder")}
              variant="secondary"
            />
          </TextField>
          <Button
            isDisabled={addressValue.trim() === ""}
            onPress={() => void navigate(addressValue)}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("chat.projectPanel.browserGo")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <BrowserToolbarButton
          icon={ArrowLeft01Icon}
          isDisabled={!state.canGoBack}
          label={t("chat.projectPanel.browserBack")}
          onPress={() =>
            void runBrowserCommand(() =>
              rpcClient.browser.goBack({ sessionId })
            )
          }
        />
        <BrowserToolbarButton
          icon={ArrowRight01Icon}
          isDisabled={!state.canGoForward}
          label={t("chat.projectPanel.browserForward")}
          onPress={() =>
            void runBrowserCommand(() =>
              rpcClient.browser.goForward({ sessionId })
            )
          }
        />
        {state.isLoading ? (
          <BrowserToolbarButton
            icon={Cancel01Icon}
            label={t("chat.projectPanel.browserStop")}
            onPress={() =>
              void runBrowserCommand(() =>
                rpcClient.browser.stop({ sessionId })
              )
            }
          />
        ) : (
          <BrowserToolbarButton
            icon={ArrowReloadHorizontalIcon}
            label={t("chat.projectPanel.browserReload")}
            onPress={() =>
              void runBrowserCommand(() =>
                rpcClient.browser.reload({ sessionId })
              )
            }
          />
        )}
        <TextField
          aria-label={t("chat.projectPanel.browserAddressLabel")}
          className="min-w-0 flex-1"
          onChange={setAddressDraft}
          value={addressValue}
        >
          <Input
            onBlur={handleAddressBlur}
            onFocus={handleAddressFocus}
            onKeyDown={handleAddressKeyDown}
            placeholder={t("chat.projectPanel.browserAddressPlaceholder")}
            variant="secondary"
          />
        </TextField>
        <ToggleButton
          aria-label={t("chat.projectPanel.browserPickElement")}
          isIconOnly
          isSelected={isPickingElement}
          onPress={() => void togglePickElement()}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={CursorPointer01Icon} size={15} strokeWidth={2} />
        </ToggleButton>
        <BrowserToolbarButton
          icon={LinkSquare02Icon}
          isDisabled={state.url === ""}
          label={t("chat.projectPanel.browserOpenExternal")}
          onPress={() => openExternalUrl(state.url)}
        />
      </div>

      {/* Page-load progress. The track is always reserved so a load never
          shifts the host rectangle, which would republish bounds mid-navigation. */}
      <div className="h-0.5 w-full shrink-0 overflow-hidden">
        {state.isLoading ? (
          <div className="h-full w-full animate-pulse bg-accent" />
        ) : null}
      </div>

      <div
        aria-label={t("chat.projectPanel.browserLabel")}
        className="min-h-0 w-full flex-1"
        ref={hostRef}
        role="application"
      />
    </div>
  )
}
