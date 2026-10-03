import { useCallback, useSyncExternalStore } from "react"

import {
  isScreenAwarenessCapturePayload,
  SCREEN_AWARENESS_CAPTURE_TTL_MS,
  SCREEN_AWARENESS_MAX_CAPTURES,
  type ScreenAwarenessCapturePayload
} from "@/shared/screen-awareness"

type CaptureListener = () => void
const EMPTY_CAPTURES: ScreenAwarenessCapturePayload[] = []
let pendingCaptures: ScreenAwarenessCapturePayload[] = EMPTY_CAPTURES
const sessionSnapshots = new Map<string, ScreenAwarenessCapturePayload[]>()
const listeners = new Set<CaptureListener>()

const rebuildSessionSnapshots = (): void => {
  sessionSnapshots.clear()
  for (const capture of pendingCaptures) {
    if (!capture.sessionId) {
      continue
    }
    const session = sessionSnapshots.get(capture.sessionId) ?? []
    session.push(capture)
    sessionSnapshots.set(capture.sessionId, session)
  }
}

const notifyListeners = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

const emitChange = (): void => {
  rebuildSessionSnapshots()
  notifyListeners()
}

const isOptionalCaptureString = (value: unknown, maxLength: number): boolean =>
  value === undefined ||
  (typeof value === "string" && value.length <= maxLength)

const isCaptureLabel = (value: unknown, maxLength: number): boolean =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maxLength

export const isFreshScreenAwarenessCapture = (
  value: unknown,
  now = Date.now()
): value is ScreenAwarenessCapturePayload => {
  if (!isScreenAwarenessCapturePayload(value)) {
    return false
  }
  const capturedAt = Date.parse(value.capturedAt)
  const hasText =
    (typeof value.accessibleText === "string" &&
      value.accessibleText.trim().length > 0) ||
    (typeof value.selectedText === "string" &&
      value.selectedText.trim().length > 0)
  const hasImage =
    typeof value.dataUrl === "string" &&
    value.dataUrl.startsWith("data:image/png;base64,") &&
    value.dataUrl.length > "data:image/png;base64,".length
  return (
    isCaptureLabel(value.id, 100) &&
    isCaptureLabel(value.sourceAppName, 256) &&
    (hasText || hasImage) &&
    isOptionalCaptureString(value.accessibleText, 24_512) &&
    isOptionalCaptureString(value.selectedText, 24_000) &&
    isOptionalCaptureString(value.dataUrl, 12 * 1024 * 1024) &&
    (value.sessionId === undefined || isCaptureLabel(value.sessionId, 100)) &&
    capturedAt <= now &&
    now - capturedAt < SCREEN_AWARENESS_CAPTURE_TTL_MS
  )
}

const prunePendingCaptures = (): boolean => {
  const retained = pendingCaptures.filter((capture) =>
    isFreshScreenAwarenessCapture(capture)
  )
  if (retained.length === pendingCaptures.length) {
    return false
  }
  pendingCaptures = retained.length ? retained : EMPTY_CAPTURES
  rebuildSessionSnapshots()
  return true
}

const subscribe = (listener: CaptureListener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const stageScreenAwarenessCapture = (
  capture: ScreenAwarenessCapturePayload
): void => {
  if (prunePendingCaptures()) {
    notifyListeners()
  }
  if (!isFreshScreenAwarenessCapture(capture)) {
    return
  }
  const existing = pendingCaptures.find((entry) => entry.id === capture.id)
  if (existing && (capture.revision ?? 0) < (existing.revision ?? 0)) {
    return
  }
  if (existing === capture) {
    return
  }
  const retained = pendingCaptures.filter((entry) => entry.id !== capture.id)
  if (retained.length >= SCREEN_AWARENESS_MAX_CAPTURES) {
    return
  }
  pendingCaptures = [...retained, capture]
  emitChange()
}

export const consumeScreenAwarenessCapture = (captureId: string): void => {
  const retained = pendingCaptures.filter((entry) => entry.id !== captureId)
  if (retained.length === pendingCaptures.length) {
    return
  }
  pendingCaptures = retained.length ? retained : EMPTY_CAPTURES
  emitChange()
}

export const removeScreenAwarenessContent = (
  id: string,
  part: "image" | "text"
): void => {
  const capture = pendingCaptures.find((entry) => entry.id === id)
  if (!capture) {
    return
  }
  const next =
    part === "image"
      ? {
          ...capture,
          dataUrl: undefined,
          revision: (capture.revision ?? 0) + 1
        }
      : {
          ...capture,
          accessibleText: undefined,
          revision: (capture.revision ?? 0) + 1,
          selectedText: undefined
        }
  if (!next.dataUrl && !next.accessibleText && !next.selectedText) {
    consumeScreenAwarenessCapture(id)
  } else {
    stageScreenAwarenessCapture(next)
  }
}

export const getPendingScreenAwarenessCaptures = (
  sessionId?: string
): ScreenAwarenessCapturePayload[] => {
  // Keep snapshots stable until content actually changes. Notify after a
  // render-time read so expiry never synchronously updates another component.
  if (prunePendingCaptures()) {
    queueMicrotask(notifyListeners)
  }
  return sessionId
    ? (sessionSnapshots.get(sessionId) ?? EMPTY_CAPTURES)
    : pendingCaptures
}

export const getPendingScreenAwarenessCapture =
  (): ScreenAwarenessCapturePayload | null =>
    getPendingScreenAwarenessCaptures().at(-1) ?? null

export const usePendingScreenAwarenessCaptures = (
  sessionId: string
): ScreenAwarenessCapturePayload[] => {
  const getSnapshot = useCallback(
    () => getPendingScreenAwarenessCaptures(sessionId),
    [sessionId]
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const expireScreenAwarenessCaptures = (): void => {
  if (prunePendingCaptures()) {
    notifyListeners()
  }
}

export const clearScreenAwarenessCaptures = (): void => {
  if (pendingCaptures.length === 0) {
    return
  }
  pendingCaptures = EMPTY_CAPTURES
  emitChange()
}
