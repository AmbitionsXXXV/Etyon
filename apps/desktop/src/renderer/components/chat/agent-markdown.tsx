import type { ComponentProps } from "react"
import { Streamdown } from "streamdown"

/**
 * The single sanctioned entry point for rendering untrusted agent Markdown.
 * Every chat surface renders model output through this wrapper so the
 * XSS-relevant defaults can never be forgotten at an individual call site:
 *
 * - `skipHtml` drops any raw HTML embedded in the Markdown — the primary
 *   defense, since it removes the whole HTML-injection surface.
 * - `urlTransform` strips dangerous link protocols (`javascript:`, `vbscript:`,
 *   `file:`, `data:` links, …), making the policy explicit and uniform rather
 *   than relying on react-markdown's implicit default.
 * - `mermaid` runs with `securityLevel: "strict"` so a diagram label can't
 *   smuggle scripts or click handlers into the rendered SVG.
 *
 * The renderer CSP (main/content-security-policy.ts) is the complementary
 * process-level backstop. Do NOT import `Streamdown` directly elsewhere — add
 * any new prop passthrough here instead.
 */

type StreamdownComponentProps = ComponentProps<typeof Streamdown>

const AGENT_MERMAID_OPTIONS: StreamdownComponentProps["mermaid"] = {
  config: { securityLevel: "strict" }
}

const PROTOCOL_PATTERN = /^([a-z][a-z0-9+.-]*):/iu

// Anchors get the tightest set; images additionally allow inline/on-disk bytes
// (`data:` from generated images, `etyon-attachment:` from persisted vision
// input). Remote image loading is separately gated by the renderer CSP.
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const ALLOWED_IMAGE_PROTOCOLS = new Set([
  "blob:",
  "data:",
  "etyon-attachment:",
  "http:",
  "https:"
])

const safeAgentUrlTransform: NonNullable<
  StreamdownComponentProps["urlTransform"]
> = (url, key) => {
  const match = PROTOCOL_PATTERN.exec(url)

  // No scheme → a relative, anchor, or query URL, which is always safe.
  if (!match) {
    return url
  }

  const protocol = `${match[1].toLowerCase()}:`
  const allowed =
    key === "src" ? ALLOWED_IMAGE_PROTOCOLS : ALLOWED_LINK_PROTOCOLS

  // Dropping the URL (empty string) neutralizes the attribute while leaving the
  // surrounding text intact.
  return allowed.has(protocol) ? url : ""
}

export type AgentMarkdownProps = Pick<
  StreamdownComponentProps,
  "animated" | "caret" | "className" | "components" | "isAnimating"
> & { children: string }

export const AgentMarkdown = ({ children, ...props }: AgentMarkdownProps) => (
  <Streamdown
    {...props}
    mermaid={AGENT_MERMAID_OPTIONS}
    skipHtml
    urlTransform={safeAgentUrlTransform}
  >
    {children}
  </Streamdown>
)
