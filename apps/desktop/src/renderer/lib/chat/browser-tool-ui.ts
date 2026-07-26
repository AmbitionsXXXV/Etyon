import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { getNumber, getString, isRecord } from "@/renderer/lib/utils"

/**
 * Reads what the chat timeline needs out of a `browser` tool part. The tool is
 * one call with three actions (main/agents/minimal/browser-tool.ts), so the row
 * has to name the action and its target, and a settled screenshot additionally
 * renders as an image card. Pure and import-light so it unit-tests under node.
 */

const BROWSER_TOOL_NAME = "browser"

export type BrowserToolAction = "navigate" | "read" | "screenshot"

const BROWSER_TOOL_ACTIONS = new Set<string>(["navigate", "read", "screenshot"])

const TEXT_PREVIEW_MAX_LENGTH = 220

const asBrowserToolAction = (
  value: string | undefined
): BrowserToolAction | null =>
  value !== undefined && BROWSER_TOOL_ACTIONS.has(value)
    ? (value as BrowserToolAction)
    : null

// `output` only exists on the settled variants of the part union.
const getToolPartOutput = (part: ChatToolPart): unknown =>
  part.state === "output-available" ? part.output : undefined

export const isBrowserToolPart = (part: unknown): boolean => {
  if (!isRecord(part)) {
    return false
  }

  if (part.type === `tool-${BROWSER_TOOL_NAME}`) {
    return true
  }

  return part.type === "dynamic-tool" && part.toolName === BROWSER_TOOL_NAME
}

/**
 * The action a browser call performs. The output is authoritative once the call
 * settles; before that (input streaming, approval pending) the input carries it.
 */
export const getBrowserToolAction = (
  part: ChatToolPart
): BrowserToolAction | null => {
  const output = getToolPartOutput(part)
  const fromOutput = isRecord(output)
    ? asBrowserToolAction(getString(output, "action"))
    : null

  if (fromOutput) {
    return fromOutput
  }

  return isRecord(part.input)
    ? asBrowserToolAction(getString(part.input, "action"))
    : null
}

/**
 * The page the call targets: the settled url once known, otherwise the url the
 * model asked to navigate to (what an approval card must show). read and
 * screenshot have no target until they run — they act on whatever is loaded.
 */
export const getBrowserToolTargetUrl = (part: ChatToolPart): string => {
  const output = getToolPartOutput(part)
  const settledUrl = isRecord(output) ? getString(output, "url") : undefined

  if (settledUrl) {
    return settledUrl
  }

  return (isRecord(part.input) ? getString(part.input, "url") : "") ?? ""
}

/** One-line result summary for the collapsed trace row. */
export const getBrowserToolPreview = (part: ChatToolPart): string => {
  const output = getToolPartOutput(part)

  if (!isRecord(output)) {
    return ""
  }

  const action = getBrowserToolAction(part)

  if (action === "read") {
    return (getString(output, "text") ?? "").slice(0, TEXT_PREVIEW_MAX_LENGTH)
  }

  if (action === "screenshot") {
    const width = getNumber(output, "width")
    const height = getNumber(output, "height")

    return width !== undefined && height !== undefined
      ? `${width}×${height}`
      : ""
  }

  return getString(output, "title") ?? ""
}

export interface BrowserScreenshotView {
  height: number
  imageUrl: string
  pageUrl: string
  width: number
}

/**
 * The inline image card's data for a settled screenshot, or null for any other
 * part/state. `imageUrl` is an `etyon-attachment://` ref served by the main
 * process — the renderer CSP allows it as an <img> source, and the bytes were
 * never in the message stream.
 */
export const getBrowserScreenshotView = (
  part: ChatToolPart
): BrowserScreenshotView | null => {
  const output = getToolPartOutput(part)

  if (!isBrowserToolPart(part) || !isRecord(output)) {
    return null
  }

  const imageUrl = getString(output, "imageUrl")
  const width = getNumber(output, "width")
  const height = getNumber(output, "height")

  if (!imageUrl || width === undefined || height === undefined) {
    return null
  }

  return {
    height,
    imageUrl,
    pageUrl: getString(output, "url") ?? "",
    width
  }
}
