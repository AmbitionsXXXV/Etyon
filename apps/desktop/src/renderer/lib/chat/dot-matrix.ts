/**
 * Pure animation math for the dot-matrix placeholder (LED-board aesthetic, in
 * the spirit of the dotmatrix loader collection): a grid of dots lit by a
 * ripple expanding from the center with a faint checkerboard shimmer. Kept
 * DOM-free so it is unit-testable; the canvas component consumes it per frame.
 */

export const DOT_MATRIX_SPACING_PX = 14
export const DOT_MATRIX_RADIUS_PX = 2.2

const MIN_ALPHA = 0.08
const RIPPLE_ALPHA_RANGE = 0.85
const RIPPLE_WAVELENGTH = 0.85
const RIPPLE_SPEED_PER_MS = 0.0045
const RIPPLE_SHARPNESS = 2.6
const SHIMMER_ALPHA = 0.05
const SHIMMER_SPEED_PER_MS = 0.0012

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export interface DotMatrixCell {
  col: number
  cols: number
  row: number
  rows: number
  timeMs: number
}

/**
 * Alpha (0..1) for one dot at one point in time: a ripple radiating from the
 * grid center, sharpened so the wavefront reads as a ring of lit dots, plus a
 * subtle positional shimmer so the field never looks frozen between rings.
 */
export const getDotMatrixAlpha = ({
  col,
  cols,
  row,
  rows,
  timeMs
}: DotMatrixCell): number => {
  const centerCol = (cols - 1) / 2
  const centerRow = (rows - 1) / 2
  const distance = Math.hypot(col - centerCol, row - centerRow)
  const ripplePhase =
    distance * RIPPLE_WAVELENGTH - timeMs * RIPPLE_SPEED_PER_MS
  const rippleWave = (Math.sin(ripplePhase) + 1) / 2
  const ripple = rippleWave ** RIPPLE_SHARPNESS
  const shimmer =
    Math.sin((col * 7 + row * 13) * 0.7 + timeMs * SHIMMER_SPEED_PER_MS) *
    SHIMMER_ALPHA

  return clamp01(MIN_ALPHA + ripple * RIPPLE_ALPHA_RANGE + shimmer)
}

/** Static alpha used when the user prefers reduced motion. */
export const getDotMatrixStaticAlpha = (cell: DotMatrixCell): number =>
  getDotMatrixAlpha({ ...cell, timeMs: 0 })
