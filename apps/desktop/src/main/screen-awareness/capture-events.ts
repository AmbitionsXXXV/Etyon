import fs from "node:fs"
import fsPromises from "node:fs/promises"
import path from "node:path"

import { logger } from "@/main/logger"
import { getScreenAwarenessCaptureDirectoryPath } from "@/main/screen-awareness/helper"
import { focusOrCreateMainWindow, getMainWindow } from "@/main/window"
import {
  SCREEN_AWARENESS_CAPTURE_CHANNEL,
  SCREEN_AWARENESS_CAPTURE_TTL_MS,
  SCREEN_AWARENESS_ERROR_CHANNEL,
  SCREEN_AWARENESS_MAX_CAPTURES,
  type ScreenAwarenessCapturePayload
} from "@/shared/screen-awareness"

const EVENT_FILE_PATTERN = /^[\da-f-]{36}\.json$/iu
const EVENT_KINDS = new Set<unknown>(["error", "ready"])
const MAX_EVENT_BYTES = 256 * 1024
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024
const MAX_ICON_BYTES = 2 * 1024 * 1024
const MAX_TEXT_CHARACTERS = 24_000

interface CaptureEventRecord {
  accessibleText?: string
  appBundleId?: string
  appIconPath?: string
  appName: string
  capturedAt: string
  errorCode?: string
  id: string
  imagePath?: string
  kind: "error" | "ready"
  mediaType: "image/png"
  revision?: number
  selectedText?: string
  sessionId?: string
  warnings?: string[]
  windowId?: number
  windowTitle?: string
}

let captureWatcher: fs.FSWatcher | null = null
let pruneTimer: ReturnType<typeof setInterval> | null = null
let pendingReadTimer: ReturnType<typeof setTimeout> | null = null
let activeRead: Promise<void> = Promise.resolve()
let captureGeneration = 0
const captures = new Map<string, ScreenAwarenessCapturePayload>()

const isOptionalString = (value: unknown, maxLength: number): boolean =>
  value === undefined ||
  (typeof value === "string" && value.length <= maxLength)

const isCaptureMetadata = (record: Record<string, unknown>): boolean =>
  (record.revision === undefined ||
    (Number.isSafeInteger(record.revision) && Number(record.revision) >= 0)) &&
  (record.warnings === undefined ||
    (Array.isArray(record.warnings) &&
      record.warnings.length <= 16 &&
      record.warnings.every(
        (warning) => typeof warning === "string" && warning.length <= 100
      ))) &&
  (record.windowId === undefined ||
    (Number.isSafeInteger(record.windowId) && Number(record.windowId) > 0))

export const isCaptureEventRecord = (
  value: unknown
): value is CaptureEventRecord => {
  if (!value || typeof value !== "object") {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.id === "string" &&
    EVENT_FILE_PATTERN.test(`${record.id}.json`) &&
    typeof record.appName === "string" &&
    record.appName.length > 0 &&
    record.appName.length <= 256 &&
    typeof record.capturedAt === "string" &&
    Number.isFinite(Date.parse(record.capturedAt)) &&
    EVENT_KINDS.has(record.kind) &&
    record.mediaType === "image/png" &&
    isOptionalString(record.appBundleId, 256) &&
    isOptionalString(record.windowTitle, 1000) &&
    isOptionalString(record.accessibleText, MAX_TEXT_CHARACTERS + 512) &&
    isOptionalString(record.selectedText, MAX_TEXT_CHARACTERS) &&
    isOptionalString(record.imagePath, 4096) &&
    isOptionalString(record.appIconPath, 4096) &&
    isOptionalString(record.errorCode, 100) &&
    isOptionalString(record.sessionId, 100) &&
    isCaptureMetadata(record)
  )
}

const readCaptureFile = async (
  filePath: string,
  maxBytes: number
): Promise<Buffer> => {
  const directory = await fsPromises.realpath(
    getScreenAwarenessCaptureDirectoryPath()
  )
  const actualPath = await fsPromises.realpath(filePath)
  if (
    path.dirname(actualPath) !== directory ||
    path.resolve(filePath) !== actualPath
  ) {
    throw new Error("Capture file escaped its private directory")
  }
  const handle = await fsPromises.open(
    actualPath,
    fs.constants.O_RDONLY + fs.constants.O_NOFOLLOW
  )
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error("Capture file is invalid or too large")
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

const eventFilePath = (id: string): string => {
  if (!EVENT_FILE_PATTERN.test(`${id}.json`)) {
    throw new Error("Invalid capture id")
  }
  return path.join(getScreenAwarenessCaptureDirectoryPath(), `${id}.json`)
}

const readRecord = async (id: string): Promise<CaptureEventRecord> => {
  const bytes = await readCaptureFile(eventFilePath(id), MAX_EVENT_BYTES)
  const value: unknown = JSON.parse(bytes.toString("utf-8"))
  if (!isCaptureEventRecord(value) || value.id !== id) {
    throw new Error("Invalid capture event")
  }
  return value
}

const removeRecordFiles = async (record: CaptureEventRecord): Promise<void> => {
  const directory = path.resolve(getScreenAwarenessCaptureDirectoryPath())
  for (const filePath of [
    record.imagePath,
    record.appIconPath,
    eventFilePath(record.id)
  ]) {
    if (filePath && path.dirname(path.resolve(filePath)) === directory) {
      await fsPromises.rm(filePath, { force: true })
    }
  }
  captures.delete(record.id)
  getMainWindow()?.webContents.send(
    "screen-awareness:capture-dismissed",
    record.id
  )
}

const sendToMainWindow = (channel: string, payload: unknown): void => {
  const window = focusOrCreateMainWindow()
  const send = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once("did-finish-load", send)
  } else {
    send()
  }
}

const buildCapturePayload = async (
  record: CaptureEventRecord
): Promise<ScreenAwarenessCapturePayload> => {
  const { id } = record
  const warnings = [...(record.warnings ?? [])]
  const image = record.imagePath
    ? await readCaptureFile(record.imagePath, MAX_CAPTURE_BYTES).catch(() => {
        warnings.push("screenshot-unavailable")
        return undefined as Buffer | undefined
      })
    : undefined
  const icon = record.appIconPath
    ? await readCaptureFile(record.appIconPath, MAX_ICON_BYTES).catch(
        () => undefined as Buffer | undefined
      )
    : undefined
  if (!image && !record.accessibleText && !record.selectedText) {
    throw new Error("Capture contains no content")
  }
  const payload: ScreenAwarenessCapturePayload = {
    accessibleText: record.accessibleText,
    capturedAt: record.capturedAt,
    dataUrl: image
      ? `data:image/png;base64,${image.toString("base64")}`
      : undefined,
    id,
    mediaType: "image/png",
    revision: record.revision ?? 0,
    selectedText: record.selectedText,
    sessionId: record.sessionId,
    sourceAppBundleId: record.appBundleId,
    sourceAppIconDataUrl: icon
      ? `data:image/png;base64,${icon.toString("base64")}`
      : undefined,
    sourceAppName: record.appName,
    warnings,
    windowId: record.windowId,
    windowTitle: record.windowTitle
  }
  return payload
}

const loadCaptureEvents = async (
  notify: boolean,
  generation: number
): Promise<void> => {
  if (generation !== captureGeneration) {
    return
  }
  const directory = getScreenAwarenessCaptureDirectoryPath()
  await fsPromises.mkdir(directory, { mode: 0o700, recursive: true })
  const entries = await fsPromises.readdir(directory)
  const files = entries
    .filter((name) => EVENT_FILE_PATTERN.test(name))
    .toSorted()
  for (const fileName of files) {
    const id = fileName.slice(0, -5)
    try {
      const record = await readRecord(id)
      const age = Date.now() - Date.parse(record.capturedAt)
      if (age > SCREEN_AWARENESS_CAPTURE_TTL_MS || age < -60_000) {
        await removeRecordFiles(record)
        continue
      }
      if (captures.has(id)) {
        continue
      }
      if (record.kind === "error") {
        await removeRecordFiles(record)
        if (notify) {
          sendToMainWindow(SCREEN_AWARENESS_ERROR_CHANNEL, {
            code: record.errorCode ?? "capture-unavailable",
            id,
            sourceAppName: record.appName
          })
        }
        continue
      }
      if (captures.size >= SCREEN_AWARENESS_MAX_CAPTURES) {
        await removeRecordFiles(record)
        if (notify) {
          sendToMainWindow(SCREEN_AWARENESS_ERROR_CHANNEL, {
            code: "capture-limit",
            id
          })
        }
        continue
      }
      const payload = await buildCapturePayload(record)
      if (generation !== captureGeneration) {
        return
      }
      captures.set(id, payload)
      if (notify) {
        sendToMainWindow(SCREEN_AWARENESS_CAPTURE_CHANNEL, payload)
      }
    } catch (error) {
      captures.delete(id)
      await fsPromises.rm(path.join(directory, fileName), { force: true })
      logger.error("screen_awareness_capture_read_failed", {
        capture_id: id,
        error
      })
      if (notify) {
        sendToMainWindow(SCREEN_AWARENESS_ERROR_CHANNEL, {
          code: "capture-unavailable",
          id
        })
      }
    }
  }
  // Expired, incomplete native writes must not accumulate private screenshots.
  for (const fileName of await fsPromises.readdir(directory)) {
    if (!/^[\da-f-]{36}(?:-icon)?\.png$/iu.test(fileName)) {
      continue
    }
    const filePath = path.join(directory, fileName)
    const stat = await fsPromises.lstat(filePath)
    if (Date.now() - stat.mtimeMs > SCREEN_AWARENESS_CAPTURE_TTL_MS) {
      await fsPromises.rm(filePath, { force: true })
    }
  }
}

const runCaptureOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = activeRead
  const current = (async () => {
    try {
      await previous
    } catch {
      /* A failed read must not block later captures. */
    }
    return await operation()
  })()
  activeRead = (async () => {
    try {
      await current
    } catch {
      /* The caller receives the failure. */
    }
  })()
  return current
}

const queueRead = (notify: boolean): Promise<void> => {
  const generation = captureGeneration
  return runCaptureOperation(
    async () => await loadCaptureEvents(notify, generation)
  )
}

export const clearPendingScreenAwarenessCaptures = (): Promise<void> =>
  runCaptureOperation(async () => {
    const directory = getScreenAwarenessCaptureDirectoryPath()
    const ids = [...captures.keys()]
    captures.clear()
    let entries: string[]
    try {
      entries = await fsPromises.readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return
      }
      throw error
    }
    for (const entry of entries) {
      if (/^[\da-f-]{36}(?:\.json(?:\.tmp)?|(?:-icon)?\.png)$/iu.test(entry)) {
        await fsPromises.rm(path.join(directory, entry), { force: true })
      }
    }
    for (const id of ids) {
      getMainWindow()?.webContents.send(
        "screen-awareness:capture-dismissed",
        id
      )
    }
  })

export const listPendingScreenAwarenessCaptures = async (): Promise<
  ScreenAwarenessCapturePayload[]
> => {
  await queueRead(false)
  return [...captures.values()].toSorted((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt)
  )
}

export const assignScreenAwarenessCapture = (
  id: string,
  sessionId: string
): Promise<ScreenAwarenessCapturePayload> =>
  runCaptureOperation(async () => {
    const record = await readRecord(id)
    const assigned = {
      ...record,
      revision: (record.revision ?? 0) + 1,
      sessionId
    }
    const temporaryPath = `${eventFilePath(id)}.tmp`
    await fsPromises.writeFile(temporaryPath, JSON.stringify(assigned), {
      mode: 0o600
    })
    await fsPromises.rename(temporaryPath, eventFilePath(id))
    const payload = await buildCapturePayload(assigned)
    captures.set(id, payload)
    return payload
  })

export const dismissScreenAwarenessCapture = (id: string): Promise<void> =>
  runCaptureOperation(async () => {
    try {
      await removeRecordFiles(await readRecord(id))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
      captures.delete(id)
    }
  })

export const removeScreenAwarenessCaptureContent = (
  id: string,
  part: "image" | "text"
): Promise<void> =>
  runCaptureOperation(async () => {
    const record = await readRecord(id)
    const next =
      part === "image"
        ? {
            ...record,
            imagePath: undefined,
            revision: (record.revision ?? 0) + 1
          }
        : {
            ...record,
            accessibleText: undefined,
            selectedText: undefined,
            revision: (record.revision ?? 0) + 1
          }
    if (!next.imagePath && !next.accessibleText && !next.selectedText) {
      await removeRecordFiles(record)
      return
    }
    if (
      part === "image" &&
      record.imagePath &&
      path.dirname(path.resolve(record.imagePath)) ===
        path.resolve(getScreenAwarenessCaptureDirectoryPath())
    ) {
      await fsPromises.rm(record.imagePath, { force: true })
    }
    const temporaryPath = `${eventFilePath(id)}.tmp`
    await fsPromises.writeFile(temporaryPath, JSON.stringify(next), {
      mode: 0o600
    })
    await fsPromises.rename(temporaryPath, eventFilePath(id))
    const payload = captures.get(id)
    if (payload) {
      captures.set(
        id,
        part === "image"
          ? { ...payload, dataUrl: undefined, revision: next.revision }
          : {
              ...payload,
              accessibleText: undefined,
              selectedText: undefined,
              revision: next.revision
            }
      )
    }
  })

const scheduleRead = (): void => {
  if (pendingReadTimer) {
    clearTimeout(pendingReadTimer)
  }
  pendingReadTimer = setTimeout(() => {
    pendingReadTimer = null
    void (async () => {
      try {
        await queueRead(true)
      } catch (error) {
        logger.error("screen_awareness_capture_watch_failed", { error })
      }
    })()
  }, 50)
}

export const startScreenAwarenessCaptureEvents = (): void => {
  stopScreenAwarenessCaptureEvents()
  const directory = getScreenAwarenessCaptureDirectoryPath()
  fs.mkdirSync(directory, { mode: 0o700, recursive: true })

  captureWatcher = fs.watch(directory, (_eventType, filename) => {
    if (filename && EVENT_FILE_PATTERN.test(filename.toString())) {
      scheduleRead()
    }
  })
  pruneTimer = setInterval(scheduleRead, 60_000)
  scheduleRead()
}

export const stopScreenAwarenessCaptureEvents = (): void => {
  captureGeneration += 1
  captureWatcher?.close()
  captureWatcher = null
  if (pruneTimer) {
    clearInterval(pruneTimer)
  }
  pruneTimer = null
  if (pendingReadTimer) {
    clearTimeout(pendingReadTimer)
  }
  pendingReadTimer = null
}
