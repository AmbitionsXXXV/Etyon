import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import type { ProjectContextPanelView } from "@/renderer/lib/chat/project-context-panel"
import { getString, isRecord } from "@/renderer/lib/utils"

/**
 * Artifacts: the agent publishes an .html/.md project file via the `artifact`
 * tool and the renderer previews it in the right side panel. HTML previews run
 * inside a sandboxed srcdoc iframe (opaque origin, no `allow-same-origin`)
 * with a strict CSP injected ahead of any author markup, mirroring the
 * fully-self-contained policy of Claude's hosted artifacts: no external
 * scripts/styles/fonts/images and no fetch/XHR/WebSocket.
 *
 * Generated images are NOT artifacts — they render inline in the message
 * (see lib/chat/imagen-message.ts). The panel is only for renderable documents.
 */

export const ARTIFACT_PANEL_VIEW_ID = "artifact"

export type ChatSidePanelView =
  | ProjectContextPanelView
  | typeof ARTIFACT_PANEL_VIEW_ID

export type ChatArtifactKind = "html" | "markdown"

export type ArtifactTheme = "dark" | "light"

export interface ChatArtifactRef {
  description?: string
  kind: ChatArtifactKind
  path: string
  title: string
  toolCallId: string
}

const ARTIFACT_TOOL_NAME = "artifact"
const ARTIFACT_TOOL_PART_TYPE = `tool-${ARTIFACT_TOOL_NAME}`

export const ARTIFACT_IFRAME_SANDBOX = "allow-scripts"

const ARTIFACT_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join("; ")

const LEADING_DOCTYPE_PATTERN = /^\s*<!doctype[^>]*>/iu

export const isArtifactToolPart = (part: unknown): boolean => {
  if (!isRecord(part)) {
    return false
  }

  if (part.type === ARTIFACT_TOOL_PART_TYPE) {
    return true
  }

  return part.type === "dynamic-tool" && part.toolName === ARTIFACT_TOOL_NAME
}

const isArtifactKind = (value: unknown): value is ChatArtifactKind =>
  value === "html" || value === "markdown"

/** The artifact reference carried by a finished `artifact` tool part. */
export const getPublishedArtifactRef = (
  part: ChatToolPart
): ChatArtifactRef | null => {
  if (part.state !== "output-available" || !isRecord(part.output)) {
    return null
  }

  const path = getString(part.output, "path")

  if (!(isArtifactKind(part.output.kind) && path)) {
    return null
  }

  const description = getString(part.output, "description")

  return {
    ...(description ? { description } : {}),
    kind: part.output.kind,
    path,
    title: getString(part.output, "title") || path,
    toolCallId: part.toolCallId
  }
}

/** Published artifacts across a transcript, in message order. */
export const collectPublishedArtifactRefs = (
  messages: readonly { parts: readonly unknown[]; role: string }[]
): ChatArtifactRef[] => {
  const refs: ChatArtifactRef[] = []

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    for (const part of message.parts) {
      if (!isArtifactToolPart(part)) {
        continue
      }

      const ref = getPublishedArtifactRef(part as ChatToolPart)

      if (ref) {
        refs.push(ref)
      }
    }
  }

  return refs
}

const buildHeadInjection = (theme: ArtifactTheme): string =>
  `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_PREVIEW_CSP}">` +
  `<meta name="color-scheme" content="${theme}">` +
  `<script>document.documentElement.dataset.theme=${JSON.stringify(theme)}</script>`

/**
 * Wraps artifact HTML for a sandboxed srcdoc iframe. The CSP meta and theme
 * stamp are inserted directly after a leading doctype (or a doctype is added)
 * so they parse before any author markup — nothing in the untrusted document
 * can load or run ahead of the policy.
 */
export const buildArtifactSrcDoc = ({
  html,
  theme
}: {
  html: string
  theme: ArtifactTheme
}): string => {
  const headInjection = buildHeadInjection(theme)
  const doctypeMatch = LEADING_DOCTYPE_PATTERN.exec(html)

  if (doctypeMatch) {
    const insertAt = doctypeMatch.index + doctypeMatch[0].length

    return `${html.slice(0, insertAt)}${headInjection}${html.slice(insertAt)}`
  }

  return `<!doctype html>${headInjection}${html}`
}

export const getRootArtifactTheme = (): ArtifactTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light"

export const subscribeToRootThemeChange = (
  onChange: () => void
): (() => void) => {
  const observer = new MutationObserver(onChange)

  observer.observe(document.documentElement, {
    attributeFilter: ["class", "data-theme"],
    attributes: true
  })

  return () => observer.disconnect()
}
