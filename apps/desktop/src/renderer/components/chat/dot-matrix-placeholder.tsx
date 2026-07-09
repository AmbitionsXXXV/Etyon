import { cn } from "@etyon/ui/lib/utils"
import { useEffect, useRef } from "react"

import {
  DOT_MATRIX_RADIUS_PX,
  DOT_MATRIX_SPACING_PX,
  getDotMatrixAlpha,
  getDotMatrixStaticAlpha
} from "@/renderer/lib/chat/dot-matrix"

const TWO_PI = Math.PI * 2

/**
 * Animated LED-style dot grid that fills its container. The dot color follows
 * the element's computed `color` (style with text-* utilities); reduced-motion
 * users get a static frame instead of the ripple.
 */
export const DotMatrixPlaceholder = ({ className }: { className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")

    if (!(canvas && context)) {
      return
    }

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    )
    let frameHandle = 0

    const drawFrame = (timeMs: number) => {
      const devicePixelRatio = window.devicePixelRatio || 1
      const { clientHeight, clientWidth } = canvas
      const width = Math.max(1, Math.round(clientWidth * devicePixelRatio))
      const height = Math.max(1, Math.round(clientHeight * devicePixelRatio))

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      const spacing = DOT_MATRIX_SPACING_PX * devicePixelRatio
      const radius = DOT_MATRIX_RADIUS_PX * devicePixelRatio
      const cols = Math.max(1, Math.floor(width / spacing))
      const rows = Math.max(1, Math.floor(height / spacing))
      const offsetX = (width - (cols - 1) * spacing) / 2
      const offsetY = (height - (rows - 1) * spacing) / 2
      const dotColor = getComputedStyle(canvas).color
      const isStatic = reducedMotionQuery.matches

      context.clearRect(0, 0, width, height)
      context.fillStyle = dotColor

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const cell = { col, cols, row, rows, timeMs }

          context.globalAlpha = isStatic
            ? getDotMatrixStaticAlpha(cell)
            : getDotMatrixAlpha(cell)
          context.beginPath()
          context.arc(
            offsetX + col * spacing,
            offsetY + row * spacing,
            radius,
            0,
            TWO_PI
          )
          context.fill()
        }
      }

      context.globalAlpha = 1
    }

    const renderLoop = (timeMs: number) => {
      drawFrame(timeMs)

      if (!reducedMotionQuery.matches) {
        frameHandle = requestAnimationFrame(renderLoop)
      }
    }

    frameHandle = requestAnimationFrame(renderLoop)

    const handleMotionPreferenceChange = () => {
      cancelAnimationFrame(frameHandle)
      frameHandle = requestAnimationFrame(renderLoop)
    }

    reducedMotionQuery.addEventListener("change", handleMotionPreferenceChange)

    return () => {
      cancelAnimationFrame(frameHandle)
      reducedMotionQuery.removeEventListener(
        "change",
        handleMotionPreferenceChange
      )
    }
  }, [])

  return (
    <canvas
      aria-hidden
      className={cn("h-full w-full text-muted-foreground", className)}
      ref={canvasRef}
    />
  )
}
