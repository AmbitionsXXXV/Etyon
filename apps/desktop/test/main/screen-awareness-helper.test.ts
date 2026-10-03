import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { getAppConfigDir } from "@/main/app-paths"
import {
  captureFocusedWindow,
  getScreenAwarenessCaptureDirectoryPath,
  getScreenAwarenessPermissionStatus,
  showScreenAwarenessOnboarding,
  startScreenAwarenessHelper,
  stopScreenAwarenessHelper
} from "@/main/screen-awareness/helper"

interface FakeLauncher {
  exitCode: number | null
  kill: (signal?: string) => boolean
  once: (event: string, callback: (...args: unknown[]) => void) => unknown
}
const state = vi.hoisted(() => ({
  enabled: true,
  execFile:
    vi.fn<
      (
        file: string,
        args: string[],
        options: unknown
      ) => Promise<{ stderr: string; stdout: string }>
    >(),
  isMacOS: true,
  root: "",
  spawn:
    vi.fn<(file: string, args: string[], options: unknown) => FakeLauncher>()
}))
vi.mock("node:child_process", () => ({
  execFile: Object.assign(state.execFile, {
    [Symbol.for("nodejs.util.promisify.custom")]: (
      file: string,
      args: string[],
      options: unknown
    ) => state.execFile(file, args, options)
  }),
  spawn: state.spawn
}))
vi.mock("@electron-toolkit/utils", () => ({
  platform: {
    get isMacOS() {
      return state.isMacOS
    }
  }
}))
vi.mock("electron", () => ({
  app: {
    getAppPath: () => path.join(state.root, "app"),
    getLocale: () => "ja-JP",
    getPath: () => path.join(state.root, "home"),
    isPackaged: false
  }
}))
vi.mock("@/main/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock("@/main/settings", () => ({
  getSettings: () => ({
    locale: "system",
    screenAwareness: { enabled: state.enabled }
  })
}))

const instanceId = "00000000-0000-0000-0000-000000000099"
const configPath = (): string => getAppConfigDir(path.join(state.root, "home"))
const installedExecutable = (): string =>
  path.join(
    configPath(),
    "screen-awareness",
    "Etyon Screen Awareness.app",
    "Contents",
    "MacOS",
    "EtyonScreenAwareness"
  )
const commandDirectory = (): string =>
  path.join(configPath(), "screen-awareness-control.commands")
const commands = (): {
  command: string
  id: string
  issuedAt: number
  targetInstanceId?: string
}[] => {
  if (!fs.existsSync(commandDirectory())) {
    return []
  }
  return fs
    .readdirSync(commandDirectory())
    .filter((file) => file.endsWith(".json"))
    .map((file) =>
      JSON.parse(fs.readFileSync(path.join(commandDirectory(), file), "utf-8"))
    )
}
const heartbeat = (overrides: Record<string, unknown> = {}): void => {
  fs.mkdirSync(configPath(), { recursive: true })
  fs.writeFileSync(
    path.join(configPath(), "screen-awareness-status.json"),
    JSON.stringify({
      accessibility: "granted",
      captureEnabled: true,
      instanceId,
      screenRecording: "granted",
      updatedAt: new Date().toISOString(),
      ...overrides
    })
  )
}
const writeInstalledExecutable = (): void => {
  fs.mkdirSync(path.dirname(installedExecutable()), { recursive: true })
  fs.writeFileSync(installedExecutable(), "fake native executable")
}
const launchArguments = (): string[] => {
  const args = state.spawn.mock.calls.at(-1)?.[1]
  if (!args) {
    throw new Error("The fake launcher was not called.")
  }
  return args
}

beforeEach(() => {
  vi.resetAllMocks()
  state.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "etyon-helper-test-"))
  )
  state.enabled = true
  state.isMacOS = true
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
  fs.mkdirSync(path.dirname(bundled), { recursive: true })
  fs.writeFileSync(bundled, "fake native executable")
  state.spawn.mockImplementation(() => ({
    exitCode: null,
    kill: vi.fn(() => true),
    once: vi.fn()
  }))
  state.execFile.mockResolvedValue({
    stderr: "",
    stdout: JSON.stringify({
      accessibility: "granted",
      screenRecording: "not-granted"
    })
  })
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
  vi.setSystemTime(new Date("2026-10-03T00:00:00Z"))
})
afterEach(async () => {
  fs.rmSync(path.join(configPath(), "screen-awareness-status.json"), {
    force: true
  })
  await stopScreenAwarenessHelper()
  vi.clearAllTimers()
  vi.useRealTimers()
  fs.rmSync(state.root, { force: true, recursive: true })
})

describe("screen awareness helper command boundary", () => {
  it("does not issue capture commands or launch when capture is disabled", async () => {
    state.enabled = false
    heartbeat()
    expect(captureFocusedWindow()).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.spawn).not.toHaveBeenCalled()
    expect(commands()).toEqual([])
  })

  it("launches only permission onboarding when the feature is disabled", async () => {
    state.enabled = false
    expect(showScreenAwarenessOnboarding()).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    const args = launchArguments()
    expect(state.spawn.mock.calls[0]?.[0]).toBe("/usr/bin/open")
    expect(args).toEqual(
      expect.arrayContaining(["--onboard", "--permission-only"])
    )
    expect(args).not.toContain("--capture-once")
    expect(args).not.toContain("--background")
    expect(commands().some((command) => command.command === "capture")).toBe(
      false
    )
  })

  it("passes the host PID, unique helper instance, locale and private capture path to LaunchServices", async () => {
    expect(startScreenAwarenessHelper()).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    const args = launchArguments()
    const childInstance = args[args.indexOf("--instance-id") + 1]
    expect(childInstance).toMatch(/^[\da-f-]{36}$/u)
    expect(args[args.indexOf("--host-pid") + 1]).toBe(String(process.pid))
    expect(args[args.indexOf("--locale") + 1]).toBe("ja-JP")
    expect(args[args.indexOf("--capture-directory") + 1]).toBe(
      getScreenAwarenessCaptureDirectoryPath()
    )
    startScreenAwarenessHelper()
    await vi.advanceTimersByTimeAsync(500)
    const next = launchArguments()
    expect(next[next.indexOf("--instance-id") + 1]).not.toBe(childInstance)
  })

  it("queues multiple live capture requests with unique IDs instead of overwriting one control file", () => {
    heartbeat()
    expect(captureFocusedWindow()).toBe(true)
    expect(captureFocusedWindow()).toBe(true)
    const queued = commands()
    expect(queued).toHaveLength(2)
    expect(new Set(queued.map((command) => command.id)).size).toBe(2)
    expect(queued).toEqual([
      expect.objectContaining({
        command: "capture",
        targetInstanceId: instanceId
      }),
      expect.objectContaining({
        command: "capture",
        targetInstanceId: instanceId
      })
    ])
    expect(fs.statSync(commandDirectory()).mode % 0o1000).toBe(0o700)
    for (const file of fs.readdirSync(commandDirectory())) {
      expect(
        fs.statSync(path.join(commandDirectory(), file)).mode % 0o1000
      ).toBe(0o600)
    }
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it("preserves termination even if onboarding is requested before the helper polls", async () => {
    heartbeat()
    const stopped = stopScreenAwarenessHelper()
    showScreenAwarenessOnboarding()
    expect(
      commands()
        .map((command) => command.command)
        .toSorted()
    ).toEqual(["onboard", "terminate"])
    expect(
      commands().find((command) => command.command === "onboard")
        ?.targetInstanceId
    ).toBe(instanceId)
    expect(
      fs.readFileSync(
        path.join(configPath(), "screen-awareness-control"),
        "utf-8"
      )
    ).toBe("terminate")
    fs.rmSync(path.join(configPath(), "screen-awareness-status.json"), {
      force: true
    })
    await vi.advanceTimersByTimeAsync(25)
    await stopped
  })

  it.each(["stale", "nan", "future"])(
    "does not treat a %s heartbeat as a live capture helper",
    async (kind) => {
      const updatedAt =
        kind === "nan"
          ? "not-a-date"
          : new Date(
              Date.now() + (kind === "future" ? 1000 : -5000)
            ).toISOString()
      heartbeat({ updatedAt })
      expect(captureFocusedWindow()).toBe(true)
      expect(commands().some((command) => command.command === "capture")).toBe(
        false
      )
      await vi.advanceTimersByTimeAsync(500)
      expect(launchArguments()).toContain("--capture-once")
      expect(state.spawn).toHaveBeenCalledTimes(1)
    }
  )

  it("replaces a permission-only helper before issuing a capture request", async () => {
    heartbeat({ captureEnabled: false })
    captureFocusedWindow()
    await vi.advanceTimersByTimeAsync(500)
    expect(launchArguments()).toContain("--capture-once")
    expect(launchArguments()).not.toContain("--permission-only")
    expect(commands().some((command) => command.command === "capture")).toBe(
      false
    )
  })

  it("cancels a scheduled launch when the helper is stopped before the delay elapses", async () => {
    startScreenAwarenessHelper()
    await stopScreenAwarenessHelper()
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.spawn).not.toHaveBeenCalled()
    expect(commands().some((command) => command.command === "terminate")).toBe(
      true
    )
  })
})

describe("native termination acknowledgement", () => {
  it("disables capture immediately and waits for the native instance to acknowledge exit", async () => {
    heartbeat()
    const stopped = stopScreenAwarenessHelper()
    let finished = false
    const completion = (async () => {
      await stopped
      finished = true
    })()
    const control: unknown = JSON.parse(
      fs.readFileSync(
        path.join(configPath(), "screen-awareness-control.state"),
        "utf-8"
      )
    )
    expect(control).toMatchObject({ captureEnabled: false })
    await vi.advanceTimersByTimeAsync(100)
    expect(finished).toBe(false)
    fs.rmSync(path.join(configPath(), "screen-awareness-status.json"))
    await vi.waitFor(() => expect(finished).toBe(true))
    await completion
  })

  it("reports an unacknowledged native stop instead of treating a queued command as a completed shutdown", async () => {
    heartbeat()
    const stopped = stopScreenAwarenessHelper()
    const rejected = expect(stopped).rejects.toThrow(
      "did not acknowledge termination"
    )
    await vi.advanceTimersByTimeAsync(1500)
    await rejected
  })
})

describe("read-only permission status", () => {
  it("reads a fresh permission-only heartbeat without enabling capture", async () => {
    writeInstalledExecutable()
    state.enabled = false
    heartbeat({ captureEnabled: false })
    expect(await getScreenAwarenessPermissionStatus()).toEqual({
      accessibility: "granted",
      screenRecording: "granted"
    })
    expect(state.execFile).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
    expect(commands()).toEqual([])
  })

  it.each(["missing", "stale", "nan", "future"])(
    "queries only --status-json for a %s heartbeat without starting capture",
    async (kind) => {
      writeInstalledExecutable()
      state.enabled = false
      if (kind !== "missing") {
        heartbeat({
          updatedAt:
            kind === "nan"
              ? "not-a-date"
              : new Date(
                  Date.now() + (kind === "future" ? 1000 : -5000)
                ).toISOString()
        })
      }
      expect(await getScreenAwarenessPermissionStatus()).toEqual({
        accessibility: "granted",
        screenRecording: "not-granted"
      })
      expect(state.execFile).toHaveBeenCalledWith(
        installedExecutable(),
        ["--status-json"],
        expect.objectContaining({ maxBuffer: 8192, timeout: 3000 })
      )
      expect(state.spawn).not.toHaveBeenCalled()
      expect(commands()).toEqual([])
    }
  )

  it("reports unverified permissions when the read-only native query fails", async () => {
    writeInstalledExecutable()
    state.execFile.mockRejectedValue(new Error("Native query failed"))
    expect(await getScreenAwarenessPermissionStatus()).toEqual({
      accessibility: "not-granted",
      screenRecording: "not-granted"
    })
    expect(state.spawn).not.toHaveBeenCalled()
  })
})
