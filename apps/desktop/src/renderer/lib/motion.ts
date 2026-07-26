import { useEffect, useReducer, useRef } from "react"

/**
 * The chat motion language (see DESIGN.md → Motion). Restrained, fast, one
 * directional: motion only explains what changed and where it came from.
 *
 * Three hard rules the tokens encode:
 * 1. ≤240ms, ≤12px travel, no bounce/overshoot.
 * 2. Hot paths animate transform/opacity only — never layout during streaming.
 * 3. One-time entrances play only for elements that genuinely just appeared;
 *    history load, session switch and remounts must not replay them (see
 *    {@link useEntranceGuard}).
 */

/** ease-out-quart variant — the single curve every transition uses. */
export const MOTION_EASE = [0.25, 0.1, 0.25, 1] as const

export const MOTION_DURATION = {
  /** Fades and small-travel entrances. */
  base: 0.18,
  /**
   * One-time page-level entrances (home, settings). Deliberately outside the
   * ≤240ms chat budget: those two surfaces predate this language and keep it.
   */
  entrance: 0.32,
  /** Hover/press color, icon and label swaps. */
  fast: 0.12,
  /** Disclosure height, panel content choreography. */
  gentle: 0.24
} as const

/** Entrance travel for a normal surface. */
export const MOTION_RISE_PX = 8
/** Entrance travel for a dense row (tool trace, queue item). */
export const MOTION_ROW_RISE_PX = 4
/** Largest travel allowed anywhere — the side panel content slide. */
export const MOTION_SLIDE_PX = 12

const MOTION_TRANSITION_BASE = {
  duration: MOTION_DURATION.base,
  ease: MOTION_EASE
} as const

const MOTION_TRANSITION_FAST = {
  duration: MOTION_DURATION.fast,
  ease: MOTION_EASE
} as const

/** Plain fade. */
export const MOTION_FADE_IN = {
  animate: { opacity: 1 },
  initial: { opacity: 0 },
  transition: MOTION_TRANSITION_BASE
} as const

/** Fade at `fast`, for label and icon swaps. */
export const MOTION_FADE_IN_FAST = {
  animate: { opacity: 1 },
  initial: { opacity: 0 },
  transition: MOTION_TRANSITION_FAST
} as const

/** Fade + 8px rise — the default entrance. */
export const MOTION_RISE_IN = {
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: MOTION_RISE_PX },
  transition: MOTION_TRANSITION_BASE
} as const

/** Fade + 4px rise — the dense-row entrance. */
export const MOTION_ROW_RISE_IN = {
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: MOTION_ROW_RISE_PX },
  transition: MOTION_TRANSITION_BASE
} as const

/** Fade + scale 0.9→1, for elements that pop into an existing layout. */
export const MOTION_SCALE_IN = {
  animate: { opacity: 1, scale: 1 },
  initial: { opacity: 0, scale: 0.9 },
  transition: MOTION_TRANSITION_BASE
} as const

/*
 * CSS-driven equivalents. Written as literal strings so Tailwind's source scan
 * picks up the arbitrary values, and always paired with a `motion-reduce`
 * escape hatch since these bypass `MotionConfig`.
 */
const MOTION_EASE_CLASS = "ease-[cubic-bezier(0.25,0.1,0.25,1)]"

/** Retunes an existing `transition-*` utility to `fast`. */
export const MOTION_TRANSITION_FAST_CLASS = `duration-[120ms] ${MOTION_EASE_CLASS} motion-reduce:transition-none`

/** Retunes an existing `transition-*` utility to `gentle`. */
export const MOTION_TRANSITION_GENTLE_CLASS = `duration-[240ms] ${MOTION_EASE_CLASS} motion-reduce:transition-none`

/** CSS entrance: plain fade at `base`. */
export const MOTION_FADE_IN_CLASS = `animate-in fade-in duration-[180ms] ${MOTION_EASE_CLASS} motion-reduce:animate-none`

/** CSS entrance: fade + 8px rise at `base`. */
export const MOTION_RISE_IN_CLASS = `animate-in fade-in slide-in-from-bottom-2 duration-[180ms] ${MOTION_EASE_CLASS} motion-reduce:animate-none`

/** CSS entrance: fade + scale 0.9→1 at `base`. */
export const MOTION_SCALE_IN_CLASS = `animate-in fade-in zoom-in-90 duration-[180ms] ${MOTION_EASE_CLASS} motion-reduce:animate-none`

/** CSS entrance: fade + scale 0.95→1 at `base`, for inline chips. */
export const MOTION_CHIP_IN_CLASS = `animate-in fade-in zoom-in-95 duration-[180ms] ${MOTION_EASE_CLASS} motion-reduce:animate-none`

export interface SeenTracker {
  hasSeen: (id: string) => boolean
  markSeen: (id: string) => void
}

/** Remembers which ids a list has already rendered. Pure, so it is unit-tested. */
export const createSeenTracker = (
  knownIds: Iterable<string> = []
): SeenTracker => {
  const seen = new Set(knownIds)

  return {
    hasSeen: (id) => seen.has(id),
    markSeen: (id) => {
      seen.add(id)
    }
  }
}

// Long enough to cover the slowest entrance preset, short enough that a list
// never carries a stale entrance class into the next interaction.
const ENTRANCE_WINDOW_MS = MOTION_DURATION.gentle * 1000

/**
 * Decides which list items may play their entrance. Ids present on the first
 * render — or on the render where `resetKey` changes — never animate, so
 * history load and session switches stay still; ids that appear afterwards are
 * reported as entering for one animation window and then forgotten, so a CSS
 * entrance cannot replay when a hidden ancestor becomes visible again.
 */
export const useEntranceGuard = ({
  ids,
  resetKey
}: {
  ids: readonly string[]
  resetKey?: string
}): ((id: string) => boolean) => {
  const trackerRef = useRef<SeenTracker | null>(null)
  const resetKeyRef = useRef(resetKey)
  const isPrimedRef = useRef(false)
  const enteringIdsRef = useRef(new Set<string>())
  const forgetTimeoutIdRef = useRef<number | null>(null)
  const [, forgetEnteringIds] = useReducer((version: number) => version + 1, 0)

  if (trackerRef.current === null || resetKeyRef.current !== resetKey) {
    resetKeyRef.current = resetKey
    trackerRef.current = createSeenTracker()
    isPrimedRef.current = false
    enteringIdsRef.current = new Set()
  }

  const tracker = trackerRef.current

  // Collected during render so the entering item carries its animation on its
  // very first paint; the set dedupes, which keeps StrictMode's double render
  // and any re-render before the window closes on the same answer.
  if (isPrimedRef.current) {
    for (const id of ids) {
      if (!tracker.hasSeen(id)) {
        enteringIdsRef.current.add(id)
      }
    }
  }

  useEffect(() => {
    for (const id of ids) {
      tracker.markSeen(id)
    }

    isPrimedRef.current = true

    if (
      enteringIdsRef.current.size === 0 ||
      forgetTimeoutIdRef.current !== null
    ) {
      return
    }

    forgetTimeoutIdRef.current = window.setTimeout(() => {
      forgetTimeoutIdRef.current = null
      enteringIdsRef.current = new Set()
      forgetEnteringIds()
    }, ENTRANCE_WINDOW_MS)
  })

  useEffect(
    () => () => {
      if (forgetTimeoutIdRef.current !== null) {
        window.clearTimeout(forgetTimeoutIdRef.current)
      }
    },
    []
  )

  return (id) => enteringIdsRef.current.has(id)
}

/**
 * True once `value` differs from what it was on this component's first render.
 * Lets a swap (label, icon, answered state) cross-fade without the fade also
 * playing when the settled result is simply mounted from history.
 */
export const useHasChangedSinceMount = <T>(value: T): boolean => {
  const mountValueRef = useRef(value)

  return mountValueRef.current !== value
}
