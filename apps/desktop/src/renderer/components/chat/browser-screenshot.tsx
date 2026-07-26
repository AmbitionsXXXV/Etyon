import { useI18n } from "@etyon/i18n/react"
import { useState } from "react"

import { ImagenLightbox } from "@/renderer/components/chat/imagen-message"
import { getBrowserScreenshotView } from "@/renderer/lib/chat/browser-tool-ui"
import { getImageFileName } from "@/renderer/lib/chat/imagen-message"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"

/**
 * Renders a `browser` screenshot inline under the assistant message, the same
 * placement generated images get — a screenshot the agent acted on should stay
 * visible after the work section collapses. The source is the persisted
 * `etyon-attachment://` ref (the bytes never travelled through the chat
 * stream), and clicking opens the shared lightbox.
 */
export const BrowserScreenshotImage = ({ part }: { part: ChatToolPart }) => {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)
  const screenshot = getBrowserScreenshotView(part)

  if (!screenshot) {
    return null
  }

  const alt = t("chat.browserTool.screenshotAlt", { url: screenshot.pageUrl })

  return (
    <>
      <button
        aria-label={t("chat.imagen.viewFull")}
        className="block max-w-md cursor-zoom-in overflow-hidden rounded-xl border border-border/70 bg-transparent p-0"
        onClick={() => setIsExpanded(true)}
        type="button"
      >
        <img
          alt={alt}
          className="max-h-96 w-full object-contain"
          src={screenshot.imageUrl}
        />
      </button>
      {isExpanded ? (
        <ImagenLightbox
          alt={alt}
          fileName={getImageFileName(screenshot.imageUrl)}
          onClose={() => setIsExpanded(false)}
          src={screenshot.imageUrl}
        />
      ) : null}
    </>
  )
}
