import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { UIMessage } from "ai"
import { app, protocol } from "electron"

import { getAppConfigDir } from "@/main/app-paths"
import { logger } from "@/main/logger"

/**
 * Vision image input is persisted out of the SQLite chat log to keep message
 * rows small: a composed message arrives with `file` parts whose url is a
 * base64 `data:` URL, and on persistence those bytes are content-addressed to
 * `<app-config-dir>/attachments/<sha256>.<ext>` while the part url is rewritten
 * to `etyon-attachment://media/<sha256>.<ext>`. The renderer loads that url
 * through a registered protocol that serves ONLY files inside the attachments
 * directory; the model-message path resolves it back to a `data:` URL so the
 * provider receives the image bytes.
 */
export const ATTACHMENT_PROTOCOL_SCHEME = "etyon-attachment"

// The scheme is standard (authority + path), so the filename lives in the path
// under a fixed host; `new URL(...).pathname` is then a predictable
// "/<sha>.<ext>" that the containment resolver validates.
const ATTACHMENT_URL_HOST = "media"
const ATTACHMENT_URL_PREFIX = `${ATTACHMENT_PROTOCOL_SCHEME}://${ATTACHMENT_URL_HOST}/`

// Belt-and-braces against a hand-edited/oversized message part; the composer
// already caps each image at 8MB before it is ever sent.
const MAX_PERSISTED_ATTACHMENT_BYTES = 24 * 1024 * 1024

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
}

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
}

// A stored attachment filename is exactly a lowercase sha256 plus a known image
// extension — the resolver rejects anything else, so no request can escape the
// attachments directory regardless of URL trickery.
const ATTACHMENT_FILENAME_PATTERN = /^[a-f\d]{64}\.(?:png|jpe?g|webp|gif)$/u
const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/su

interface FileMessagePart {
  filename?: string
  mediaType: string
  type: "file"
  url: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isFileMessagePart = (part: unknown): part is FileMessagePart =>
  isRecord(part) &&
  part.type === "file" &&
  typeof part.mediaType === "string" &&
  typeof part.url === "string"

/** `<app-config-dir>/attachments` — where content-addressed image bytes live. */
export const getAttachmentsDir = (): string =>
  path.join(getAppConfigDir(app.getPath("home")), "attachments")

export const isAttachmentUrl = (url: string): boolean =>
  url.startsWith(`${ATTACHMENT_PROTOCOL_SCHEME}://`)

const buildAttachmentUrl = (fileName: string): string =>
  `${ATTACHMENT_URL_PREFIX}${fileName}`

const parseBase64DataUrl = (
  url: string
): { bytes: Buffer; mediaType: string } | null => {
  const match = DATA_URL_PATTERN.exec(url)

  if (!match) {
    return null
  }

  const [, mediaType, base64] = match

  return {
    bytes: Buffer.from(base64 ?? "", "base64"),
    mediaType: (mediaType ?? "").toLowerCase()
  }
}

/**
 * Resolves an `etyon-attachment://media/<file>` request url to an absolute path
 * inside `attachmentsDir`, or null when the filename is not a well-formed
 * stored attachment name or would escape the directory. Pure (no fs, no
 * electron) so it is unit-testable and the single source of path-safety truth.
 */
export const resolveAttachmentRequestPath = ({
  attachmentsDir,
  requestUrl
}: {
  attachmentsDir: string
  requestUrl: string
}): string | null => {
  let fileName: string

  try {
    fileName = decodeURIComponent(new URL(requestUrl).pathname).replace(
      /^\/+/u,
      ""
    )
  } catch {
    return null
  }

  if (!ATTACHMENT_FILENAME_PATTERN.test(fileName)) {
    return null
  }

  const resolvedPath = path.resolve(attachmentsDir, fileName)
  const relativePath = path.relative(attachmentsDir, resolvedPath)

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null
  }

  return resolvedPath
}

const rewritePartsForMessage = async <TPart>(
  parts: readonly TPart[],
  rewritePart: (part: TPart) => Promise<TPart>
): Promise<TPart[] | null> => {
  let changed = false
  const nextParts = await Promise.all(
    parts.map(async (part) => {
      const nextPart = await rewritePart(part)

      if (nextPart !== part) {
        changed = true
      }

      return nextPart
    })
  )

  return changed ? nextParts : null
}

const mapMessageParts = async (
  messages: readonly UIMessage[],
  rewritePart: (
    part: UIMessage["parts"][number]
  ) => Promise<UIMessage["parts"][number]>
): Promise<UIMessage[]> => {
  const nextMessages = await Promise.all(
    messages.map(async (message) => {
      const nextParts = await rewritePartsForMessage(message.parts, rewritePart)

      return nextParts ? { ...message, parts: nextParts } : message
    })
  )

  return nextMessages
}

const persistDataUrlPart = async (
  part: UIMessage["parts"][number],
  attachmentsDir: string
): Promise<UIMessage["parts"][number]> => {
  if (!(isFileMessagePart(part) && part.url.startsWith("data:"))) {
    return part
  }

  const parsed = parseBase64DataUrl(part.url)
  const extension = parsed
    ? EXTENSION_BY_MEDIA_TYPE[parsed.mediaType]
    : undefined

  if (
    !parsed ||
    !extension ||
    parsed.bytes.length === 0 ||
    parsed.bytes.length > MAX_PERSISTED_ATTACHMENT_BYTES
  ) {
    return part
  }

  const sha = createHash("sha256").update(parsed.bytes).digest("hex")
  const fileName = `${sha}.${extension}`
  const filePath = path.join(attachmentsDir, fileName)

  await fs.mkdir(attachmentsDir, { recursive: true })

  try {
    await fs.writeFile(filePath, parsed.bytes, { flag: "wx" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error
    }
  }

  return { ...part, url: buildAttachmentUrl(fileName) }
}

/**
 * Rewrites `data:` image file parts to on-disk `etyon-attachment://` refs,
 * writing the bytes content-addressed under `attachmentsDir`. Best-effort: any
 * failure leaves the original messages untouched so persistence never breaks.
 */
export const persistDataUrlAttachments = async (
  messages: UIMessage[]
): Promise<UIMessage[]> => {
  try {
    const attachmentsDir = getAttachmentsDir()

    return await mapMessageParts(messages, (part) =>
      persistDataUrlPart(part, attachmentsDir)
    )
  } catch (error) {
    logger.error("attachment_persist_failed", { error })

    return messages
  }
}

const resolveAttachmentPartToDataUrl = async (
  part: UIMessage["parts"][number],
  attachmentsDir: string
): Promise<UIMessage["parts"][number] | null> => {
  if (!(isFileMessagePart(part) && isAttachmentUrl(part.url))) {
    return part
  }

  const filePath = resolveAttachmentRequestPath({
    attachmentsDir,
    requestUrl: part.url
  })

  if (!filePath) {
    return null
  }

  try {
    const bytes = await fs.readFile(filePath)

    return {
      ...part,
      url: `data:${part.mediaType};base64,${bytes.toString("base64")}`
    }
  } catch (error) {
    // A missing ref (e.g. a hand-deleted attachment) is a benign, expected
    // degradation — drop the part quietly; only surface unexpected read errors.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("attachment_resolve_failed", { error })
    }

    return null
  }
}

/**
 * Resolves `etyon-attachment://` image file parts back to inline `data:` URLs
 * so `convertToModelMessages` hands the provider the actual image bytes. An
 * unreadable/unsafe ref drops that file part (the surrounding text survives)
 * rather than passing a url the provider cannot fetch. `data:` URLs from the
 * current turn pass through untouched.
 */
export const resolveAttachmentsForModelMessages = async (
  messages: UIMessage[]
): Promise<UIMessage[]> => {
  const attachmentsDir = getAttachmentsDir()
  const nextMessages = await Promise.all(
    messages.map(async (message) => {
      const resolvedParts = await Promise.all(
        message.parts.map((part) =>
          resolveAttachmentPartToDataUrl(part, attachmentsDir)
        )
      )
      const nextParts = resolvedParts.filter(
        (part): part is UIMessage["parts"][number] => part !== null
      )
      const changed =
        nextParts.length !== message.parts.length ||
        nextParts.some((part, index) => part !== message.parts[index])

      return changed ? { ...message, parts: nextParts } : message
    })
  )

  return nextMessages
}

const getMediaTypeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).slice(1).toLowerCase()

  return MEDIA_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream"
}

/**
 * Must run before `app.whenReady()`: marks the attachment scheme standard +
 * secure so the renderer can load `etyon-attachment://` urls as <img> sources
 * and via fetch.
 */
export const registerAttachmentProtocolScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true
      },
      scheme: ATTACHMENT_PROTOCOL_SCHEME
    }
  ])
}

/**
 * Serves attachment files from the attachments directory only. The resolver
 * validates the filename shape and directory containment, so a crafted url can
 * never read outside `<app-config-dir>/attachments`.
 */
export const registerAttachmentProtocol = (): void => {
  protocol.handle(ATTACHMENT_PROTOCOL_SCHEME, async (request) => {
    const filePath = resolveAttachmentRequestPath({
      attachmentsDir: getAttachmentsDir(),
      requestUrl: request.url
    })

    if (!filePath) {
      return new Response(null, { status: 404 })
    }

    try {
      const bytes = await fs.readFile(filePath)

      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": getMediaTypeForPath(filePath) }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
