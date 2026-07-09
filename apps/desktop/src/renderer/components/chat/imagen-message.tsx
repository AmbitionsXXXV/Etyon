import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { Tooltip } from "@heroui/react"
import {
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  RotateRight01Icon,
  Tick02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"

import { DotMatrixPlaceholder } from "@/renderer/components/chat/dot-matrix-placeholder"
import {
  getImageFileName,
  getImagenPartState,
  stepImageZoom
} from "@/renderer/lib/chat/imagen-message"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { orpc } from "@/renderer/lib/rpc"

const ImagenSkeleton = ({
  aspectRatio,
  label
}: {
  aspectRatio: number
  label: string
}) => (
  <div
    className="relative w-full max-w-sm overflow-hidden rounded-xl border border-border/70 bg-muted/40"
    style={{ aspectRatio }}
  >
    <DotMatrixPlaceholder />
    <span className="absolute inset-x-0 bottom-2 text-center font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
      {label}
    </span>
  </div>
)

const COPY_FEEDBACK_RESET_MS = 1600
const CLICK_ZOOM = 2
const DRAG_SUPPRESS_CLICK_PX = 4
const QUARTER_TURN_DEGREES = 90
const FULL_TURN_DEGREES = 360
// Fit box inside the viewport, leaving room for the toolbar and close button.
const FIT_MAX_WIDTH = "calc(100vw - 48px)"
const FIT_MAX_HEIGHT = "calc(100vh - 112px)"
const SIDEWAYS_FIT_MAX_WIDTH = "calc(100vh - 112px)"
const SIDEWAYS_FIT_MAX_HEIGHT = "calc(100vw - 48px)"

interface LightboxDragStart {
  offsetX: number
  offsetY: number
  pointerX: number
  pointerY: number
}

const LightboxActionButton = ({
  className,
  icon,
  label,
  onPress
}: {
  className?: string
  icon: typeof Cancel01Icon
  label: string
  onPress: () => void
}) => (
  <Tooltip>
    <Tooltip.Trigger>
      <button
        aria-label={label}
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60",
          className
        )}
        onClick={onPress}
        type="button"
      >
        <HugeiconsIcon icon={icon} size={16} strokeWidth={2} />
      </button>
    </Tooltip.Trigger>
    <Tooltip.Content placement="top">{label}</Tooltip.Content>
  </Tooltip>
)

/** Copies the rendered image to the clipboard as a PNG. */
const copyImageToClipboard = async (image: HTMLImageElement) => {
  const canvas = document.createElement("canvas")

  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext("2d")?.drawImage(image, 0, 0)

  const dataUrl = canvas.toDataURL("image/png")
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
  const bytes = Uint8Array.from(
    atob(base64),
    (char) => char.codePointAt(0) ?? 0
  )
  const blob = new Blob([bytes], { type: "image/png" })

  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}

/**
 * Full-screen viewer for a generated image: zoom (buttons, click to toggle,
 * drag-to-pan), 90° rotation, copy, and download. Esc, the backdrop, and the
 * close button all dismiss it.
 */
const ImagenLightbox = ({
  alt,
  fileName,
  onClose,
  src
}: {
  alt: string
  fileName: string
  onClose: () => void
  src: string
}) => {
  const { t } = useI18n({ keyPrefix: "chat.imagen" })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragStartRef = useRef<LightboxDragStart | null>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!isCopied) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsCopied(false)
    }, COPY_FEEDBACK_RESET_MS)

    return () => window.clearTimeout(timeoutId)
  }, [isCopied])

  const resetView = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  const handleZoom = (direction: "in" | "out") => {
    const nextZoom = stepImageZoom(zoom, direction)

    setZoom(nextZoom)

    if (nextZoom <= 1) {
      setOffset({ x: 0, y: 0 })
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (zoom <= 1) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = {
      offsetX: offset.x,
      offsetY: offset.y,
      pointerX: event.clientX,
      pointerY: event.clientY
    }
    didDragRef.current = false
    setIsDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current

    if (!start) {
      return
    }

    const deltaX = event.clientX - start.pointerX
    const deltaY = event.clientY - start.pointerY

    if (Math.abs(deltaX) + Math.abs(deltaY) > DRAG_SUPPRESS_CLICK_PX) {
      didDragRef.current = true
    }

    setOffset({ x: start.offsetX + deltaX, y: start.offsetY + deltaY })
  }

  const endDrag = () => {
    dragStartRef.current = null
    setIsDragging(false)
  }

  // A click toggles fit <-> zoomed-in, but not the click that ends a pan.
  const handleImageClick = () => {
    if (didDragRef.current) {
      didDragRef.current = false

      return
    }

    if (zoom === 1) {
      setZoom(CLICK_ZOOM)
    } else {
      resetView()
    }
  }

  const handleCopy = async () => {
    const image = imageRef.current

    if (!(image && navigator.clipboard)) {
      return
    }

    try {
      await copyImageToClipboard(image)
      setIsCopied(true)
    } catch {
      setIsCopied(false)
    }
  }

  const handleDownload = () => {
    const link = document.createElement("a")

    link.href = src
    link.download = fileName
    link.click()
  }

  const isSideways = rotation % (QUARTER_TURN_DEGREES * 2) !== 0
  // Fit constraints stay on the img; the transform lives on the wrapping
  // button so the pan/click hit area follows the zoomed and rotated image.
  const fitStyle: CSSProperties = {
    maxHeight: isSideways ? SIDEWAYS_FIT_MAX_HEIGHT : FIT_MAX_HEIGHT,
    maxWidth: isSideways ? SIDEWAYS_FIT_MAX_WIDTH : FIT_MAX_WIDTH
  }
  const transformStyle: CSSProperties = {
    transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`
  }
  const idleCursorClass = zoom > 1 ? "cursor-grab" : "cursor-zoom-in"

  // Portaled to <body>: transformed ancestors in the message tree would
  // otherwise become the containing block and clip the fixed overlay.
  return createPortal(
    <dialog
      aria-label={alt}
      aria-modal="true"
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none border-0 bg-black/85 p-0 backdrop-blur-sm"
      open
    >
      <button
        aria-label={t("close")}
        className="absolute inset-0 cursor-zoom-out"
        onClick={onClose}
        type="button"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <button
          aria-label={zoom === 1 ? t("zoomIn") : t("zoomReset")}
          className={cn(
            "pointer-events-auto rounded-lg border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-white/60",
            isDragging
              ? "cursor-grabbing"
              : `${idleCursorClass} transition-transform duration-200 ease-out`
          )}
          onClick={handleImageClick}
          onPointerCancel={endDrag}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          style={transformStyle}
          type="button"
        >
          <img
            alt={alt}
            className="rounded-lg object-contain shadow-2xl"
            draggable={false}
            ref={imageRef}
            src={src}
            style={fitStyle}
          />
        </button>
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-zinc-900/80 px-1.5 py-1 shadow-lg backdrop-blur-md">
        <LightboxActionButton
          icon={ZoomOutAreaIcon}
          label={t("zoomOut")}
          onPress={() => handleZoom("out")}
        />
        <Tooltip>
          <Tooltip.Trigger>
            <button
              aria-label={t("zoomReset")}
              className="min-w-12 rounded-full px-1 py-1.5 text-center font-mono text-[11px] text-white/75 tabular-nums transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
              onClick={resetView}
              type="button"
            >
              {Math.round(zoom * 100)}%
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="top">{t("zoomReset")}</Tooltip.Content>
        </Tooltip>
        <LightboxActionButton
          icon={ZoomInAreaIcon}
          label={t("zoomIn")}
          onPress={() => handleZoom("in")}
        />
        <div className="mx-1 h-4 w-px bg-white/15" />
        <LightboxActionButton
          icon={RotateRight01Icon}
          label={t("rotate")}
          onPress={() =>
            setRotation(
              (value) => (value + QUARTER_TURN_DEGREES) % FULL_TURN_DEGREES
            )
          }
        />
        <div className="mx-1 h-4 w-px bg-white/15" />
        <LightboxActionButton
          className={isCopied ? "text-emerald-400 hover:text-emerald-300" : ""}
          icon={isCopied ? Tick02Icon : Copy01Icon}
          label={isCopied ? t("copied") : t("copy")}
          onPress={() => void handleCopy()}
        />
        <LightboxActionButton
          icon={Download01Icon}
          label={t("download")}
          onPress={handleDownload}
        />
      </div>
      <div className="absolute top-3 right-3">
        <LightboxActionButton
          className="size-9 bg-white/5"
          icon={Cancel01Icon}
          label={t("close")}
          onPress={onClose}
        />
      </div>
    </dialog>,
    document.body
  )
}

/** Renders a generated image inline in the assistant message. */
export const ImagenMessageImage = ({
  part,
  sessionId
}: {
  part: ChatToolPart
  sessionId: string
}) => {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)
  const state = getImagenPartState(part)
  const isPublished = state?.phase === "published"
  const fileQueryOptions = useMemo(
    () =>
      orpc.projectSnapshots.readBinaryFile.queryOptions({
        input: { filePath: state?.path ?? "", sessionId }
      }),
    [state?.path, sessionId]
  )
  const fileQuery = useQuery({
    ...fileQueryOptions,
    enabled: isPublished && Boolean(state?.path)
  })
  const dataUri = fileQuery.data
    ? `data:${fileQuery.data.mediaType};base64,${fileQuery.data.base64}`
    : null

  if (!state) {
    return null
  }

  if (state.phase === "error") {
    return (
      <div className="inline-flex max-w-full flex-col gap-0.5 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
        <span className="font-medium text-danger">
          {t("chat.imagen.failed")}
        </span>
        {state.errorMessage ? (
          <span className="break-all text-muted-foreground">
            {state.errorMessage}
          </span>
        ) : null}
      </div>
    )
  }

  if (!(isPublished && dataUri)) {
    return (
      <ImagenSkeleton
        aspectRatio={state.aspectRatio}
        label={t("chat.imagen.generating")}
      />
    )
  }

  const alt = state.title || t("chat.imagen.generating")

  return (
    <>
      <button
        aria-label={t("chat.imagen.viewFull")}
        className="block max-w-md cursor-zoom-in overflow-hidden rounded-xl border border-border/70 bg-transparent p-0"
        onClick={() => setIsExpanded(true)}
        type="button"
      >
        <img
          alt={alt}
          className="max-h-96 w-full object-contain"
          src={dataUri}
        />
      </button>
      {isExpanded ? (
        <ImagenLightbox
          alt={alt}
          fileName={getImageFileName(state.path)}
          onClose={() => setIsExpanded(false)}
          src={dataUri}
        />
      ) : null}
    </>
  )
}
