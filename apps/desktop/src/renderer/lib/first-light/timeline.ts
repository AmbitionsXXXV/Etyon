/**
 * Pure timing + geometry for the "First Light" first-run animation. Kept DOM-,
 * rpc- and window-free so it stays unit-testable; the overlay component consumes
 * these constants and helpers per phase. Storyboard reference: the P0–P4 table in
 * plans/first-light-install-experience.md.
 */

export type FirstLightMode = "off" | "play" | "preview"

/**
 * Maps the `firstRun` query param to a run mode: `"1"` plays and writes
 * onboardedAt, `"preview"` plays without writing (dev/QA), anything else is off.
 */
export const parseFirstLightMode = (value: null | string): FirstLightMode => {
  if (value === "1") {
    return "play"
  }

  if (value === "preview") {
    return "preview"
  }

  return "off"
}

// Storyboard phases P0–P4. Durations sum to FIRST_LIGHT_TOTAL_MS (~4s).
export type FirstLightPhase =
  | "backdrop"
  | "descent"
  | "firstDot"
  | "greeting"
  | "reveal"

// Chronological order (not alphabetical) — drives phase scheduling.
export const FIRST_LIGHT_PHASE_ORDER: readonly FirstLightPhase[] = [
  "backdrop",
  "firstDot",
  "greeting",
  "descent",
  "reveal"
]

export const FIRST_LIGHT_PHASE_DURATIONS_MS: Record<FirstLightPhase, number> = {
  backdrop: 350,
  descent: 600,
  firstDot: 1150,
  greeting: 1100,
  reveal: 800
}

export const FIRST_LIGHT_TOTAL_MS = FIRST_LIGHT_PHASE_ORDER.reduce(
  (total, phase) => total + FIRST_LIGHT_PHASE_DURATIONS_MS[phase],
  0
)

/** Elapsed ms from animation start to the beginning of a given phase. */
export const getPhaseStartMs = (phase: FirstLightPhase): number => {
  let start = 0

  for (const current of FIRST_LIGHT_PHASE_ORDER) {
    if (current === phase) {
      return start
    }

    start += FIRST_LIGHT_PHASE_DURATIONS_MS[current]
  }

  return start
}

// Compressed reveal when the user skips, and the flat fade for reduced motion.
export const SKIP_REVEAL_MS = 250
export const REDUCED_MOTION_FADE_MS = 300

export interface FirstLightViewport {
  height: number
  width: number
}

// DOMRect-like landing target (only the fields the geometry helpers need).
export interface FirstLightRect {
  height: number
  left: number
  top: number
  width: number
}

export interface FirstLightPoint {
  x: number
  y: number
}

// Viewport-relative anchors: the first dot lights at (50%, 42%); the landing
// falls back to (50%, 78%) when the composer anchor rect is unavailable.
export const FIRST_DOT_ORIGIN_RATIO: FirstLightPoint = { x: 0.5, y: 0.42 }
export const LANDING_FALLBACK_RATIO: FirstLightPoint = { x: 0.5, y: 0.78 }

export const getOriginPoint = (
  viewport: FirstLightViewport
): FirstLightPoint => ({
  x: viewport.width * FIRST_DOT_ORIGIN_RATIO.x,
  y: viewport.height * FIRST_DOT_ORIGIN_RATIO.y
})

/** Landing point for the descending dot: composer center, else viewport fallback. */
export const getLandingPoint = (
  rect: FirstLightRect | null,
  viewport: FirstLightViewport
): FirstLightPoint => {
  if (rect) {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  }

  return {
    x: viewport.width * LANDING_FALLBACK_RATIO.x,
    y: viewport.height * LANDING_FALLBACK_RATIO.y
  }
}

/** Final diameter of the landing rings: 40vw capped at 480px. */
export const getRingMaxDiameterPx = (viewportWidth: number): number =>
  Math.min(viewportWidth * 0.4, 480)

// Cubic-bezier easings (motion BezierDefinition tuples).
export const EASE_IN_OUT_SINE: [number, number, number, number] = [
  0.37, 0, 0.63, 1
]
export const EASE_EXPO_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]
export const EASE_DESCENT: [number, number, number, number] = [0.5, 0, 0.9, 0.2]

// P1 — single LED dot, radius = radiusScale × DOT_MATRIX_RADIUS_PX, breathing
// two beats over the phase (scale + alpha keyframes with easeInOutSine).
export const FIRST_DOT_PARAMS = {
  breathAlpha: [0.5, 1, 0.65, 1, 0.65] as number[],
  breathScale: [1, 1.4, 1, 1.4, 1] as number[],
  breathTimes: [0, 0.25, 0.5, 0.75, 1] as number[],
  glowBlurPx: 24,
  radiusScale: 2,
  restAlpha: 0.65
}

// P2 — greeting appears per character below the dot, then dwells and exits.
export const GREETING_PARAMS = {
  charBlurPx: 6,
  charDurationMs: 220,
  charOffsetYPx: 4,
  charStaggerMs: 30,
  exitDurationMs: 250,
  exitOffsetYPx: -8,
  offsetBelowDotPx: 32
}

// P2 — sparse dot-matrix ripple around the dot (reuses getDotMatrixAlpha).
export const RIPPLE_PARAMS = {
  durationMs: 900,
  fadeInMs: 150,
  spacingScale: 2
}

// P3 — descent to the composer.
export const DESCENT_PARAMS = {
  durationMs: 450,
  landingScale: 0.8
}

// P3 — two expanding rings at the landing point, staggered.
export const LANDING_RING_PARAMS = {
  count: 2,
  durationMs: 600,
  staggerMs: 90,
  startAlpha: 0.5,
  strokePx: 1
}

export const BORDER_PULSE_DURATION_MS = 300

// P4 — overlay dissolves while the app container reveals as one unit.
export const REVEAL_PARAMS = {
  appBlurPx: 6,
  appDurationMs: 350,
  appScaleFrom: 0.985,
  backdropBlurPx: 8,
  overlayDissolveMs: 400
}

// P4 v1.5 — per-region staggered reveal. Each top-level region (sidebar, inset)
// animates opacity/scale/blur with WAAPI, ordered by distance from its center to
// the landing point, so the UI blooms outward from where the dot lands.
export const REGION_REVEAL_PARAMS = {
  blurPx: 6,
  durationMs: 350,
  scaleFrom: 0.985,
  staggerMs: 70
}

/** Region reveal order: indices of `rects` sorted nearest-first to `landing`. */
export const orderRegionsByDistanceToLanding = (
  rects: readonly FirstLightRect[],
  landing: FirstLightPoint
): number[] =>
  rects
    .map((rect, index) => ({
      distanceSq:
        (rect.left + rect.width / 2 - landing.x) ** 2 +
        (rect.top + rect.height / 2 - landing.y) ** 2,
      index
    }))
    .toSorted((a, b) => a.distanceSq - b.distanceSq)
    .map((entry) => entry.index)

/** Total ms a staggered region reveal spans (0 when there are no regions). */
export const getRegionRevealTotalMs = (regionCount: number): number =>
  regionCount > 0
    ? (regionCount - 1) * REGION_REVEAL_PARAMS.staggerMs +
      REGION_REVEAL_PARAMS.durationMs
    : 0

// P4 v1.5 — caret hand-off: when the dot lands on the composer it fades in place
// and a caret-shaped bar blinks once at the landing point until focus takes over.
export const CARET_HANDOFF_PARAMS = {
  blinkMs: 500,
  dotFadeMs: 200,
  heightEm: 1.25,
  widthPx: 2
}
