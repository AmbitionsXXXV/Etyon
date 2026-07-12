import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { useDebouncedCallback } from "@tanstack/react-pacer"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef, useState } from "react"

import {
  createTerminalTheme,
  hasTerminalDimensionsChanged,
  resolveTerminalDimensions,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_RESIZE_DEBOUNCE_MS,
  TERMINAL_SCROLLBACK
} from "@/renderer/lib/chat/terminal-panel"
import type { TerminalDimensions } from "@/renderer/lib/chat/terminal-panel"
import { rpcClient } from "@/renderer/lib/rpc"

type TerminalPanelStatus = "connecting" | "error" | "ready"

/**
 * Interactive terminal bound to a chat session. The pty lives in the main process
 * (keyed by `sessionId`) and survives tab/session switches; this xterm instance is
 * disposable per mount. On mount it calls `terminal.ensure`, replays the returned
 * snapshot, subscribes to the `terminal:data` channel (filtered to this session),
 * and forwards keystrokes back through `sendTerminalInput`. On unmount it disposes
 * the xterm instance and the subscription but never disposes the pty.
 *
 * Mount/unmount is driven by the parent `Tabs.Panel`: React Aria unmounts inactive
 * tab panels, so switching tabs disposes this component and switching back remounts
 * it — the snapshot replay restores screen continuity. The call site keys this on
 * `sessionId`, so a session switch remounts against the new session's buffer.
 */
export const TerminalPanel = ({ sessionId }: { sessionId: string }) => {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastDimensionsRef = useRef<TerminalDimensions | null>(null)
  const [status, setStatus] = useState<TerminalPanelStatus>("connecting")

  // Debounced fit → resize RPC. `useDebouncedCallback` returns a stable reference,
  // so the mount effect can wire it to a ResizeObserver without re-running. It reads
  // live objects from refs; a collapsed panel (zero-size container) yields no
  // measurable dimensions, so the fit is skipped until the terminal becomes visible.
  const applyFit = useDebouncedCallback(
    () => {
      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current

      if (!(terminal && fitAddon)) {
        return
      }

      const dimensions = resolveTerminalDimensions(fitAddon.proposeDimensions())

      if (!dimensions) {
        return
      }

      const becameVisible = lastDimensionsRef.current === null

      if (
        !hasTerminalDimensionsChanged(lastDimensionsRef.current, dimensions)
      ) {
        return
      }

      lastDimensionsRef.current = dimensions
      terminal.resize(dimensions.cols, dimensions.rows)

      const resizeRemotePty = async (): Promise<void> => {
        try {
          await rpcClient.terminal.resize({
            cols: dimensions.cols,
            rows: dimensions.rows,
            sessionId
          })
        } catch {
          // A resize race (e.g. the pty was disposed) must not surface as an
          // unhandled rejection; the next observer tick reconciles.
        }
      }

      void resizeRemotePty()

      if (becameVisible) {
        // First time the terminal is measurable — i.e. it was just revealed while
        // it was already the selected tab. Focus it now that it can take input.
        terminal.focus()
      }
    },
    { wait: TERMINAL_RESIZE_DEBOUNCE_MS }
  )

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    let isDisposed = false
    const cleanups: (() => void)[] = []

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      scrollback: TERMINAL_SCROLLBACK,
      theme: createTerminalTheme()
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    cleanups.push(() => {
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    })

    // Copy the selection on Cmd+C (macOS). Ctrl+C is deliberately left alone so it
    // still sends SIGINT to the shell on every platform. Paste (Cmd/Ctrl+V) is
    // handled natively by xterm's hidden textarea → `onData` → `sendTerminalInput`.
    terminal.attachCustomKeyEventHandler((event) => {
      const isCopy =
        event.type === "keydown" &&
        event.metaKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "c" &&
        terminal.hasSelection()

      if (isCopy) {
        void navigator.clipboard?.writeText(terminal.getSelection())
        return false
      }

      return true
    })

    const measured = resolveTerminalDimensions(fitAddon.proposeDimensions())
    const initialDimensions: TerminalDimensions = measured ?? {
      cols: terminal.cols,
      rows: terminal.rows
    }
    lastDimensionsRef.current = measured

    const observer = new ResizeObserver(() => applyFit())
    observer.observe(container)
    cleanups.push(() => observer.disconnect())

    const initialize = async () => {
      try {
        const { snapshot } = await rpcClient.terminal.ensure({
          cols: initialDimensions.cols,
          rows: initialDimensions.rows,
          sessionId
        })

        if (isDisposed) {
          return
        }

        if (snapshot) {
          terminal.write(snapshot)
        }

        // Subscribe only after replaying the snapshot so live output appends after
        // the buffered history rather than interleaving with it.
        const unsubscribe = window.electron.onTerminalData((payload) => {
          if (!isDisposed && payload.sessionId === sessionId) {
            terminal.write(payload.data)
          }
        })
        cleanups.push(unsubscribe)

        const inputDisposable = terminal.onData((data) => {
          window.electron.sendTerminalInput(sessionId, data)
        })
        cleanups.push(() => inputDisposable.dispose())

        setStatus("ready")

        requestAnimationFrame(() => {
          if (!isDisposed) {
            terminal.focus()
          }
        })
      } catch {
        if (!isDisposed) {
          setStatus("error")
        }
      }
    }

    void initialize()

    return () => {
      isDisposed = true

      for (const cleanup of cleanups) {
        cleanup()
      }

      lastDimensionsRef.current = null
    }
  }, [applyFit, sessionId])

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
