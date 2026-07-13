import type { ITheme } from "@xterm/xterm"

/**
 * Interactive terminal panel — rendering/sizing constants and the pure helpers
 * the xterm host in `components/chat/terminal-panel.tsx` needs.
 *
 * The pty and its ~200KB replay buffer live in the main process, keyed per chat
 * session (see `main/terminal/pty-manager.ts`); the renderer xterm instance is
 * disposable per mount. This module is kept import-light — types only, no
 * `window`/rpc access — so it is safe to unit-test under node.
 */

/** Cell font size, matching the read-only `terminal-output.tsx` density. */
export const TERMINAL_FONT_SIZE = 12

/**
 * Cross-platform monospace stack. The app defines no `--font-mono` token, so
 * this mirrors the framework default rather than inventing a project variable.
 * xterm measures glyphs on a canvas, so it needs concrete family names.
 */
export const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/** Debounce for ResizeObserver-driven fit + resize RPC (~100ms per the roadmap). */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 100

/**
 * Fallback poll while the terminal has not booted yet. ResizeObserver delivers
 * on the frame lifecycle, which pauses entirely in an occluded window (Electron
 * background throttling) — layout still computes there, so a plain timer keeps
 * probing the container until it becomes measurable.
 */
export const TERMINAL_MOUNT_POLL_MS = 500

/**
 * Minimum container size (px) before the xterm instance boots. Below this the
 * fit addon proposes degenerate cols/rows (the live dead-screen bug spawned a
 * 2×56 pty from a mid-expansion ~30px sliver, and a hidden panel measures 0×0),
 * and a pty born at such dimensions wraps its startup output unreadably. Sizes
 * this small only occur mid-animation or while the panel is hidden; a settled
 * open panel is always far larger (its minimum width is 22% of the window).
 */
export const TERMINAL_MIN_MOUNT_WIDTH_PX = 100
export const TERMINAL_MIN_MOUNT_HEIGHT_PX = 48

/** Scrollback the renderer xterm retains; the pty keeps its own authoritative buffer. */
export const TERMINAL_SCROLLBACK = 5000

// Mirrors the bounds in packages/rpc/src/schemas/terminal.ts (min 1, max 1000).
// Duplicated so this pure module carries no schema/runtime import.
const TERMINAL_MIN_DIMENSION = 1
const TERMINAL_MAX_DIMENSION = 1000

export interface TerminalDimensions {
  cols: number
  rows: number
}

const clampDimension = (value: number): number =>
  Math.min(
    TERMINAL_MAX_DIMENSION,
    Math.max(TERMINAL_MIN_DIMENSION, Math.floor(value))
  )

/**
 * Validates the dimensions `FitAddon.proposeDimensions()` returns. Yields `null`
 * when the container cannot be measured — an `undefined` result, or non-finite /
 * non-positive cols/rows — which is the state while the panel is collapsed
 * (`display: none`, zero size). Callers skip the ensure/resize RPC on `null` and
 * let the ResizeObserver retry once the terminal becomes visible. Valid values
 * are floored and clamped into the schema's 1..1000 range so the RPC never
 * rejects.
 */
export const resolveTerminalDimensions = (
  proposed?: Partial<TerminalDimensions> | null
): TerminalDimensions | null => {
  if (!proposed) {
    return null
  }

  const { cols, rows } = proposed

  if (typeof cols !== "number" || typeof rows !== "number") {
    return null
  }

  if (!(Number.isFinite(cols) && Number.isFinite(rows))) {
    return null
  }

  if (cols < TERMINAL_MIN_DIMENSION || rows < TERMINAL_MIN_DIMENSION) {
    return null
  }

  return { cols: clampDimension(cols), rows: clampDimension(rows) }
}

/** Whether the terminal changed size enough to warrant a resize RPC. */
export const hasTerminalDimensionsChanged = (
  previous: TerminalDimensions | null,
  next: TerminalDimensions
): boolean =>
  previous === null ||
  previous.cols !== next.cols ||
  previous.rows !== next.rows

export interface TerminalContainerSize {
  height: number
  width: number
}

/**
 * Whether the terminal's container is laid out large enough to boot xterm and
 * spawn/size the pty from real measurements. This is the regression guard for
 * the dead-screen bug: booting while hidden (0×0) or mid-panel-expansion
 * produced a degenerate pty, and in an occluded (frame-throttled) window no
 * ResizeObserver tick ever arrived to repair it.
 */
export const isTerminalContainerMeasurable = (
  size: TerminalContainerSize
): boolean =>
  size.width >= TERMINAL_MIN_MOUNT_WIDTH_PX &&
  size.height >= TERMINAL_MIN_MOUNT_HEIGHT_PX

/**
 * xterm theme aligned with the read-only `terminal-output.tsx` look: zinc-950
 * background (#09090b), zinc-100 foreground (#f4f4f5), plus a conventional dark
 * ANSI palette so interactive programs render sensible colors.
 */
export const createTerminalTheme = (): ITheme => ({
  background: "#09090b",
  black: "#18181b",
  blue: "#60a5fa",
  brightBlack: "#52525b",
  brightBlue: "#93c5fd",
  brightCyan: "#67e8f9",
  brightGreen: "#86efac",
  brightMagenta: "#d8b4fe",
  brightRed: "#fca5a5",
  brightWhite: "#fafafa",
  brightYellow: "#fde047",
  cursor: "#f4f4f5",
  cursorAccent: "#09090b",
  cyan: "#22d3ee",
  foreground: "#f4f4f5",
  green: "#4ade80",
  magenta: "#c084fc",
  red: "#f87171",
  selectionBackground: "#3f3f4680",
  white: "#e4e4e7",
  yellow: "#facc15"
})
