import { electronAPI } from "@electron-toolkit/preload"
import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"

const BROWSER_STATE_CHANNEL = "browser:state"
const TERMINAL_DATA_CHANNEL = "terminal:data"
const TERMINAL_INPUT_CHANNEL = "terminal:input"

export interface TerminalDataPayload {
  data: string
  sessionId: string
}

export interface BrowserStatePayload {
  initiator: "agent" | "user"
  sessionId: string
  state: {
    canGoBack: boolean
    canGoForward: boolean
    faviconUrl?: string
    isLoading: boolean
    title: string
    url: string
  }
}

export interface TerminalPreloadApi {
  onTerminalData: (
    callback: (payload: TerminalDataPayload) => void
  ) => () => void
  sendTerminalInput: (sessionId: string, data: string) => void
}

export interface BrowserPreloadApi {
  onBrowserState: (
    callback: (payload: BrowserStatePayload) => void
  ) => () => void
}

export type EtyonElectronApi = typeof electronAPI &
  BrowserPreloadApi &
  TerminalPreloadApi

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

const isBrowserStatePayload = (
  payload: unknown
): payload is BrowserStatePayload => {
  if (!payload || typeof payload !== "object") {
    return false
  }

  const candidate = payload as Partial<BrowserStatePayload>

  if (
    (candidate.initiator !== "agent" && candidate.initiator !== "user") ||
    typeof candidate.sessionId !== "string" ||
    candidate.sessionId.length === 0 ||
    !candidate.state ||
    typeof candidate.state !== "object"
  ) {
    return false
  }

  const { state } = candidate

  return (
    typeof state.canGoBack === "boolean" &&
    typeof state.canGoForward === "boolean" &&
    typeof state.isLoading === "boolean" &&
    typeof state.title === "string" &&
    typeof state.url === "string"
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

// eslint-disable-next-line promise/prefer-await-to-callbacks -- Electron IPC subscriptions are callback-driven.
const onBrowserState: BrowserPreloadApi["onBrowserState"] = (callback) => {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isBrowserStatePayload(payload)) {
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Delivering an Electron IPC event is synchronous.
      callback(payload)
    }
  }

  ipcRenderer.on(BROWSER_STATE_CHANNEL, listener)

  return () => {
    ipcRenderer.removeListener(BROWSER_STATE_CHANNEL, listener)
  }
}

const etyonElectronAPI: EtyonElectronApi = {
  ...electronAPI,
  onBrowserState,
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
