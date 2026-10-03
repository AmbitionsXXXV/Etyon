import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { getAppConfigDir } from "@/main/app-paths"
import * as captureEvents from "@/main/screen-awareness/capture-events"
import * as helper from "@/main/screen-awareness/helper"
import {
  registerScreenAwarenessIpcHandlers,
  startScreenAwarenessHelper,
  stopScreenAwarenessHelper
} from "@/main/screen-awareness/index"

type Handler = (...args: unknown[]) => unknown
const state = vi.hoisted(() => ({
  enabled: true,
  execFile: vi.fn(),
  handlers: new Map<string, Handler>(),
  root: "",
  send: vi.fn(),
  spawn: vi.fn()
}))
vi.mock("node:child_process", () => ({
  execFile: Object.assign(state.execFile, {
    [Symbol.for("nodejs.util.promisify.custom")]: (...args: unknown[]) =>
      state.execFile(...args)
  }),
  spawn: state.spawn
}))
vi.mock("@electron-toolkit/utils", () => ({ platform: { isMacOS: true } }))
vi.mock("electron", () => ({
  app: {
    getAppPath: () => path.join(state.root, "app"),
    getLocale: () => "en-US",
    getPath: () => path.join(state.root, "home"),
    isPackaged: false
  },
  ipcMain: {
    handle: (channel: string, handler: Handler) =>
      state.handlers.set(channel, handler),
    removeHandler: (channel: string) => state.handlers.delete(channel)
  }
}))
vi.mock("@/main/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock("@/main/settings", () => ({
  getSettings: () => ({
    locale: "system",
    screenAwareness: { enabled: state.enabled }
  })
}))
vi.mock("@/main/window", () => ({
  focusOrCreateMainWindow: () => ({
    isDestroyed: () => false,
    webContents: { isLoadingMainFrame: () => false, send: state.send }
  }),
  getMainWindow: () => ({ webContents: { send: state.send } })
}))

const captureId = "00000000-0000-0000-0000-000000000001"
const invoke = async (
  channel: string,
  ...args: unknown[]
): Promise<unknown> => {
  const handler = state.handlers.get(channel)
  if (!handler) {
    throw new Error(`IPC handler missing: ${channel}`)
  }
  return await handler({}, ...args)
}
const fixtureFiles = async (): Promise<string[]> =>
  await fs.readdir(helper.getScreenAwarenessCaptureDirectoryPath())
const seedCapture = async (): Promise<void> => {
  const directory = helper.getScreenAwarenessCaptureDirectoryPath()
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  const imagePath = path.join(directory, `${captureId}.png`)
  const appIconPath = path.join(directory, `${captureId}-icon.png`)
  await fs.writeFile(imagePath, Buffer.from("iVBORw0KGgo=", "base64"), {
    mode: 0o600
  })
  await fs.writeFile(appIconPath, Buffer.from("iVBORw0KGgo=", "base64"), {
    mode: 0o600
  })
  const timestamp = new Date()
  await fs.utimes(imagePath, timestamp, timestamp)
  await fs.utimes(appIconPath, timestamp, timestamp)
  await fs.writeFile(
    path.join(directory, `${captureId}.json`),
    JSON.stringify({
      accessibleText: "Private fixture text",
      appIconPath,
      appName: "TextEdit",
      capturedAt: new Date().toISOString(),
      id: captureId,
      imagePath,
      kind: "ready",
      mediaType: "image/png"
    }),
    { mode: 0o600 }
  )
}

beforeEach(async () => {
  vi.resetAllMocks()
  state.root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "etyon-screen-ipc-test-"))
  )
  state.enabled = true
  state.handlers.clear()
  state.spawn.mockImplementation(() => ({
    exitCode: null,
    kill: vi.fn(() => true),
    once: vi.fn()
  }))
  state.execFile.mockResolvedValue({
    stderr: "",
    stdout: JSON.stringify({
      accessibility: "granted",
      screenRecording: "granted"
    })
  })
  const bundled = path.join(
    state.root,
    "app",
    "resources",
    "screen-awareness",
    "Etyon Screen Awareness.app",
    "Contents",
    "MacOS",
    "EtyonScreenAwareness"
  )
  await fs.mkdir(path.dirname(bundled), { recursive: true })
  await fs.writeFile(bundled, "fake native executable")
  registerScreenAwarenessIpcHandlers()
})
afterEach(async () => {
  vi.restoreAllMocks()
  captureEvents.stopScreenAwarenessCaptureEvents()
  await fs.rm(
    path.join(
      getAppConfigDir(path.join(state.root, "home")),
      "screen-awareness-status.json"
    ),
    { force: true }
  )
  await helper.stopScreenAwarenessHelper()
  await captureEvents.clearPendingScreenAwarenessCaptures()
  vi.clearAllTimers()
  vi.useRealTimers()
  await fs.rm(state.root, { force: true, recursive: true })
})

describe("screen awareness IPC behavior", () => {
  it("blocks list, assign and capture after disabling even when private captures exist", async () => {
    await seedCapture()
    expect(await invoke("screen-awareness:list")).toMatchObject([
      { id: captureId }
    ])
    state.enabled = false
    expect(await invoke("screen-awareness:list")).toEqual([])
    await expect(
      invoke("screen-awareness:assign", captureId, "chat-a")
    ).rejects.toThrow("disabled")
    expect(await invoke("screen-awareness:capture")).toBe(false)
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it("allows explicit private-data cleanup while disabled and preserves unrelated files", async () => {
    await seedCapture()
    await invoke("screen-awareness:list")
    const directory = helper.getScreenAwarenessCaptureDirectoryPath()
    await fs.writeFile(path.join(directory, "unrelated.txt"), "keep")
    await fs.writeFile(
      path.join(directory, `${captureId}.json.tmp`),
      "private partial write"
    )
    state.enabled = false
    await invoke("screen-awareness:clear")
    expect(await fixtureFiles()).toEqual(["unrelated.txt"])
    expect(await invoke("screen-awareness:list")).toEqual([])
    expect(state.send).toHaveBeenCalledWith(
      "screen-awareness:capture-dismissed",
      captureId
    )
  })

  it("returns the canonical newer capture after independently removing its image", async () => {
    await seedCapture()
    await invoke("screen-awareness:list")
    const first = await invoke("screen-awareness:assign", captureId, "chat-a")
    expect(first).toMatchObject({
      id: captureId,
      revision: 1,
      sessionId: "chat-a"
    })
    await invoke("screen-awareness:remove-content", captureId, "image")
    const canonical = await invoke(
      "screen-awareness:assign",
      captureId,
      "chat-a"
    )
    expect(canonical).toMatchObject({
      accessibleText: "Private fixture text",
      dataUrl: undefined,
      id: captureId,
      revision: 3,
      sessionId: "chat-a"
    })
    expect(await fixtureFiles()).not.toContain(`${captureId}.png`)
  })

  it("clears old pending data instead of launching a capture helper at disabled startup", async () => {
    await seedCapture()
    state.enabled = false
    expect(startScreenAwarenessHelper()).toBe(false)
    await vi.waitFor(async () => expect(await fixtureFiles()).toEqual([]))
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it("queues termination before cleaning private records when disabling", async () => {
    await seedCapture()
    await invoke("screen-awareness:list")
    const events: string[] = []
    const realStopEvents = captureEvents.stopScreenAwarenessCaptureEvents
    const realStopHelper = helper.stopScreenAwarenessHelper
    const realClear = captureEvents.clearPendingScreenAwarenessCaptures
    vi.spyOn(
      captureEvents,
      "stopScreenAwarenessCaptureEvents"
    ).mockImplementation(() => {
      events.push("watcher-stopped")
      realStopEvents()
    })
    vi.spyOn(helper, "stopScreenAwarenessHelper").mockImplementation(
      async () => {
        events.push("termination-queued")
        await realStopHelper()
        events.push("termination-acknowledged")
      }
    )
    vi.spyOn(
      captureEvents,
      "clearPendingScreenAwarenessCaptures"
    ).mockImplementation(async () => {
      const commandDirectory = path.join(
        getAppConfigDir(path.join(state.root, "home")),
        "screen-awareness-control.commands"
      )
      const issued = await fs.readdir(commandDirectory)
      const commands: unknown[] = await Promise.all(
        issued
          .filter((file) => file.endsWith(".json"))
          .map(async (file) =>
            JSON.parse(
              await fs.readFile(path.join(commandDirectory, file), "utf-8")
            )
          )
      )
      expect(commands).toContainEqual(
        expect.objectContaining({ command: "terminate" })
      )
      events.push("private-clear")
      await realClear()
    })
    state.enabled = false
    await stopScreenAwarenessHelper()
    await vi.waitFor(async () => expect(await fixtureFiles()).toEqual([]))
    expect(events.slice(0, 4)).toEqual([
      "watcher-stopped",
      "termination-queued",
      "termination-acknowledged",
      "private-clear"
    ])
  })

  it("keeps permission onboarding available while capture is disabled without capture modes", async () => {
    state.enabled = false
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    expect(await invoke("screen-awareness:open-onboarding")).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    const args: unknown = state.spawn.mock.calls[0]?.[1]
    expect(args).toEqual(
      expect.arrayContaining(["--onboard", "--permission-only"])
    )
    expect(args).not.toEqual(expect.arrayContaining(["--capture-once"]))
    expect(await invoke("screen-awareness:capture")).toBe(false)
  })

  it("preserves pending files when native termination is unacknowledged and permits explicit cleanup after exit", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"))
    await seedCapture()
    await invoke("screen-awareness:list")
    const statusFile = path.join(
      getAppConfigDir(path.join(state.root, "home")),
      "screen-awareness-status.json"
    )
    await fs.writeFile(
      statusFile,
      JSON.stringify({
        captureEnabled: true,
        instanceId: "00000000-0000-0000-0000-000000000099",
        updatedAt: new Date().toISOString()
      })
    )
    state.enabled = false
    const rejected = expect(stopScreenAwarenessHelper()).rejects.toThrow(
      "did not acknowledge termination"
    )
    await vi.advanceTimersByTimeAsync(1500)
    await rejected
    expect(await fixtureFiles()).toHaveLength(3)
    expect(await invoke("screen-awareness:list")).toEqual([])
    await fs.rm(statusFile)
    await invoke("screen-awareness:clear")
    expect(await fixtureFiles()).toEqual([])
  })

  it("rejects malformed IPC destinations and removal parts without changing capture files", async () => {
    await seedCapture()
    await expect(
      invoke("screen-awareness:assign", captureId, "")
    ).rejects.toThrow("Invalid capture destination")
    await expect(
      invoke("screen-awareness:remove-content", captureId, "all")
    ).rejects.toThrow("Invalid capture content")
    expect(await fixtureFiles()).toHaveLength(3)
  })
})
