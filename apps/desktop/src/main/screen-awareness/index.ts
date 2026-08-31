import { ipcMain } from "electron"

import {
  getScreenAwarenessPermissionStatus,
  showScreenAwarenessOnboarding,
  startScreenAwarenessHelper,
  stopScreenAwarenessHelper
} from "@/main/screen-awareness/helper"

const GET_SCREEN_AWARENESS_STATUS_CHANNEL =
  "screen-awareness:get-permission-status" as const
const OPEN_SCREEN_AWARENESS_ONBOARDING_CHANNEL =
  "screen-awareness:open-onboarding" as const

export const registerScreenAwarenessIpcHandlers = (): void => {
  ipcMain.removeHandler(GET_SCREEN_AWARENESS_STATUS_CHANNEL)
  ipcMain.handle(GET_SCREEN_AWARENESS_STATUS_CHANNEL, () =>
    getScreenAwarenessPermissionStatus()
  )

  ipcMain.removeHandler(OPEN_SCREEN_AWARENESS_ONBOARDING_CHANNEL)
  ipcMain.handle(OPEN_SCREEN_AWARENESS_ONBOARDING_CHANNEL, () =>
    showScreenAwarenessOnboarding()
  )
}

export {
  showScreenAwarenessOnboarding,
  startScreenAwarenessHelper,
  stopScreenAwarenessHelper
}
