import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import type { UIMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { getAppConfigDir } from "@/main/app-paths"
import {
  ATTACHMENT_PROTOCOL_SCHEME,
  getAttachmentsDir,
  isAttachmentUrl,
  persistDataUrlAttachments,
  resolveAttachmentRequestPath,
  resolveAttachmentsForModelMessages
} from "@/main/attachments"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-attachments-home-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () => process.cwd(),
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn()
  }
}))

const attachmentsDir = path.join(getAppConfigDir(mockedHomeDir), "attachments")

afterAll(() => {
  fs.rmSync(mockedHomeDir, { force: true, recursive: true })
})

const buildImageDataUrl = (mediaType: string, contents: string): string =>
  `data:${mediaType};base64,${Buffer.from(contents).toString("base64")}`

const shaOf = (contents: string): string =>
  createHash("sha256").update(Buffer.from(contents)).digest("hex")

const userMessage = (parts: unknown[]): UIMessage =>
  ({ id: "m1", parts, role: "user" }) as unknown as UIMessage

const getFileUrl = (message: UIMessage, index: number): string => {
  const part = message.parts[index] as { url: string }

  return part.url
}

describe("resolveAttachmentRequestPath", () => {
  it("resolves a well-formed sha filename inside the attachments dir", () => {
    const fileName = `${"a".repeat(64)}.png`
    const resolved = resolveAttachmentRequestPath({
      attachmentsDir,
      requestUrl: `${ATTACHMENT_PROTOCOL_SCHEME}://media/${fileName}`
    })

    expect(resolved).toBe(path.join(attachmentsDir, fileName))
  })

  it("rejects path traversal, absolute, and malformed filenames", () => {
    for (const requestUrl of [
      `${ATTACHMENT_PROTOCOL_SCHEME}://media/${"a".repeat(64)}.png/../../etc/passwd`,
      `${ATTACHMENT_PROTOCOL_SCHEME}://media/..%2f..%2fetc%2fpasswd`,
      `${ATTACHMENT_PROTOCOL_SCHEME}://media/not-a-sha.png`,
      `${ATTACHMENT_PROTOCOL_SCHEME}://media/${"a".repeat(64)}.exe`,
      `${ATTACHMENT_PROTOCOL_SCHEME}://media/${"a".repeat(63)}.png`
    ]) {
      expect(resolveAttachmentRequestPath({ attachmentsDir, requestUrl })).toBe(
        null
      )
    }
  })
})

describe("persistDataUrlAttachments", () => {
  it("writes data-url image bytes to disk and rewrites the part url", async () => {
    const dataUrl = buildImageDataUrl("image/png", "one-tiny-png")
    const [persisted] = await persistDataUrlAttachments([
      userMessage([
        { text: "look at this", type: "text" },
        { mediaType: "image/png", type: "file", url: dataUrl }
      ])
    ])

    const expectedFileName = `${shaOf("one-tiny-png")}.png`
    const rewrittenUrl = getFileUrl(persisted, 1)

    expect(rewrittenUrl).toBe(
      `${ATTACHMENT_PROTOCOL_SCHEME}://media/${expectedFileName}`
    )
    expect(isAttachmentUrl(rewrittenUrl)).toBe(true)
    expect(
      fs.readFileSync(path.join(attachmentsDir, expectedFileName)).toString()
    ).toBe("one-tiny-png")
    // Text parts are untouched.
    expect((persisted.parts[0] as { text: string }).text).toBe("look at this")
  })

  it("is content-addressed so identical bytes share one file", async () => {
    const dataUrl = buildImageDataUrl("image/webp", "same-bytes")
    const [first] = await persistDataUrlAttachments([
      userMessage([{ mediaType: "image/webp", type: "file", url: dataUrl }])
    ])
    const [second] = await persistDataUrlAttachments([
      userMessage([{ mediaType: "image/webp", type: "file", url: dataUrl }])
    ])

    expect(getFileUrl(first, 0)).toBe(getFileUrl(second, 0))
  })

  it("leaves non-image file parts and already-stored urls unchanged", async () => {
    const attachmentUrl = `${ATTACHMENT_PROTOCOL_SCHEME}://media/${"b".repeat(64)}.png`
    const pdfDataUrl = buildImageDataUrl("application/pdf", "not-an-image")
    const [message] = await persistDataUrlAttachments([
      userMessage([
        { mediaType: "application/pdf", type: "file", url: pdfDataUrl },
        { mediaType: "image/png", type: "file", url: attachmentUrl }
      ])
    ])

    expect(getFileUrl(message, 0)).toBe(pdfDataUrl)
    expect(getFileUrl(message, 1)).toBe(attachmentUrl)
  })
})

describe("resolveAttachmentsForModelMessages", () => {
  it("reads stored bytes back into an inline data url for the model", async () => {
    const [persisted] = await persistDataUrlAttachments([
      userMessage([
        {
          mediaType: "image/png",
          type: "file",
          url: buildImageDataUrl("image/png", "resolve-me")
        }
      ])
    ])
    const [resolved] = await resolveAttachmentsForModelMessages([persisted])

    expect(getFileUrl(resolved, 0)).toBe(
      buildImageDataUrl("image/png", "resolve-me")
    )
  })

  it("passes plain data urls through untouched", async () => {
    const dataUrl = buildImageDataUrl("image/png", "passthrough")
    const [resolved] = await resolveAttachmentsForModelMessages([
      userMessage([{ mediaType: "image/png", type: "file", url: dataUrl }])
    ])

    expect(getFileUrl(resolved, 0)).toBe(dataUrl)
  })

  it("drops file parts whose stored bytes are missing", async () => {
    const [resolved] = await resolveAttachmentsForModelMessages([
      userMessage([
        { text: "still here", type: "text" },
        {
          mediaType: "image/png",
          type: "file",
          url: `${ATTACHMENT_PROTOCOL_SCHEME}://media/${"c".repeat(64)}.png`
        }
      ])
    ])

    expect(resolved.parts).toHaveLength(1)
    expect((resolved.parts[0] as { text: string }).text).toBe("still here")
  })
})

describe("getAttachmentsDir", () => {
  it("nests under the app config dir", () => {
    expect(getAttachmentsDir()).toBe(attachmentsDir)
  })
})
