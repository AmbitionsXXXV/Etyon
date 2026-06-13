/**
 * Deterministic (no model call) summary + preview of a tool output for the run
 * inspector. The full output is referenced separately; this keeps token-heavy
 * results manageable in the timeline.
 */

const PREVIEW_MAX_CHARS = 280
const PREVIEW_MAX_LINES = 6

export interface ToolOutputSummary {
  lineCount: number
  preview: string
  summary: string
  totalChars: number
  truncated: boolean
}

const toText = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const summarizeToolOutput = (value?: unknown): ToolOutputSummary => {
  const text = toText(value)
  const lines = text.split("\n")
  const lineCount = lines.length
  const totalChars = text.length
  const previewBody = lines.slice(0, PREVIEW_MAX_LINES).join("\n")
  const preview =
    previewBody.length > PREVIEW_MAX_CHARS
      ? previewBody.slice(0, PREVIEW_MAX_CHARS)
      : previewBody
  const truncated =
    lineCount > PREVIEW_MAX_LINES || preview.length < text.length

  return {
    lineCount,
    preview,
    summary: `${lineCount} line${lineCount === 1 ? "" : "s"} · ${totalChars} char${
      totalChars === 1 ? "" : "s"
    }`,
    totalChars,
    truncated
  }
}
