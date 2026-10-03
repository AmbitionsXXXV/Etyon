import { electronAPI } from "@electron-toolkit/preload"
import type { AvailableUpdate, UpdateStatus } from "@etyon/rpc"
import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"

import {
  isScreenAwarenessCapturePayload,
  SCREEN_AWARENESS_CAPTURE_CHANNEL,
  SCREEN_AWARENESS_ERROR_CHANNEL,
  type ScreenAwarenessCaptureError,
  type ScreenAwarenessCapturePayload
} from "@/shared/screen-awareness"

const BROWSER_STATE_CHANNEL = "browser:state"
const TERMINAL_DATA_CHANNEL = "terminal:data"
const TERMINAL_INPUT_CHANNEL = "terminal:input"
const UPDATES_STATUS_CHANNEL = "updates:status-changed"

const UPDATE_BUILD_IDENTIFIERS = new Set<UpdateStatus["buildIdentifier"]>([
  "development",
  "release"
])
const UPDATE_CHECK_ERROR_CODES = new Set<
  NonNullable<UpdateStatus["errorCode"]>
>(["http", "invalid-response", "network"])
const UPDATE_CHECK_REASONS = new Set<NonNullable<UpdateStatus["checkReason"]>>([
  "auto",
  "manual"
])
const UPDATE_STATES = new Set<UpdateStatus["state"]>([
  "available",
  "checking",
  "error",
  "idle",
  "up-to-date"
])

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

export interface UpdatesPreloadApi {
  onUpdatesStatusChanged: (
    callback: (payload: UpdateStatus) => void
  ) => () => void
}

export interface ScreenAwarenessPreloadApi {
  clearScreenAwarenessCaptures: () => Promise<void>
  assignScreenAwarenessCapture: (
    id: string,
    sessionId: string
  ) => Promise<ScreenAwarenessCapturePayload>
  captureFocusedWindow: () => Promise<boolean>
  dismissScreenAwarenessCapture: (id: string) => Promise<void>
  listScreenAwarenessCaptures: () => Promise<ScreenAwarenessCapturePayload[]>
  removeScreenAwarenessCaptureContent: (
    id: string,
    part: "image" | "text"
  ) => Promise<void>
  onScreenAwarenessError: (
    callback: (payload: ScreenAwarenessCaptureError) => void
  ) => () => void
  onScreenAwarenessCapture: (
    callback: (payload: ScreenAwarenessCapturePayload) => void
  ) => () => void
}

type UpdatesStatusListener = UpdatesPreloadApi["onUpdatesStatusChanged"]

export type EtyonElectronApi = typeof electronAPI &
  BrowserPreloadApi &
  ScreenAwarenessPreloadApi &
  TerminalPreloadApi &
  UpdatesPreloadApi

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

const isAvailableUpdate = (value: unknown): value is AvailableUpdate => {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<AvailableUpdate>

  return (
    (candidate.dmgSizeBytes === null ||
      (typeof candidate.dmgSizeBytes === "number" &&
        Number.isSafeInteger(candidate.dmgSizeBytes) &&
        candidate.dmgSizeBytes >= 0)) &&
    (candidate.dmgUrl === null || typeof candidate.dmgUrl === "string") &&
    typeof candidate.htmlUrl === "string" &&
    (candidate.notes === null || typeof candidate.notes === "string") &&
    (candidate.publishedAt === null ||
      typeof candidate.publishedAt === "string") &&
    typeof candidate.tagName === "string" &&
    typeof candidate.version === "string" &&
    candidate.version.length > 0
  )
}

const isUpdateStatusPayload = (payload: unknown): payload is UpdateStatus => {
  if (!payload || typeof payload !== "object") {
    return false
  }

  const candidate = payload as Partial<UpdateStatus>

  return (
    typeof candidate.buildIdentifier === "string" &&
    UPDATE_BUILD_IDENTIFIERS.has(candidate.buildIdentifier) &&
    (candidate.checkReason === null ||
      (typeof candidate.checkReason === "string" &&
        UPDATE_CHECK_REASONS.has(candidate.checkReason))) &&
    (candidate.errorCode === null ||
      (typeof candidate.errorCode === "string" &&
        UPDATE_CHECK_ERROR_CODES.has(candidate.errorCode))) &&
    (candidate.lastCheckedAt === null ||
      (typeof candidate.lastCheckedAt === "number" &&
        Number.isFinite(candidate.lastCheckedAt))) &&
    typeof candidate.state === "string" &&
    UPDATE_STATES.has(candidate.state) &&
    typeof candidate.currentVersion === "string" &&
    (candidate.available === null || isAvailableUpdate(candidate.available))
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

// eslint-disable-next-line promise/prefer-await-to-callbacks -- Electron IPC subscriptions are callback-driven.
const onUpdatesStatusChanged: UpdatesStatusListener = (callback) => {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isUpdateStatusPayload(payload)) {
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Delivering an Electron IPC event is synchronous.
      callback(payload)
    }
  }

  ipcRenderer.on(UPDATES_STATUS_CHANNEL, listener)

  return () => {
    ipcRenderer.removeListener(UPDATES_STATUS_CHANNEL, listener)
  }
}

// eslint-disable-next-line promise/prefer-await-to-callbacks -- Electron IPC subscriptions are callback-driven.
const onScreenAwarenessCapture: ScreenAwarenessPreloadApi["onScreenAwarenessCapture"] =
  (callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      if (isScreenAwarenessCapturePayload(payload)) {
        // eslint-disable-next-line promise/prefer-await-to-callbacks -- Delivering an Electron IPC event is synchronous.
        callback(payload)
      }
    }

    ipcRenderer.on(SCREEN_AWARENESS_CAPTURE_CHANNEL, listener)

    return () => {
      ipcRenderer.removeListener(SCREEN_AWARENESS_CAPTURE_CHANNEL, listener)
    }
  }

// eslint-disable-next-line promise/prefer-await-to-callbacks -- Electron IPC subscriptions are callback-driven.
const onScreenAwarenessError: ScreenAwarenessPreloadApi["onScreenAwarenessError"] =
  (callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      if (
        payload &&
        typeof payload === "object" &&
        "code" in payload &&
        "id" in payload &&
        typeof payload.code === "string" &&
        typeof payload.id === "string"
      ) {
        callback(payload as ScreenAwarenessCaptureError)
      }
    }
    ipcRenderer.on(SCREEN_AWARENESS_ERROR_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(SCREEN_AWARENESS_ERROR_CHANNEL, listener)
    }
  }

const etyonElectronAPI: EtyonElectronApi = {
  ...electronAPI,
  assignScreenAwarenessCapture: async (id, sessionId) => {
    const value: unknown = await ipcRenderer.invoke(
      "screen-awareness:assign",
      id,
      sessionId
    )
    if (!isScreenAwarenessCapturePayload(value)) {
      throw new Error("Invalid capture assignment response")
    }
    return value
  },
  captureFocusedWindow: async () =>
    Boolean(await ipcRenderer.invoke("screen-awareness:capture")),
  clearScreenAwarenessCaptures: async () => {
    await ipcRenderer.invoke("screen-awareness:clear")
  },
  dismissScreenAwarenessCapture: async (id) => {
    await ipcRenderer.invoke("screen-awareness:dismiss", id)
  },
  listScreenAwarenessCaptures: async () => {
    const value: unknown = await ipcRenderer.invoke("screen-awareness:list")
    return Array.isArray(value)
      ? value.filter(isScreenAwarenessCapturePayload)
      : []
  },
  onBrowserState,
  onScreenAwarenessCapture,
  onScreenAwarenessError,
  onTerminalData,
  onUpdatesStatusChanged,
  removeScreenAwarenessCaptureContent: async (id, part) => {
    await ipcRenderer.invoke("screen-awareness:remove-content", id, part)
  },
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
