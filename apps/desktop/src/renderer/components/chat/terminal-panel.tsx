import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef, useState } from "react"

import {
  createTerminalTheme,
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

type TerminalPanelStatus = "connecting" | "error" | "ready"

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
        theme: createTerminalTheme()
      })
      const nextFitAddon = new FitAddon()

      nextTerminal.loadAddon(nextFitAddon)
      nextTerminal.open(container)

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
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-zinc-950 p-2">
      <div
        aria-label={t("chat.projectPanel.terminalLabel")}
        className={cn("h-full w-full", status === "error" && "invisible")}
        ref={containerRef}
        role="application"
      />
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-xs text-center text-xs text-zinc-400">
            {t("chat.projectPanel.terminalUnavailable")}
          </p>
        </div>
      ) : null}
    </div>
  )
}
