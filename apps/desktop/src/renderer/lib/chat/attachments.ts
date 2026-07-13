import type { FileUIPart, UIMessage } from "ai"

/**
 * Pure helpers for the composer's image attachments. The rules (accepted
 * types, per-image size cap, per-message count cap) live here as inline
 * constants so they are testable in isolation; the DOM work (reading a File to
 * a data URL) stays in the component. Attachments travel as AI SDK `file`
 * parts whose url is a base64 `data:` URL until the main process persists them.
 */

export const ACCEPTED_ATTACHMENT_MEDIA_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
] as const

/** Per-image cap: 8MB. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

/** Per-message cap: 4 images. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4

export type AttachmentRejectionReason = "count" | "size" | "type"

export interface ComposerAttachment {
  dataUrl: string
  id: string
  mediaType: string
  name: string
}

export type AttachmentClassification =
  | { ok: false; reason: AttachmentRejectionReason }
  | { ok: true }

export const isAcceptedAttachmentMediaType = (mediaType: string): boolean =>
  (ACCEPTED_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(
    mediaType.toLowerCase()
  )

/**
 * Decides whether one candidate file may be attached, given how many are
 * already accepted. Checked in reason priority order — wrong type, then too
 * large, then over the count cap — so the surfaced error names the first thing
 * that disqualifies the file.
 */
export const classifyAttachmentCandidate = ({
  existingCount,
  mediaType,
  sizeBytes
}: {
  existingCount: number
  mediaType: string
  sizeBytes: number
}): AttachmentClassification => {
  if (!isAcceptedAttachmentMediaType(mediaType)) {
    return { ok: false, reason: "type" }
  }

  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "size" }
  }

  if (existingCount >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, reason: "count" }
  }

  return { ok: true }
}

export const attachmentToFilePart = (
  attachment: ComposerAttachment
): FileUIPart => ({
  filename: attachment.name,
  mediaType: attachment.mediaType,
  type: "file",
  url: attachment.dataUrl
})

/**
 * Image `file` parts of a message, for rendering thumbnails in a bubble. Works
 * whether the url is an inline `data:` URL (optimistic, pre-persistence) or an
 * `etyon-attachment://` ref (persisted / reloaded).
 */
export const getImageFileParts = (parts: UIMessage["parts"]): FileUIPart[] =>
  parts.filter(
    (part): part is FileUIPart =>
      part.type === "file" &&
      typeof (part as FileUIPart).mediaType === "string" &&
      (part as FileUIPart).mediaType.startsWith("image/")
  )
