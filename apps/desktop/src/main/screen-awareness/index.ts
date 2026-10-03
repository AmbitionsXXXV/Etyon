import { ipcMain } from "electron"

import { logger } from "@/main/logger"
import {
  assignScreenAwarenessCapture,
  clearPendingScreenAwarenessCaptures,
  dismissScreenAwarenessCapture,
  listPendingScreenAwarenessCaptures,
  removeScreenAwarenessCaptureContent,
  startScreenAwarenessCaptureEvents,
  stopScreenAwarenessCaptureEvents
} from "@/main/screen-awareness/capture-events"
import {
  captureFocusedWindow,
  getScreenAwarenessPermissionStatus,
  showScreenAwarenessOnboarding,
  startScreenAwarenessHelper as launchScreenAwarenessHelper,
  stopScreenAwarenessHelper as terminateScreenAwarenessHelper
} from "@/main/screen-awareness/helper"
import { getSettings } from "@/main/settings"

const GET_SCREEN_AWARENESS_STATUS_CHANNEL =
  "screen-awareness:get-permission-status" as const
const OPEN_SCREEN_AWARENESS_ONBOARDING_CHANNEL =
  "screen-awareness:open-onboarding" as const

export const registerScreenAwarenessIpcHandlers = (): void => {
  for (const channel of [
    "screen-awareness:assign",
    "screen-awareness:capture",
    "screen-awareness:clear",
    "screen-awareness:dismiss",
    "screen-awareness:list",
    "screen-awareness:remove-content"
  ]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle("screen-awareness:list", () =>
    getSettings().screenAwareness.enabled
      ? listPendingScreenAwarenessCaptures()
      : []
  )
  ipcMain.handle("screen-awareness:capture", () => captureFocusedWindow())
  ipcMain.handle("screen-awareness:clear", () =>
    clearPendingScreenAwarenessCaptures()
  )
  ipcMain.handle(
    "screen-awareness:remove-content",
    (_event, id: unknown, part: unknown) => {
      if (typeof id !== "string" || (part !== "image" && part !== "text")) {
        throw new TypeError("Invalid capture content")
      }
      return removeScreenAwarenessCaptureContent(id, part)
    }
  )
  ipcMain.handle("screen-awareness:dismiss", (_event, id: unknown) => {
    if (typeof id !== "string") {
      throw new TypeError("Invalid capture id")
    }
    return dismissScreenAwarenessCapture(id)
  })
  ipcMain.handle(
    "screen-awareness:assign",
    (_event, id: unknown, sessionId: unknown) => {
      if (!getSettings().screenAwareness.enabled) {
        throw new Error("Screen awareness is disabled")
      }
      if (
        typeof id !== "string" ||
        typeof sessionId !== "string" ||
        sessionId.length > 100 ||
        sessionId.length === 0
      ) {
        throw new TypeError("Invalid capture destination")
      }
      return assignScreenAwarenessCapture(id, sessionId)
    }
  )
  ipcMain.removeHandler(GET_SCREEN_AWARENESS_STATUS_CHANNEL)
  ipcMain.handle(GET_SCREEN_AWARENESS_STATUS_CHANNEL, () =>
    getScreenAwarenessPermissionStatus()
  )

  ipcMain.removeHandler(OPEN_SCREEN_AWARENESS_ONBOARDING_CHANNEL)
  ipcMain.handle(OPEN_SCREEN_AWARENESS_ONBOARDING_CHANNEL, () =>
    showScreenAwarenessOnboarding()
  )
}

export const startScreenAwarenessHelper = (): boolean => {
  if (!getSettings().screenAwareness.enabled) {
    void (async () => {
      try {
        await clearPendingScreenAwarenessCaptures()
      } catch (error) {
        logger.error("screen_awareness_cleanup_failed", { error })
      }
    })()
    return false
  }
  startScreenAwarenessCaptureEvents()
  return launchScreenAwarenessHelper()
}

export const stopScreenAwarenessHelper = async (): Promise<void> => {
  stopScreenAwarenessCaptureEvents()
  await terminateScreenAwarenessHelper()
  if (!getSettings().screenAwareness.enabled) {
    await clearPendingScreenAwarenessCaptures()
  }
}

export {
  captureFocusedWindow,
  showScreenAwarenessOnboarding,
  getScreenAwarenessPermissionStatus
}
