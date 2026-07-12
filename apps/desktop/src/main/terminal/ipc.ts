import { ipcMain } from "electron"

import { logger } from "@/main/logger"
import { subscribePtyData, writeToPty } from "@/main/terminal/pty-manager"
import { getMainWindow } from "@/main/window"

const TERMINAL_DATA_CHANNEL = "terminal:data"
const TERMINAL_INPUT_CHANNEL = "terminal:input"

interface TerminalInputPayload {
  data: string
  sessionId: string
}

const isTerminalInputPayload = (
  payload: unknown
): payload is TerminalInputPayload => {
  if (!payload || typeof payload !== "object") {
    return false
  }

  const candidate = payload as Partial<TerminalInputPayload>

  return (
    typeof candidate.data === "string" &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0
  )
}

export const registerTerminalIpcHandlers = (): void => {
  subscribePtyData((sessionId, data) => {
    const window = getMainWindow()

    if (!window || window.webContents.isDestroyed()) {
      return
    }

    window.webContents.send(TERMINAL_DATA_CHANNEL, { data, sessionId })
  })

  ipcMain.removeAllListeners(TERMINAL_INPUT_CHANNEL)
  ipcMain.on(TERMINAL_INPUT_CHANNEL, (_event, payload: unknown) => {
    if (!isTerminalInputPayload(payload)) {
      return
    }

    try {
      writeToPty(payload.sessionId, payload.data)
    } catch (error) {
      logger.error("terminal_input_failed", {
        error,
        sessionId: payload.sessionId
      })
    }
  })
}
