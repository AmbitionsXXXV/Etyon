import { electronAPI } from "@electron-toolkit/preload"
import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"

const TERMINAL_DATA_CHANNEL = "terminal:data"
const TERMINAL_INPUT_CHANNEL = "terminal:input"

export interface TerminalDataPayload {
  data: string
  sessionId: string
}

export interface TerminalPreloadApi {
  onTerminalData: (
    callback: (payload: TerminalDataPayload) => void
  ) => () => void
  sendTerminalInput: (sessionId: string, data: string) => void
}

export type EtyonElectronApi = typeof electronAPI & TerminalPreloadApi

const isTerminalDataPayload = (
  payload: unknown
): payload is TerminalDataPayload => {
  if (!payload || typeof payload !== "object") {
    return false
  }

  const candidate = payload as Partial<TerminalDataPayload>

  return (
    typeof candidate.data === "string" &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0
  )
}

// eslint-disable-next-line promise/prefer-await-to-callbacks -- Electron IPC subscriptions are callback-driven.
const onTerminalData: TerminalPreloadApi["onTerminalData"] = (callback) => {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isTerminalDataPayload(payload)) {
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Delivering an Electron IPC event is synchronous.
      callback(payload)
    }
  }

  ipcRenderer.on(TERMINAL_DATA_CHANNEL, listener)

  return () => {
    ipcRenderer.removeListener(TERMINAL_DATA_CHANNEL, listener)
  }
}

const sendTerminalInput: TerminalPreloadApi["sendTerminalInput"] = (
  sessionId,
  data
) => {
  ipcRenderer.send(TERMINAL_INPUT_CHANNEL, { data, sessionId })
}

const etyonElectronAPI: EtyonElectronApi = {
  ...electronAPI,
  onTerminalData,
  sendTerminalInput
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", etyonElectronAPI)
} else {
  window.electron = etyonElectronAPI
}

window.addEventListener("message", (event) => {
  if (event.data === "start-orpc-client") {
    const [serverPort] = event.ports
    ipcRenderer.postMessage("start-orpc-server", null, [serverPort])
  }
})
