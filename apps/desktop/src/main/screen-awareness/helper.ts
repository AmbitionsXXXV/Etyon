import { execFile, spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import fsPromises from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

import { platform } from "@electron-toolkit/utils"
import type { LocalePreference } from "@etyon/i18n"
import { app } from "electron"

import { getAppConfigDir } from "@/main/app-paths"
import { logger } from "@/main/logger"
import { getSettings } from "@/main/settings"

const HELPER_APP_NAME = "Etyon Screen Awareness.app" as const
const HELPER_CAPTURE_DIRECTORY_NAME = "screen-awareness-captures" as const
const HELPER_CONTROL_FILE_NAME = "screen-awareness-control" as const
const HELPER_EXECUTABLE_NAME = "EtyonScreenAwareness" as const
const HELPER_INSTALL_DIRECTORY_NAME = "screen-awareness" as const
const HELPER_LAUNCH_DELAY_MS = 500 as const
const STATUS_FILE_NAME = "screen-awareness-status.json" as const

export interface ScreenAwarenessPermissionStatus {
  accessibility: "granted" | "not-granted"
  screenRecording: "granted" | "not-granted"
}

let helperProcess: ChildProcess | null = null
let launchGeneration = 0
const execFileAsync = promisify(execFile)

const getBundledHelperAppPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "screen-awareness", HELPER_APP_NAME)
    : path.join(
        app.getAppPath(),
        "resources",
        "screen-awareness",
        HELPER_APP_NAME
      )

const getHelperExecutablePath = (helperAppPath: string): string =>
  path.join(helperAppPath, "Contents", "MacOS", HELPER_EXECUTABLE_NAME)

const getInstalledHelperAppPath = (): string =>
  path.join(
    getAppConfigDir(app.getPath("home")),
    HELPER_INSTALL_DIRECTORY_NAME,
    HELPER_APP_NAME
  )

const getInstalledHelperExecutablePath = (): string =>
  getHelperExecutablePath(getInstalledHelperAppPath())

const getStatusFilePath = (): string =>
  path.join(getAppConfigDir(app.getPath("home")), STATUS_FILE_NAME)

const getControlFilePath = (): string =>
  path.join(getAppConfigDir(app.getPath("home")), HELPER_CONTROL_FILE_NAME)

const enqueueHelperCommand = (
  command: "capture" | "onboard" | "terminate",
  targetInstanceId?: string
): void => {
  const directory = `${getControlFilePath()}.commands`
  fs.mkdirSync(directory, { mode: 0o700, recursive: true })
  const id = crypto.randomUUID()
  const issuedAt = Date.now()
  const destination = path.join(directory, `${issuedAt}-${id}.json`)
  const temporary = `${destination}.tmp`
  fs.writeFileSync(
    temporary,
    JSON.stringify({ command, id, issuedAt, targetInstanceId }),
    { mode: 0o600 }
  )
  fs.renameSync(temporary, destination)
  for (const entry of fs.readdirSync(directory)) {
    if (
      /^\d+-[\da-f-]{36}\.json$/iu.test(entry) &&
      issuedAt - Number(entry.split("-")[0]) > 600_000
    ) {
      fs.rmSync(path.join(directory, entry), { force: true })
    }
  }
}

export const getScreenAwarenessCaptureDirectoryPath = (): string =>
  path.join(getAppConfigDir(app.getPath("home")), HELPER_CAPTURE_DIRECTORY_NAME)

const getHelperLocale = (locale: LocalePreference): string =>
  locale === "system" ? app.getLocale() : locale

const getFileHash = (filePath: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")

const helperExecutablesMatch = (
  bundledExecutablePath: string,
  installedExecutablePath: string
): boolean => {
  if (!fs.existsSync(installedExecutablePath)) {
    return false
  }

  return (
    getFileHash(bundledExecutablePath) === getFileHash(installedExecutablePath)
  )
}

const stopHelperProcess = (): void => {
  launchGeneration += 1
  if (helperProcess?.exitCode === null) {
    helperProcess.kill("SIGTERM")
  }
  helperProcess = null

  try {
    fs.mkdirSync(path.dirname(getControlFilePath()), { recursive: true })
    fs.writeFileSync(
      `${getControlFilePath()}.state`,
      JSON.stringify({ captureEnabled: false }),
      { mode: 0o600 }
    )
    enqueueHelperCommand("terminate")
    fs.mkdirSync(path.dirname(getControlFilePath()), { recursive: true })
    fs.writeFileSync(getControlFilePath(), "terminate", "utf-8")
  } catch (error) {
    logger.error("screen_awareness_helper_stop_failed", { error })
  }
}

const installBundledHelper = (): string | null => {
  const bundledHelperAppPath = getBundledHelperAppPath()
  const bundledExecutablePath = getHelperExecutablePath(bundledHelperAppPath)
  if (!fs.existsSync(bundledExecutablePath)) {
    logger.info("screen_awareness_helper_missing", {
      helper_path: bundledExecutablePath
    })
    return null
  }

  const installedHelperAppPath = getInstalledHelperAppPath()
  const installedExecutablePath = getInstalledHelperExecutablePath()
  if (helperExecutablesMatch(bundledExecutablePath, installedExecutablePath)) {
    return installedHelperAppPath
  }

  stopHelperProcess()
  const installDirectory = path.dirname(installedHelperAppPath)
  fs.mkdirSync(installDirectory, { recursive: true })
  const stagingDirectory = fs.mkdtempSync(
    path.join(installDirectory, ".install-")
  )
  const stagedHelperAppPath = path.join(stagingDirectory, HELPER_APP_NAME)
  const previousHelperAppPath = path.join(
    installDirectory,
    `${HELPER_APP_NAME}.previous`
  )

  fs.cpSync(bundledHelperAppPath, stagedHelperAppPath, { recursive: true })
  fs.rmSync(previousHelperAppPath, { force: true, recursive: true })

  const hadPreviousHelper = fs.existsSync(installedHelperAppPath)
  if (hadPreviousHelper) {
    fs.renameSync(installedHelperAppPath, previousHelperAppPath)
  }

  try {
    fs.renameSync(stagedHelperAppPath, installedHelperAppPath)
    fs.rmSync(previousHelperAppPath, { force: true, recursive: true })
    fs.rmSync(stagingDirectory, { force: true, recursive: true })
    return installedHelperAppPath
  } catch (error) {
    if (hadPreviousHelper && !fs.existsSync(installedHelperAppPath)) {
      fs.renameSync(previousHelperAppPath, installedHelperAppPath)
    }
    fs.rmSync(stagingDirectory, { force: true, recursive: true })
    throw error
  }
}

const launchHelper = (args: string[]): boolean => {
  if (!platform.isMacOS) {
    return false
  }

  let helperAppPath: string | null
  try {
    helperAppPath = installBundledHelper()
  } catch (error) {
    logger.error("screen_awareness_helper_install_failed", { error })
    return false
  }

  if (!helperAppPath) {
    return false
  }

  stopHelperProcess()
  const scheduledLaunchGeneration = launchGeneration
  const locale = getHelperLocale(getSettings().locale)
  const instanceId = crypto.randomUUID()
  setTimeout(() => {
    if (scheduledLaunchGeneration !== launchGeneration) {
      return
    }

    try {
      fs.rmSync(getControlFilePath(), { force: true })
    } catch (error) {
      logger.error("screen_awareness_helper_control_reset_failed", { error })
      return
    }

    const child = spawn(
      "/usr/bin/open",
      [
        "-na",
        helperAppPath,
        "--args",
        ...args,
        "--locale",
        locale,
        "--host-pid",
        String(process.pid),
        "--instance-id",
        instanceId,
        "--status-file",
        getStatusFilePath(),
        "--control-file",
        getControlFilePath(),
        "--capture-directory",
        getScreenAwarenessCaptureDirectoryPath()
      ],
      { stdio: "ignore" }
    )

    child.once("error", (error) => {
      logger.error("screen_awareness_helper_start_failed", { error })
    })
    child.once("exit", (code, signal) => {
      if (helperProcess === child) {
        helperProcess = null
      }

      if (code !== 0 && signal !== "SIGTERM") {
        logger.error("screen_awareness_helper_exited", { code, signal })
      }
    })
    helperProcess = child
  }, HELPER_LAUNCH_DELAY_MS)

  // An older helper cannot produce another capture after a replacement launch.
  fs.writeFileSync(
    `${getControlFilePath()}.state`,
    JSON.stringify({
      captureEnabled: !args.includes("--permission-only"),
      instanceId
    }),
    { mode: 0o600 }
  )

  return true
}

const queryNativePermissionStatus =
  async (): Promise<ScreenAwarenessPermissionStatus> => {
    try {
      const { stdout } = await execFileAsync(
        getInstalledHelperExecutablePath(),
        ["--status-json"],
        { maxBuffer: 8192, timeout: 3000 }
      )
      const value: unknown = JSON.parse(stdout)
      if (
        value &&
        typeof value === "object" &&
        "accessibility" in value &&
        "screenRecording" in value
      ) {
        return {
          accessibility:
            value.accessibility === "granted" ? "granted" : "not-granted",
          screenRecording:
            value.screenRecording === "granted" ? "granted" : "not-granted"
        }
      }
    } catch (error) {
      logger.error("screen_awareness_permission_query_failed", { error })
    }
    return { accessibility: "not-granted", screenRecording: "not-granted" }
  }

export const getScreenAwarenessPermissionStatus =
  async (): Promise<ScreenAwarenessPermissionStatus> => {
    if (
      !platform.isMacOS ||
      !fs.existsSync(getInstalledHelperExecutablePath())
    ) {
      return {
        accessibility: "not-granted",
        screenRecording: "not-granted"
      }
    }

    try {
      const statusJson = await fsPromises.readFile(getStatusFilePath(), "utf-8")
      const value: unknown = JSON.parse(statusJson)
      if (
        !value ||
        typeof value !== "object" ||
        !("updatedAt" in value) ||
        typeof value.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(value.updatedAt)) ||
        Date.now() - Date.parse(value.updatedAt) < 0 ||
        Date.now() - Date.parse(value.updatedAt) > 3000 ||
        !("accessibility" in value) ||
        !("screenRecording" in value)
      ) {
        return await queryNativePermissionStatus()
      }
      return {
        accessibility:
          value.accessibility === "granted" ? "granted" : "not-granted",
        screenRecording:
          value.screenRecording === "granted" ? "granted" : "not-granted"
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error("screen_awareness_status_read_failed", { error })
      }
      return await queryNativePermissionStatus()
    }
  }

const sendHelperCommand = (
  command: "capture" | "onboard",
  launchArgument: string,
  permissionOnly = false
): boolean => {
  if (!platform.isMacOS) {
    return false
  }
  try {
    const value: unknown = JSON.parse(
      fs.readFileSync(getStatusFilePath(), "utf-8")
    )
    if (
      value &&
      typeof value === "object" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt)) &&
      Date.now() - Date.parse(value.updatedAt) >= 0 &&
      Date.now() - Date.parse(value.updatedAt) < 3000 &&
      "instanceId" in value &&
      typeof value.instanceId === "string" &&
      "captureEnabled" in value &&
      value.captureEnabled === !permissionOnly
    ) {
      enqueueHelperCommand(command, value.instanceId)
      return true
    }
  } catch {
    // A missing or stale heartbeat requires launching the installed helper.
  }
  return launchHelper(
    permissionOnly ? [launchArgument, "--permission-only"] : [launchArgument]
  )
}

export const showScreenAwarenessOnboarding = (): boolean =>
  sendHelperCommand(
    "onboard",
    "--onboard",
    !getSettings().screenAwareness.enabled
  )

export const captureFocusedWindow = (): boolean =>
  getSettings().screenAwareness.enabled &&
  sendHelperCommand("capture", "--capture-once")

export const startScreenAwarenessHelper = (): boolean =>
  launchHelper(["--background"])

export const stopScreenAwarenessHelper = async (): Promise<void> => {
  if (!platform.isMacOS) {
    return
  }
  let liveInstanceId: string | null = null
  try {
    const value: unknown = JSON.parse(
      fs.readFileSync(getStatusFilePath(), "utf-8")
    )
    if (
      value &&
      typeof value === "object" &&
      "instanceId" in value &&
      typeof value.instanceId === "string" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "string" &&
      Date.now() - Date.parse(value.updatedAt) >= 0 &&
      Date.now() - Date.parse(value.updatedAt) < 3000
    ) {
      liveInstanceId = value.instanceId
    }
  } catch {
    /* An absent heartbeat has no live instance to await. */
  }
  stopHelperProcess()
  if (!liveInstanceId) {
    return
  }
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    await delay(25)
    try {
      const value: unknown = JSON.parse(
        await fsPromises.readFile(getStatusFilePath(), "utf-8")
      )
      if (
        !value ||
        typeof value !== "object" ||
        !("instanceId" in value) ||
        value.instanceId !== liveInstanceId
      ) {
        return
      }
    } catch {
      return
    }
  }
  throw new Error(
    "Screen awareness helper did not acknowledge termination. Capture is disabled; retry clearing after the helper exits."
  )
}
