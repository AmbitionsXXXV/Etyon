import { useI18n } from "@etyon/i18n/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import type { TargetAndTransition, Transition } from "motion/react"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import {
  DOT_MATRIX_RADIUS_PX,
  DOT_MATRIX_SPACING_PX,
  getDotMatrixAlpha
} from "@/renderer/lib/chat/dot-matrix"
import {
  BORDER_PULSE_DURATION_MS,
  DESCENT_PARAMS,
  EASE_DESCENT,
  EASE_EXPO_OUT,
  EASE_IN_OUT_SINE,
  FIRST_DOT_ORIGIN_RATIO,
  FIRST_DOT_PARAMS,
  FIRST_LIGHT_PHASE_DURATIONS_MS,
  getLandingPoint,
  getOriginPoint,
  getPhaseStartMs,
  getRingMaxDiameterPx,
  GREETING_PARAMS,
  LANDING_RING_PARAMS,
  RIPPLE_PARAMS,
  REDUCED_MOTION_FADE_MS,
  REVEAL_PARAMS,
  SKIP_REVEAL_MS
} from "@/renderer/lib/first-light/timeline"
import type {
  FirstLightMode,
  FirstLightPhase,
  FirstLightPoint,
  FirstLightRect
} from "@/renderer/lib/first-light/timeline"
import { rpcClient } from "@/renderer/lib/rpc"

const OVERLAY_Z_INDEX = 2_147_483_000
const DOT_DIAMETER_PX = 2 * DOT_MATRIX_RADIUS_PX * FIRST_DOT_PARAMS.radiusScale
const TWO_PI = Math.PI * 2

// Dark scrim shown over macOS liquid glass so the desktop stays faintly visible;
// mirrors the dark liquid-glass surface hue at ~65% alpha.
const LIQUID_GLASS_SCRIM = "oklch(12% 0.005 285.823 / 0.65)"

const RING_KEYS = ["first-light-ring-inner", "first-light-ring-outer"]
const ANCHOR_SELECTOR = "[data-first-light-anchor]"
// The composer is a tiptap editor; its ProseMirror root is the contenteditable.
const COMPOSER_FOCUS_SELECTOR = `${ANCHOR_SELECTOR} [contenteditable="true"]`

type RevealKind = "normal" | "reduced" | "skip"
type AppRevealState = "active" | "done" | "enter" | "hidden"
type OverlayPhase = FirstLightPhase | "done"

interface FirstLightGeometry {
  anchorRect: FirstLightRect | null
  dotDelta: FirstLightPoint
  landing: FirstLightPoint
  ringMaxDiameterPx: number
}

const REVEAL_DURATION_MS: Record<RevealKind, number> = {
  normal: REVEAL_PARAMS.overlayDissolveMs,
  reduced: REDUCED_MOTION_FADE_MS,
  skip: SKIP_REVEAL_MS
}

const isRevealPhase = (phase: OverlayPhase): boolean =>
  phase === "descent" || phase === "reveal"

const getDotAnimation = (
  phase: OverlayPhase,
  dotDelta: FirstLightPoint
): { animate: TargetAndTransition; transition: Transition } => {
  if (phase === "firstDot") {
    return {
      animate: {
        opacity: FIRST_DOT_PARAMS.breathAlpha,
        scale: FIRST_DOT_PARAMS.breathScale
      },
      transition: {
        duration: FIRST_LIGHT_PHASE_DURATIONS_MS.firstDot / 1000,
        ease: EASE_IN_OUT_SINE,
        times: FIRST_DOT_PARAMS.breathTimes
      }
    }
  }

  if (phase === "greeting") {
    return {
      animate: { opacity: FIRST_DOT_PARAMS.restAlpha, scale: 1, x: 0, y: 0 },
      transition: { duration: 0.3, ease: "easeOut" }
    }
  }

  return {
    animate: {
      opacity: 1,
      scale: DESCENT_PARAMS.landingScale,
      x: dotDelta.x,
      y: dotDelta.y
    },
    transition: {
      duration: DESCENT_PARAMS.durationMs / 1000,
      ease: EASE_DESCENT
    }
  }
}

const getAppContainerStyle = (
  state: AppRevealState,
  kind: RevealKind | null
): CSSProperties | undefined => {
  if (state === "hidden") {
    return { opacity: 0 }
  }

  if (state === "enter") {
    if (kind === "normal") {
      return {
        filter: `blur(${REVEAL_PARAMS.appBlurPx}px)`,
        opacity: 0,
        transform: `scale(${REVEAL_PARAMS.appScaleFrom})`
      }
    }

    return { opacity: 0 }
  }

  if (state === "active") {
    const easing = `cubic-bezier(${EASE_EXPO_OUT.join(",")})`

    if (kind === "normal") {
      const durationMs = REVEAL_PARAMS.appDurationMs

      return {
        filter: "blur(0px)",
        opacity: 1,
        transform: "scale(1)",
        transition: `opacity ${durationMs}ms ${easing}, transform ${durationMs}ms ${easing}, filter ${durationMs}ms ${easing}`
      }
    }

    const fadeMs = kind === "skip" ? SKIP_REVEAL_MS : REDUCED_MOTION_FADE_MS

    return { opacity: 1, transition: `opacity ${fadeMs}ms ease-out` }
  }

  return undefined
}

/**
 * Sparse LED dot-matrix ripple radiating from the first-dot origin. Reuses the
 * chat placeholder's ripple math on a grid centered on the origin so the wave
 * emanates from the light; self-limits after RIPPLE_PARAMS.durationMs.
 */
const FirstLightRipple = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")

    if (!(canvas && context)) {
      return
    }

    const startedAt = performance.now()
    let frameHandle = 0

    const drawFrame = (now: number) => {
      const elapsedMs = now - startedAt
      const devicePixelRatio = window.devicePixelRatio || 1
      const cssWidth = window.innerWidth
      const cssHeight = window.innerHeight
      const width = Math.max(1, Math.round(cssWidth * devicePixelRatio))
      const height = Math.max(1, Math.round(cssHeight * devicePixelRatio))

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      const spacing =
        DOT_MATRIX_SPACING_PX * RIPPLE_PARAMS.spacingScale * devicePixelRatio
      const radius = DOT_MATRIX_RADIUS_PX * devicePixelRatio
      const originX = cssWidth * FIRST_DOT_ORIGIN_RATIO.x * devicePixelRatio
      const originY = cssHeight * FIRST_DOT_ORIGIN_RATIO.y * devicePixelRatio
      const halfCols = Math.ceil(Math.max(originX, width - originX) / spacing)
      const halfRows = Math.ceil(Math.max(originY, height - originY) / spacing)
      const cols = halfCols * 2 + 1
      const rows = halfRows * 2 + 1
      const fadeOutSpan = RIPPLE_PARAMS.durationMs - RIPPLE_PARAMS.fadeInMs
      const envelope =
        elapsedMs < RIPPLE_PARAMS.fadeInMs
          ? elapsedMs / RIPPLE_PARAMS.fadeInMs
          : Math.max(0, 1 - (elapsedMs - RIPPLE_PARAMS.fadeInMs) / fadeOutSpan)

      context.clearRect(0, 0, width, height)
      context.fillStyle = getComputedStyle(canvas).color

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const alpha =
            getDotMatrixAlpha({ col, cols, row, rows, timeMs: elapsedMs }) *
            envelope

          if (alpha <= 0.01) {
            continue
          }

          context.globalAlpha = alpha
          context.beginPath()
          context.arc(
            originX + (col - halfCols) * spacing,
            originY + (row - halfRows) * spacing,
            radius,
            0,
            TWO_PI
          )
          context.fill()
        }
      }

      context.globalAlpha = 1

      if (elapsedMs < RIPPLE_PARAMS.durationMs) {
        frameHandle = requestAnimationFrame(drawFrame)
      }
    }

    frameHandle = requestAnimationFrame(drawFrame)

    return () => cancelAnimationFrame(frameHandle)
  }, [])

  return (
    <canvas
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full text-primary"
      ref={canvasRef}
    />
  )
}

const FirstLightRunner = ({
  children,
  mode
}: {
  children: ReactNode
  mode: FirstLightMode
}) => {
  const prefersReducedMotion = useReducedMotion()
  const { t } = useI18n()
  const [phase, setPhase] = useState<OverlayPhase>("backdrop")
  const [appReveal, setAppReveal] = useState<AppRevealState>("hidden")
  const [revealKind, setRevealKind] = useState<RevealKind | null>(null)
  const [geometry, setGeometry] = useState<FirstLightGeometry | null>(null)
  const [isLiquidGlass] = useState(() =>
    Object.hasOwn(document.documentElement.dataset, "liquidGlass")
  )
  const hasWrittenRef = useRef(false)
  const revealStartedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const timeouts: ReturnType<typeof setTimeout>[] = []
    const frames: number[] = []

    const runLater = (fn: () => void, delayMs: number) => {
      timeouts.push(
        setTimeout(() => {
          if (!cancelled) {
            fn()
          }
        }, delayMs)
      )
    }

    const nextFrame = (fn: () => void) => {
      frames.push(
        requestAnimationFrame(() => {
          if (!cancelled) {
            fn()
          }
        })
      )
    }

    const writeOnboardedOnce = () => {
      if (mode !== "play" || hasWrittenRef.current) {
        return
      }

      hasWrittenRef.current = true
      void (async () => {
        try {
          await rpcClient.settings.update({
            onboardedAt: new Date().toISOString()
          })
        } catch {
          // Best-effort marker: a failed write simply replays the intro later.
        }
      })()
    }

    const finish = () => {
      setPhase("done")
      setAppReveal("done")
    }

    const beginReveal = (kind: RevealKind) => {
      if (revealStartedRef.current) {
        return
      }

      revealStartedRef.current = true
      writeOnboardedOnce()
      setRevealKind(kind)

      if (kind !== "reduced") {
        setPhase("reveal")
      }

      setAppReveal("enter")
      nextFrame(() =>
        nextFrame(() => {
          setAppReveal("active")
          runLater(finish, REVEAL_DURATION_MS[kind])
        })
      )
    }

    const beginDescent = () => {
      const viewport = { height: window.innerHeight, width: window.innerWidth }
      const domRect =
        document.querySelector(ANCHOR_SELECTOR)?.getBoundingClientRect() ?? null
      const rect: FirstLightRect | null = domRect
        ? {
            height: domRect.height,
            left: domRect.left,
            top: domRect.top,
            width: domRect.width
          }
        : null
      const origin = getOriginPoint(viewport)
      const landing = getLandingPoint(rect, viewport)

      setGeometry({
        anchorRect: rect,
        dotDelta: { x: landing.x - origin.x, y: landing.y - origin.y },
        landing,
        ringMaxDiameterPx: getRingMaxDiameterPx(viewport.width)
      })
      setPhase("descent")
      runLater(
        () => beginReveal("normal"),
        FIRST_LIGHT_PHASE_DURATIONS_MS.descent
      )
    }

    const skip = () => {
      if (revealStartedRef.current) {
        return
      }

      for (const handle of timeouts) {
        clearTimeout(handle)
      }
      timeouts.length = 0
      beginReveal("skip")
    }

    if (prefersReducedMotion) {
      beginReveal("reduced")

      return () => {
        cancelled = true
        for (const handle of timeouts) {
          clearTimeout(handle)
        }
        for (const handle of frames) {
          cancelAnimationFrame(handle)
        }
      }
    }

    runLater(() => setPhase("firstDot"), getPhaseStartMs("firstDot"))
    runLater(() => setPhase("greeting"), getPhaseStartMs("greeting"))
    runLater(beginDescent, getPhaseStartMs("descent"))

    const handleSkip = () => skip()
    window.addEventListener("keydown", handleSkip, { capture: true })
    window.addEventListener("pointerdown", handleSkip, { capture: true })

    return () => {
      cancelled = true
      for (const handle of timeouts) {
        clearTimeout(handle)
      }
      for (const handle of frames) {
        cancelAnimationFrame(handle)
      }
      window.removeEventListener("keydown", handleSkip, { capture: true })
      window.removeEventListener("pointerdown", handleSkip, { capture: true })
    }
  }, [mode, prefersReducedMotion])

  useEffect(() => {
    if (appReveal === "done") {
      document.querySelector<HTMLElement>(COMPOSER_FOCUS_SELECTOR)?.focus()
    }
  }, [appReveal])

  const isRevealing = appReveal === "active"
  const overlayDissolveMs = revealKind
    ? REVEAL_DURATION_MS[revealKind]
    : REVEAL_PARAMS.overlayDissolveMs
  const dotDelta = geometry?.dotDelta ?? { x: 0, y: 0 }
  const dot = getDotAnimation(phase, dotDelta)
  const isDotVisible = phase !== "backdrop" && phase !== "done"
  const showLandingEffects = geometry !== null && isRevealPhase(phase)
  const greetingChars = [...t("firstLight.greeting")]

  return (
    <>
      <div
        inert={appReveal === "done" ? undefined : true}
        style={getAppContainerStyle(appReveal, revealKind)}
      >
        {children}
      </div>

      {phase === "done" ? null : (
        <motion.div
          animate={
            isRevealing
              ? { backdropFilter: "blur(0px)", opacity: 0 }
              : {
                  backdropFilter: `blur(${REVEAL_PARAMS.backdropBlurPx}px)`,
                  opacity: 1
                }
          }
          className={isLiquidGlass ? undefined : "bg-background"}
          initial={false}
          style={{
            inset: 0,
            position: "fixed",
            zIndex: OVERLAY_Z_INDEX,
            ...(isLiquidGlass ? { backgroundColor: LIQUID_GLASS_SCRIM } : {})
          }}
          transition={{ duration: overlayDissolveMs / 1000, ease: "easeOut" }}
        >
          {phase === "greeting" ? <FirstLightRipple /> : null}

          {isDotVisible ? (
            <motion.div
              animate={dot.animate}
              aria-hidden
              initial={false}
              style={{
                backgroundColor: "var(--primary)",
                borderRadius: "9999px",
                boxShadow: `0 0 ${FIRST_DOT_PARAMS.glowBlurPx}px var(--primary)`,
                height: DOT_DIAMETER_PX,
                left: "50%",
                marginLeft: -DOT_DIAMETER_PX / 2,
                marginTop: -DOT_DIAMETER_PX / 2,
                position: "fixed",
                top: "42%",
                width: DOT_DIAMETER_PX
              }}
              transition={dot.transition}
            />
          ) : null}

          <AnimatePresence>
            {phase === "greeting" ? (
              <motion.div
                animate={{ opacity: 1, x: "-50%", y: 0 }}
                className="text-2xl text-foreground"
                exit={{
                  opacity: 0,
                  x: "-50%",
                  y: GREETING_PARAMS.exitOffsetYPx
                }}
                initial={{ opacity: 1, x: "-50%", y: 0 }}
                key="first-light-greeting"
                style={{
                  left: "50%",
                  position: "fixed",
                  top: `calc(42% + ${GREETING_PARAMS.offsetBelowDotPx}px)`,
                  whiteSpace: "pre"
                }}
                transition={{
                  duration: GREETING_PARAMS.exitDurationMs / 1000,
                  ease: "easeIn"
                }}
              >
                {greetingChars.map((char, index) => (
                  <motion.span
                    animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
                    initial={{
                      filter: `blur(${GREETING_PARAMS.charBlurPx}px)`,
                      opacity: 0,
                      y: GREETING_PARAMS.charOffsetYPx
                    }}
                    key={`${char}-${index}`}
                    style={{ display: "inline-block", whiteSpace: "pre" }}
                    transition={{
                      delay: (index * GREETING_PARAMS.charStaggerMs) / 1000,
                      duration: GREETING_PARAMS.charDurationMs / 1000,
                      ease: "easeOut"
                    }}
                  >
                    {char}
                  </motion.span>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {showLandingEffects && geometry
            ? RING_KEYS.map((ringKey, index) => (
                <motion.div
                  animate={{ opacity: 0, scale: 1 }}
                  aria-hidden
                  initial={{
                    opacity: LANDING_RING_PARAMS.startAlpha,
                    scale: 0
                  }}
                  key={ringKey}
                  style={{
                    border: `${LANDING_RING_PARAMS.strokePx}px solid var(--primary)`,
                    borderRadius: "9999px",
                    height: geometry.ringMaxDiameterPx,
                    left: geometry.landing.x,
                    marginLeft: -geometry.ringMaxDiameterPx / 2,
                    marginTop: -geometry.ringMaxDiameterPx / 2,
                    pointerEvents: "none",
                    position: "fixed",
                    top: geometry.landing.y,
                    width: geometry.ringMaxDiameterPx
                  }}
                  transition={{
                    delay:
                      (DESCENT_PARAMS.durationMs +
                        index * LANDING_RING_PARAMS.staggerMs) /
                      1000,
                    duration: LANDING_RING_PARAMS.durationMs / 1000,
                    ease: EASE_EXPO_OUT
                  }}
                />
              ))
            : null}

          {showLandingEffects && geometry?.anchorRect ? (
            <motion.div
              animate={{ opacity: [0, 0.8, 0] }}
              aria-hidden
              initial={{ opacity: 0 }}
              style={{
                border: "1px solid var(--primary)",
                borderRadius: 16,
                height: geometry.anchorRect.height,
                left: geometry.anchorRect.left,
                pointerEvents: "none",
                position: "fixed",
                top: geometry.anchorRect.top,
                width: geometry.anchorRect.width
              }}
              transition={{
                delay: DESCENT_PARAMS.durationMs / 1000,
                duration: BORDER_PULSE_DURATION_MS / 1000,
                ease: "easeOut"
              }}
            />
          ) : null}
        </motion.div>
      )}
    </>
  )
}

export const FirstLightGate = ({
  children,
  mode
}: {
  children: ReactNode
  mode: FirstLightMode
}) => {
  if (mode === "off") {
    return children
  }

  return <FirstLightRunner mode={mode}>{children}</FirstLightRunner>
}
