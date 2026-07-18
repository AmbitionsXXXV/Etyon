import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef, useState } from "react"

import {
  buildTerminalTheme,
  hasTerminalDimensionsChanged,
  isTerminalContainerMeasurable,
  resolveTerminalDimensions,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_MOUNT_POLL_MS,
  TERMINAL_RESIZE_DEBOUNCE_MS,
  TERMINAL_SCROLLBACK
} from "@/renderer/lib/chat/terminal-panel"
import type { TerminalDimensions } from "@/renderer/lib/chat/terminal-panel"
import { rpcClient } from "@/renderer/lib/rpc"
import { HEROUI_PRO_THEME_STYLESHEET_ID } from "@/renderer/lib/settings"

type TerminalPanelStatus = "connecting" | "error" | "ready"

/** Formats an RGBA byte quadruplet as a css string xterm can parse. */
const formatRgba = (r: number, g: number, b: number, a: number): string =>
  a >= 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`

/** Overrides the alpha of an `rgb()`/`rgba()` string (for the selection tint). */
const withAlpha = (color: string, alpha: number): string => {
  const [r, g, b] = color.match(/[\d.]+/gu) ?? []

  return r && g && b ? `rgba(${r}, ${g}, ${b}, ${alpha})` : color
}

/**
 * Resolves the xterm theme off the app's live CSS variables. This Electron's
 * `getComputedStyle` reports colors in their authored space (oklch/oklab), which
 * xterm cannot parse — so a hidden probe resolves `var(--…)` and a 1×1 canvas
 * rasterizes the result down to concrete sRGB bytes. Background and foreground
 * follow `--card`/`--foreground`, keeping the terminal in step with light/dark
 * and the custom color schemas (Tokyo Night, etc.).
 */
const resolveTerminalTheme = () => {
  const root = document.documentElement
  const isDark = root.classList.contains("dark")
  const probe = document.createElement("span")
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none"
  document.body.append(probe)

  try {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext("2d", { willReadFrequently: true })

    const readColor = (cssVar: string, fallback: string): string => {
      probe.style.color = `var(${cssVar})`
      const computed = getComputedStyle(probe).color

      if (!(context && computed)) {
        return fallback
      }

      context.clearRect(0, 0, 1, 1)
      context.fillStyle = computed
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data

      return formatRgba(r, g, b, a)
    }

    const surface = readColor(
      "--card",
      isDark ? "rgb(9, 9, 11)" : "rgb(255, 255, 255)"
    )

    return buildTerminalTheme({
      background: surface,
      cursorAccent: surface,
      foreground: readColor(
        "--foreground",
        isDark ? "rgb(244, 244, 245)" : "rgb(24, 24, 27)"
      ),
      isDark,
      selectionBackground: withAlpha(
        readColor("--primary", "rgb(63, 63, 70)"),
        0.3
      )
    })
  } finally {
    probe.remove()
  }
}

/**
 * Interactive terminal bound to a chat session. The pty lives in the main process
 * (keyed by `sessionId`) and survives tab/session switches; this xterm instance is
 * disposable per mount. Once the container is measurable it boots xterm, calls
 * `terminal.ensure` with the real cols/rows, replays the returned snapshot,
 * subscribes to the `terminal:data` channel (filtered to this session), and
 * forwards keystrokes back through `sendTerminalInput`. On unmount it disposes
 * the xterm instance and the subscription but never disposes the pty.
 *
 * Boot is gated on the container having settled, non-degenerate layout — the
 * panel mounts mid-expansion (tiny sliver) and can even sit inside the hidden
 * project aside (0×0), where a pty spawned from those measurements is garbage.
 * The gate is driven by a debounced ResizeObserver plus a plain-timer fallback:
 * observer delivery rides the frame lifecycle, which pauses entirely in an
 * occluded window (Electron background throttling), while layout — and thus the
 * timer probe — keeps working. Without the timer, a terminal opened in a
 * backgrounded window stayed blank and unfocused forever.
 *
 * Mount/unmount is driven by the parent `Tabs.Panel`: React Aria unmounts
 * inactive tab panels, so switching tabs disposes this component and switching
 * back remounts it — the snapshot replay restores screen continuity. The call
 * site keys this on `sessionId`, so a session switch remounts against the new
 * session's buffer.
 */
export const TerminalPanel = ({ sessionId }: { sessionId: string }) => {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<TerminalPanelStatus>("connecting")

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    let isDisposed = false
    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let lastSentDimensions: TerminalDimensions | null = null
    let wasMeasurable = false
    const cleanups: (() => void)[] = []

    const sendResize = async (
      dimensions: TerminalDimensions
    ): Promise<void> => {
      try {
        await rpcClient.terminal.resize({
          cols: dimensions.cols,
          rows: dimensions.rows,
          sessionId
        })
      } catch {
        // A resize race (e.g. the pty is not ensured yet) must not surface as an
        // unhandled rejection; the next sync reconciles.
      }
    }

    const connect = async (
      activeTerminal: Terminal,
      dimensions: TerminalDimensions
    ): Promise<void> => {
      try {
        const { snapshot } = await rpcClient.terminal.ensure({
          cols: dimensions.cols,
          rows: dimensions.rows,
          sessionId
        })

        if (isDisposed) {
          return
        }

        if (snapshot) {
          activeTerminal.write(snapshot)
        }

        // Subscribe only after replaying the snapshot so live output appends after
        // the buffered history rather than interleaving with it.
        const unsubscribe = window.electron.onTerminalData((payload) => {
          if (!isDisposed && payload.sessionId === sessionId) {
            activeTerminal.write(payload.data)
          }
        })
        cleanups.push(unsubscribe)

        const inputDisposable = activeTerminal.onData((data) => {
          window.electron.sendTerminalInput(sessionId, data)
        })
        cleanups.push(() => inputDisposable.dispose())

        setStatus("ready")
        // Focus works without frame production (plain DOM focus), so this lands
        // even when the window is occluded and takes effect on reveal.
        activeTerminal.focus()
      } catch {
        if (!isDisposed) {
          setStatus("error")
        }
      }
    }

    const initialize = (): void => {
      const nextTerminal = new Terminal({
        cursorBlink: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: TERMINAL_FONT_SIZE,
        scrollback: TERMINAL_SCROLLBACK,
        theme: resolveTerminalTheme()
      })
      const nextFitAddon = new FitAddon()

      nextTerminal.loadAddon(nextFitAddon)
      nextTerminal.open(container)

      // Track the app theme: re-resolve when the light/dark class, color
      // schema, or liquid-glass surface flips on <html>. Skip the (repaint-y)
      // xterm theme assignment when the resolved colors did not change —
      // `applySettings` rewrites the class attribute on every settings save.
      let appliedThemeJson = JSON.stringify(nextTerminal.options.theme)
      const applyResolvedTerminalTheme = () => {
        const theme = resolveTerminalTheme()
        const themeJson = JSON.stringify(theme)

        if (themeJson === appliedThemeJson) {
          return
        }

        appliedThemeJson = themeJson
        nextTerminal.options.theme = theme
      }
      const themeObserver = new MutationObserver(() => {
        applyResolvedTerminalTheme()

        // The pro color schemas apply through a stylesheet that loads async
        // after the data-theme flip; the sync resolve above rasterized against
        // the outgoing sheet, so resolve once more when the new sheet lands.
        const proStylesheet = document.querySelector<HTMLLinkElement>(
          `link#${HEROUI_PRO_THEME_STYLESHEET_ID}`
        )

        proStylesheet?.addEventListener("load", applyResolvedTerminalTheme, {
          once: true
        })
      })
      themeObserver.observe(document.documentElement, {
        attributeFilter: ["class", "data-liquid-glass", "data-theme"],
        attributes: true
      })
      cleanups.push(() => themeObserver.disconnect())

      // Copy the selection on Cmd+C (macOS). Ctrl+C is deliberately left alone so
      // it still sends SIGINT to the shell on every platform. Paste (Cmd/Ctrl+V) is
      // handled natively by xterm's hidden textarea → `onData` → `sendTerminalInput`.
      nextTerminal.attachCustomKeyEventHandler((event) => {
        const isCopy =
          event.type === "keydown" &&
          event.metaKey &&
          !event.ctrlKey &&
          event.key.toLowerCase() === "c" &&
          nextTerminal.hasSelection()

        if (isCopy) {
          void navigator.clipboard?.writeText(nextTerminal.getSelection())
          return false
        }

        return true
      })

      terminal = nextTerminal
      fitAddon = nextFitAddon
      cleanups.push(() => {
        nextTerminal.dispose()
        terminal = null
        fitAddon = null
      })

      // The container is measurable here, so the proposal is real; the fallback
      // to xterm's defaults only covers a renderer that cannot report cell size.
      const dimensions = resolveTerminalDimensions(
        nextFitAddon.proposeDimensions()
      ) ?? { cols: nextTerminal.cols, rows: nextTerminal.rows }

      lastSentDimensions = dimensions
      nextTerminal.resize(dimensions.cols, dimensions.rows)
      void connect(nextTerminal, dimensions)
    }

    const fitExisting = (): void => {
      if (!(terminal && fitAddon)) {
        return
      }

      const dimensions = resolveTerminalDimensions(fitAddon.proposeDimensions())

      if (
        !dimensions ||
        !hasTerminalDimensionsChanged(lastSentDimensions, dimensions)
      ) {
        return
      }

      lastSentDimensions = dimensions
      terminal.resize(dimensions.cols, dimensions.rows)
      void sendResize(dimensions)
    }

    // Reconcile the terminal with the container's current geometry: boot it on
    // the first settled measurement, fit it afterwards, and do nothing while the
    // container is hidden or mid-animation.
    const sync = (): void => {
      if (isDisposed) {
        return
      }

      const rect = container.getBoundingClientRect()

      if (
        !isTerminalContainerMeasurable({
          height: rect.height,
          width: rect.width
        })
      ) {
        wasMeasurable = false
        return
      }

      const isReveal = !wasMeasurable

      wasMeasurable = true

      if (!terminal) {
        initialize()
        return
      }

      fitExisting()

      if (isReveal) {
        // The panel was re-revealed (e.g. Mod+J reopened it) with a live
        // terminal; give it the keyboard back.
        terminal.focus()
      }
    }

    let syncTimer: number | undefined
    const scheduleSync = (): void => {
      window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(sync, TERMINAL_RESIZE_DEBOUNCE_MS)
    }
    cleanups.push(() => window.clearTimeout(syncTimer))

    const observer = new ResizeObserver(scheduleSync)
    observer.observe(container)
    cleanups.push(() => observer.disconnect())

    // Frame-lifecycle-independent boot path: keep probing until the terminal
    // exists, then leave resizes to the observer.
    const kickstartTimer = window.setInterval(() => {
      if (terminal) {
        window.clearInterval(kickstartTimer)
        return
      }

      sync()
    }, TERMINAL_MOUNT_POLL_MS)
    cleanups.push(() => window.clearInterval(kickstartTimer))

    // A mount into an already-settled panel (the common tab switch) boots
    // immediately instead of waiting for an observer or poll tick.
    sync()

    return () => {
      isDisposed = true

      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [sessionId])

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-card p-2">
      <div
        aria-label={t("chat.projectPanel.terminalLabel")}
        className={cn("h-full w-full", status === "error" && "invisible")}
        ref={containerRef}
        role="application"
      />
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            {t("chat.projectPanel.terminalUnavailable")}
          </p>
        </div>
      ) : null}
    </div>
  )
}
