import type {
  UpdateCheckErrorCode,
  UpdateCheckReason,
  UpdateStatus
} from "@etyon/rpc"
import { app, BrowserWindow, net, shell } from "electron"

import {
  getRuntimeBuildIdentifier,
  isRuntimeReleaseBuild
} from "@/main/app-paths"
import { logger } from "@/main/logger"
import { getSettings } from "@/main/settings"
import { isAllowedReleaseUrl, parseLatestRelease } from "@/main/updates/core"
import { createSettingsWindow } from "@/main/window"

const LATEST_RELEASE_ENDPOINT =
  "https://api.github.com/repos/AmbitionsXXXV/Etyon/releases/latest"
const REQUEST_TIMEOUT_MS = 10_000
const FIRST_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const UPDATES_STATUS_CHANNEL = "updates:status-changed"
const ABOUT_SETTINGS_TAB = "about"

type ReleaseFetchResult =
  | { errorCode: UpdateCheckErrorCode; ok: false }
  | { ok: true; payload: unknown }

let cachedStatus: null | UpdateStatus = null
let inFlightCheck: null | Promise<UpdateStatus> = null

const createIdleStatus = (): UpdateStatus => ({
  available: null,
  buildIdentifier: getRuntimeBuildIdentifier(),
  checkReason: null,
  currentVersion: app.getVersion(),
  errorCode: null,
  lastCheckedAt: null,
  state: "idle"
})

const readStatus = (): UpdateStatus => {
  cachedStatus ??= createIdleStatus()

  return cachedStatus
}

const writeStatus = (next: UpdateStatus): UpdateStatus => {
  cachedStatus = next

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATES_STATUS_CHANNEL, next)
    }
  }

  return next
}

export const getUpdateStatus = (): UpdateStatus => readStatus()

// The whole network surface of this feature: one unauthenticated GET against
// the public repository, issued from the main process through Chromium's stack
// so it inherits the app proxy settings. The renderer never sees a URL.
const fetchLatestRelease = async (): Promise<ReleaseFetchResult> => {
  let response: Response

  try {
    response = await net.fetch(LATEST_RELEASE_ENDPOINT, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Etyon/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    logger.info("updates_check_failed", { errorCode: "network", error })

    return { errorCode: "network", ok: false }
  }

  if (!response.ok) {
    logger.info("updates_check_failed", {
      errorCode: "http",
      status: response.status
    })

    return { errorCode: "http", ok: false }
  }

  try {
    return { ok: true, payload: await response.json() }
  } catch (error) {
    logger.info("updates_check_failed", {
      error,
      errorCode: "invalid-response"
    })

    return { errorCode: "invalid-response", ok: false }
  }
}

const runCheck = async (reason: UpdateCheckReason): Promise<UpdateStatus> => {
  const currentVersion = app.getVersion()
  const result = await fetchLatestRelease()
  const base = {
    buildIdentifier: getRuntimeBuildIdentifier(),
    checkReason: reason,
    currentVersion,
    lastCheckedAt: Date.now()
  }

  if (!result.ok) {
    return writeStatus({
      ...base,
      available: null,
      errorCode: result.errorCode,
      state: "error"
    })
  }

  const parsed = parseLatestRelease(result.payload, currentVersion)

  if (parsed.state === "error") {
    return writeStatus({
      ...base,
      available: null,
      errorCode: parsed.errorCode,
      state: "error"
    })
  }

  if (parsed.state === "up-to-date") {
    return writeStatus({
      ...base,
      available: null,
      errorCode: null,
      state: "up-to-date"
    })
  }

  return writeStatus({
    ...base,
    available: parsed.available,
    errorCode: null,
    state: "available"
  })
}

/**
 * Runs a check, reusing the in-flight request when one is already running so a
 * manual click during the scheduled check cannot fire two requests.
 */
export const checkForUpdates = async ({
  reason
}: {
  reason: UpdateCheckReason
}): Promise<UpdateStatus> => {
  if (inFlightCheck) {
    return await inFlightCheck
  }

  writeStatus({
    ...readStatus(),
    checkReason: reason,
    errorCode: null,
    state: "checking"
  })

  const pending = runCheck(reason)

  inFlightCheck = pending

  try {
    return await pending
  } finally {
    inFlightCheck = null
  }
}

const openReleaseUrl = async (url: null | string): Promise<boolean> => {
  if (!url || !isAllowedReleaseUrl(url)) {
    return false
  }

  await shell.openExternal(url)

  return true
}

export const openUpdateDownload = (): Promise<boolean> => {
  const { available } = readStatus()

  return openReleaseUrl(available?.dmgUrl ?? available?.htmlUrl ?? null)
}

export const openUpdateReleasePage = (): Promise<boolean> => {
  const { available } = readStatus()

  return openReleaseUrl(available?.htmlUrl ?? null)
}

/** Menu entry target: reveal the About tab and refresh the status behind it. */
export const openUpdatesSettings = (): void => {
  createSettingsWindow(ABOUT_SETTINGS_TAB)

  void checkForUpdates({ reason: "manual" })
}

const runAutoCheck = async (): Promise<void> => {
  if (!getSettings().updates.autoCheck) {
    return
  }

  try {
    await checkForUpdates({ reason: "auto" })
  } catch (error) {
    logger.error("updates_auto_check_failed", { error })
  }
}

/**
 * Schedules background checks for packaged builds only. Development builds keep
 * the manual button so the About tab stays testable without shipping a release.
 */
export const setupUpdates = (): void => {
  if (!isRuntimeReleaseBuild()) {
    return
  }

  setTimeout(() => void runAutoCheck(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void runAutoCheck(), CHECK_INTERVAL_MS)
}
