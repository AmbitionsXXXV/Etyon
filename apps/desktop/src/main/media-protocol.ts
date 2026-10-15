import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"

import { protocol } from "electron"
import type { CustomScheme } from "electron"

import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { MEDIA_PROTOCOL_SCHEME, parseMediaUrl } from "@/shared/chat/media-url"

/**
 * Serves generated videos, and storyboard keyframe images, to the renderer. A
 * request names a session and a project-relative path; only files under the
 * session project's generated-videos/ or generated-frames/ with a known media
 * extension are served, and Range requests get 206 slices so playback can seek
 * without loading the whole file.
 */

// Videos, and the keyframe images the storyboard cards show.
const SERVED_DIRS = ["generated-frames", "generated-videos"] as const

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webm": "video/webm",
  ".webp": "image/webp"
}

const RANGE_PATTERN = /^bytes=(?<start>\d*)-(?<end>\d*)$/u

// `stream` lets <video> read the response incrementally; registered with the
// attachment scheme because Electron keeps only the last privileges call.
export const MEDIA_SCHEME_PRIVILEGES: CustomScheme = {
  privileges: {
    secure: true,
    standard: true,
    stream: true,
    supportFetchAPI: true
  },
  scheme: MEDIA_PROTOCOL_SCHEME
}

/**
 * The absolute path for a project-relative media path, or null when it is not a
 * served media file or would escape the served directories. Pure (no fs)
 * so it is the unit-testable source of path-safety truth.
 */
export const resolveMediaFilePath = ({
  projectPath,
  relativePath
}: {
  projectPath: string
  relativePath: string
}): string | null => {
  const resolvedPath = path.resolve(projectPath, relativePath)
  const isInsideServedDir = SERVED_DIRS.some((dir) => {
    const inside = path.relative(path.resolve(projectPath, dir), resolvedPath)

    return inside !== "" && !inside.startsWith("..") && !path.isAbsolute(inside)
  })

  if (
    !isInsideServedDir ||
    !MEDIA_TYPE_BY_EXTENSION[path.extname(resolvedPath).toLowerCase()]
  ) {
    return null
  }

  return resolvedPath
}

/**
 * The inclusive byte span a `Range` header asks for, or null for a header that
 * is malformed or outside the file (answered with 416). Supports one range:
 * `bytes=a-b`, `bytes=a-`, and the suffix form `bytes=-n`.
 */
export const parseByteRange = (
  header: string,
  size: number
): { end: number; start: number } | null => {
  const match = RANGE_PATTERN.exec(header.trim())
  const startText = match?.groups?.start ?? ""
  const endText = match?.groups?.end ?? ""

  if (!match || (startText === "" && endText === "") || size === 0) {
    return null
  }

  if (startText === "") {
    const suffixLength = Number(endText)

    return suffixLength > 0
      ? { end: size - 1, start: Math.max(0, size - suffixLength) }
      : null
  }

  const start = Number(startText)
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1)

  return start <= end && start < size ? { end, start } : null
}

const streamFile = (
  filePath: string,
  span?: { end: number; start: number }
): ReadableStream =>
  Readable.toWeb(fs.createReadStream(filePath, span)) as ReadableStream

export const registerMediaProtocol = (): void => {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    const target = parseMediaUrl(request.url)
    const session = target
      ? await getChatSessionById(getDb(), target.sessionId)
      : undefined
    const filePath =
      target && session
        ? resolveMediaFilePath({
            projectPath: session.projectPath,
            relativePath: target.relativePath
          })
        : null

    if (!filePath) {
      return new Response(null, { status: 404 })
    }

    let size: number

    try {
      const stats = await fs.promises.stat(filePath)

      if (!stats.isFile()) {
        return new Response(null, { status: 404 })
      }

      ;({ size } = stats)
    } catch {
      return new Response(null, { status: 404 })
    }

    const contentType =
      MEDIA_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ??
      "application/octet-stream"
    const rangeHeader = request.headers.get("range")

    if (!rangeHeader) {
      return new Response(streamFile(filePath), {
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(size),
          "content-type": contentType
        }
      })
    }

    const span = parseByteRange(rangeHeader, size)

    if (!span) {
      return new Response(null, {
        headers: { "content-range": `bytes */${size}` },
        status: 416
      })
    }

    return new Response(streamFile(filePath, span), {
      headers: {
        "accept-ranges": "bytes",
        "content-length": String(span.end - span.start + 1),
        "content-range": `bytes ${span.start}-${span.end}/${size}`,
        "content-type": contentType
      },
      status: 206
    })
  })
}
