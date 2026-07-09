import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { getString, isRecord } from "@/renderer/lib/utils"

/**
 * Generated images render inline in the assistant message (not in the artifact
 * side panel). This derives what the inline image component needs from an
 * `imagen` tool part across its lifecycle: an aspect-ratio skeleton while
 * generating, the image once its file lands, or a failure state on error.
 */

export type ImagenPhase = "error" | "generating" | "published"

export interface ImagenPartState {
  aspectRatio: number
  // The underlying failure reason (e.g. the gateway's error) for the error
  // phase, so the inline card can say more than "generation failed".
  errorMessage?: string
  path: string
  phase: ImagenPhase
  title: string
}

const DEFAULT_IMAGE_ASPECT_RATIO = 1
const IMAGE_SIZE_PATTERN = /^(?<width>\d+)\s*[x×]\s*(?<height>\d+)$/u
const IMAGEN_FAILED_STATES = new Set(["output-denied", "output-error"])
const IMAGEN_ERROR_MAX_LENGTH = 200
const DEFAULT_IMAGE_FILE_NAME = "image.png"

/**
 * Lightbox zoom stops. 1 means "fit to window"; the stops are discrete so
 * stepping is predictable and the percent readout stays tidy (50%–400%).
 */
const IMAGE_ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4]

export const [IMAGE_ZOOM_MIN] = IMAGE_ZOOM_LEVELS
export const IMAGE_ZOOM_MAX = IMAGE_ZOOM_LEVELS.at(-1) ?? 1

/** The adjacent zoom stop in the given direction, clamped at the ends. */
export const stepImageZoom = (
  zoom: number,
  direction: "in" | "out"
): number => {
  if (direction === "in") {
    return IMAGE_ZOOM_LEVELS.find((level) => level > zoom) ?? IMAGE_ZOOM_MAX
  }

  return IMAGE_ZOOM_LEVELS.findLast((level) => level < zoom) ?? IMAGE_ZOOM_MIN
}

/** The suggested save-as name for a generated image: the path's basename. */
export const getImageFileName = (path: string): string =>
  path.split("/").at(-1) || DEFAULT_IMAGE_FILE_NAME

/**
 * The failure reason carried by an errored tool part. Mastra serializes tool
 * errors as JSON ({message, details...}); fall back to the raw text when it
 * is not JSON. Truncated — this is a caption, not a stack trace.
 */
export const getImagenErrorMessage = (
  part: ChatToolPart
): string | undefined => {
  const { errorText } = part as { errorText?: unknown }

  if (typeof errorText !== "string" || errorText.length === 0) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(errorText)
    const message = isRecord(parsed) ? getString(parsed, "message") : undefined

    if (message) {
      return message.slice(0, IMAGEN_ERROR_MAX_LENGTH)
    }
  } catch {
    // Not JSON — use the raw text below.
  }

  return errorText.slice(0, IMAGEN_ERROR_MAX_LENGTH)
}

/** Parses an image size like "1536x1024" into a width/height ratio. */
export const parseImageAspectRatio = (size?: string): number => {
  const match = size ? IMAGE_SIZE_PATTERN.exec(size.trim()) : null
  const width = Number(match?.groups?.width)
  const height = Number(match?.groups?.height)

  return match && width > 0 && height > 0
    ? width / height
    : DEFAULT_IMAGE_ASPECT_RATIO
}

export const isImagenToolPart = (part: unknown): boolean => {
  if (!isRecord(part)) {
    return false
  }

  if (part.type === "tool-imagen") {
    return true
  }

  return part.type === "dynamic-tool" && part.toolName === "imagen"
}

/**
 * The inline-render state for an imagen tool part. Title/size come from the
 * input while generating (the output is not available yet) and from the output
 * once published. Returns null for parts that are not imagen calls.
 */
export const getImagenPartState = (
  part: ChatToolPart
): ImagenPartState | null => {
  if (!isImagenToolPart(part)) {
    return null
  }

  const input = isRecord(part.input) ? part.input : {}

  if (part.state === "output-available" && isRecord(part.output)) {
    const path = getString(part.output, "path")

    if (path) {
      return {
        aspectRatio: parseImageAspectRatio(getString(part.output, "size")),
        path,
        phase: "published",
        title:
          getString(part.output, "title") || getString(input, "title") || ""
      }
    }
  }

  const isFailed = IMAGEN_FAILED_STATES.has(part.state)
  const errorMessage = isFailed ? getImagenErrorMessage(part) : undefined

  return {
    aspectRatio: parseImageAspectRatio(getString(input, "size")),
    ...(errorMessage ? { errorMessage } : {}),
    path: "",
    phase: isFailed ? "error" : "generating",
    title: getString(input, "title") || ""
  }
}
