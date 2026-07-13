import type { UIMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  attachmentToFilePart,
  classifyAttachmentCandidate,
  getImageFileParts,
  isAcceptedAttachmentMediaType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE
} from "@/renderer/lib/chat/attachments"

describe("isAcceptedAttachmentMediaType", () => {
  it("accepts png/jpeg/webp/gif (case-insensitive) and rejects others", () => {
    for (const mediaType of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "IMAGE/PNG"
    ]) {
      expect(isAcceptedAttachmentMediaType(mediaType)).toBe(true)
    }

    for (const mediaType of [
      "image/svg+xml",
      "image/bmp",
      "application/pdf",
      "text/plain"
    ]) {
      expect(isAcceptedAttachmentMediaType(mediaType)).toBe(false)
    }
  })
})

describe("classifyAttachmentCandidate", () => {
  it("accepts a valid image below the caps", () => {
    expect(
      classifyAttachmentCandidate({
        existingCount: 0,
        mediaType: "image/png",
        sizeBytes: 1024
      })
    ).toEqual({ ok: true })
  })

  it("rejects an unsupported type first", () => {
    expect(
      classifyAttachmentCandidate({
        existingCount: 0,
        mediaType: "image/svg+xml",
        sizeBytes: MAX_ATTACHMENT_BYTES + 1
      })
    ).toEqual({ ok: false, reason: "type" })
  })

  it("rejects a file over the size cap", () => {
    expect(
      classifyAttachmentCandidate({
        existingCount: 0,
        mediaType: "image/jpeg",
        sizeBytes: MAX_ATTACHMENT_BYTES + 1
      })
    ).toEqual({ ok: false, reason: "size" })
  })

  it("rejects once the count cap is reached", () => {
    expect(
      classifyAttachmentCandidate({
        existingCount: MAX_ATTACHMENTS_PER_MESSAGE,
        mediaType: "image/png",
        sizeBytes: 10
      })
    ).toEqual({ ok: false, reason: "count" })
  })
})

describe("attachmentToFilePart", () => {
  it("maps a composer attachment to an AI SDK file part", () => {
    expect(
      attachmentToFilePart({
        dataUrl: "data:image/png;base64,AAAA",
        id: "a1",
        mediaType: "image/png",
        name: "shot.png"
      })
    ).toEqual({
      filename: "shot.png",
      mediaType: "image/png",
      type: "file",
      url: "data:image/png;base64,AAAA"
    })
  })
})

describe("getImageFileParts", () => {
  it("returns only image file parts, keeping data and attachment urls", () => {
    const parts = [
      { text: "hi", type: "text" },
      {
        mediaType: "image/png",
        type: "file",
        url: "data:image/png;base64,AAAA"
      },
      {
        mediaType: "application/pdf",
        type: "file",
        url: "data:application/pdf;base64,BBBB"
      },
      {
        mediaType: "image/webp",
        type: "file",
        url: "etyon-attachment://media/abc.webp"
      }
    ] as unknown as UIMessage["parts"]

    const images = getImageFileParts(parts)

    expect(images.map((part) => part.url)).toEqual([
      "data:image/png;base64,AAAA",
      "etyon-attachment://media/abc.webp"
    ])
  })
})
