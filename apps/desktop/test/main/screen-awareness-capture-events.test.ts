import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
  assignScreenAwarenessCapture,
  clearPendingScreenAwarenessCaptures,
  dismissScreenAwarenessCapture,
  isCaptureEventRecord,
  listPendingScreenAwarenessCaptures,
  removeScreenAwarenessCaptureContent
} from "@/main/screen-awareness/capture-events"

const state = vi.hoisted(() => ({ directory: "", send: vi.fn() }))
vi.mock("@/main/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/main/screen-awareness/helper", () => ({
  getScreenAwarenessCaptureDirectoryPath: () => state.directory
}))
vi.mock("@/main/window", () => ({
  focusOrCreateMainWindow: () => ({
    isDestroyed: () => false,
    webContents: { isLoadingMainFrame: () => false, send: state.send }
  }),
  getMainWindow: () => null
}))

const buildRecord = (id: string) => ({
  accessibleText: "Visible text",
  appName: "TextEdit",
  capturedAt: new Date().toISOString(),
  id,
  kind: "ready",
  mediaType: "image/png",
  selectedText: "Selection"
})
beforeEach(async () => {
  state.directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "etyon-capture-test-"))
  )
})
afterEach(async () => {
  for (const capture of await listPendingScreenAwarenessCaptures()) {
    await dismissScreenAwarenessCapture(capture.id)
  }
  await fs.rm(state.directory, { force: true, recursive: true })
})
describe("private capture bridge", () => {
  it("supports text-only capture, persists routing and independently removes text", async () => {
    const id = "00000000-0000-0000-0000-000000000001"
    await fs.writeFile(
      path.join(state.directory, `${id}.json`),
      JSON.stringify(buildRecord(id))
    )
    expect(await listPendingScreenAwarenessCaptures()).toMatchObject([
      { accessibleText: "Visible text", id }
    ])
    await assignScreenAwarenessCapture(id, "chat-1")
    expect(
      JSON.parse(
        await fs.readFile(path.join(state.directory, `${id}.json`), "utf-8")
      )
    ).toMatchObject({ sessionId: "chat-1" })
    await removeScreenAwarenessCaptureContent(id, "text")
    expect(await listPendingScreenAwarenessCaptures()).toEqual([])
  })
  it("rejects screenshot symlinks outside the private directory", async () => {
    const id = "00000000-0000-0000-0000-000000000002"
    const imagePath = path.join(state.directory, `${id}.png`)
    await fs.symlink(import.meta.filename, imagePath)
    await fs.writeFile(
      path.join(state.directory, `${id}.json`),
      JSON.stringify({ ...buildRecord(id), imagePath })
    )
    expect(await listPendingScreenAwarenessCaptures()).toMatchObject([
      {
        accessibleText: "Visible text",
        dataUrl: undefined,
        warnings: ["screenshot-unavailable"]
      }
    ])
    await expect(fs.stat(import.meta.filename)).resolves.toBeDefined()
  })
  it("expires unsent content and refuses unbounded native metadata", async () => {
    const id = "00000000-0000-0000-0000-000000000003"
    const record = {
      ...buildRecord(id),
      capturedAt: new Date(Date.now() - 700_000).toISOString()
    }
    await fs.writeFile(
      path.join(state.directory, `${id}.json`),
      JSON.stringify(record)
    )
    expect(await listPendingScreenAwarenessCaptures()).toEqual([])
    expect(
      isCaptureEventRecord({
        ...buildRecord(id),
        accessibleText: "a".repeat(100_000)
      })
    ).toBe(false)
  })
  it("accepts bounded Chinese selection and window text together", async () => {
    const id = "00000000-0000-0000-0000-000000000005"
    const accessibleText = "窗".repeat(24_000)
    const selectedText = "选".repeat(24_000)
    await fs.writeFile(
      path.join(state.directory, `${id}.json`),
      JSON.stringify({ ...buildRecord(id), accessibleText, selectedText })
    )
    expect(await listPendingScreenAwarenessCaptures()).toMatchObject([
      { accessibleText, id, selectedText }
    ])
  })
  it("serializes content removal with reads and clears every retained private file", async () => {
    const id = "00000000-0000-0000-0000-000000000004"
    const imagePath = path.join(state.directory, `${id}.png`)
    await fs.writeFile(imagePath, "fake-png-fixture")
    await fs.writeFile(
      path.join(state.directory, `${id}.json`),
      JSON.stringify({ ...buildRecord(id), imagePath })
    )
    await listPendingScreenAwarenessCaptures()
    const remove = removeScreenAwarenessCaptureContent(id, "image")
    const read = listPendingScreenAwarenessCaptures()
    await remove
    expect(await read).toMatchObject([
      {
        accessibleText: "Visible text",
        dataUrl: undefined,
        selectedText: "Selection"
      }
    ])
    await clearPendingScreenAwarenessCaptures()
    expect(await fs.readdir(state.directory)).toEqual([])
    expect(await listPendingScreenAwarenessCaptures()).toEqual([])
  })
})
