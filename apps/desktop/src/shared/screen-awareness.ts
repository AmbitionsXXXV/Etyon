export const SCREEN_AWARENESS_CAPTURE_CHANNEL =
  "screen-awareness:capture-ready" as const

export const SCREEN_AWARENESS_ERROR_CHANNEL =
  "screen-awareness:capture-error" as const
export const SCREEN_AWARENESS_CAPTURE_TTL_MS = 10 * 60 * 1000
export const SCREEN_AWARENESS_MAX_CAPTURES = 4

export interface ScreenAwarenessCaptureError {
  code: string
  id: string
  sourceAppName?: string
}

export interface ScreenAwarenessCapturePayload {
  revision?: number
  accessibleText?: string
  capturedAt: string
  dataUrl?: string
  id: string
  mediaType: "image/png"
  selectedText?: string
  sessionId?: string
  sourceAppBundleId?: string
  sourceAppIconDataUrl?: string
  sourceAppName: string
  warnings?: string[]
  windowId?: number
  windowTitle?: string
}

export const isScreenAwarenessCapturePayload = (
  value: unknown
): value is ScreenAwarenessCapturePayload => {
  if (!value || typeof value !== "object") {
    return false
  }
  const record = value as Record<string, unknown>
  const hasImage =
    typeof record.dataUrl === "string" &&
    record.dataUrl.startsWith("data:image/png;base64,")
  const hasText =
    typeof record.accessibleText === "string" ||
    typeof record.selectedText === "string"
  return (
    typeof record.id === "string" &&
    typeof record.capturedAt === "string" &&
    Number.isFinite(Date.parse(record.capturedAt)) &&
    record.mediaType === "image/png" &&
    (record.revision === undefined ||
      (Number.isSafeInteger(record.revision) &&
        Number(record.revision) >= 0)) &&
    typeof record.sourceAppName === "string" &&
    (hasImage || hasText)
  )
}
