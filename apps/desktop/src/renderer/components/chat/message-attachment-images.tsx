import { useI18n } from "@etyon/i18n/react"
import type { FileUIPart } from "ai"
import { useState } from "react"

import { ImagenLightbox } from "@/renderer/components/chat/imagen-message"
import { getImageFileName } from "@/renderer/lib/chat/imagen-message"

/**
 * Renders a user message's attached images as bounded thumbnails; clicking one
 * opens the shared imagen lightbox (portal-to-body). Works for both optimistic
 * `data:` URLs and persisted `etyon-attachment://` refs — the <img> src loads
 * the latter through the registered attachment protocol.
 */
export const MessageAttachmentImages = ({ files }: { files: FileUIPart[] }) => {
  const { t } = useI18n()
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  if (files.length === 0) {
    return null
  }

  const expandedFile =
    expandedIndex === null ? null : (files[expandedIndex] ?? null)

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {files.map((file, index) => {
        const alt = file.filename ?? t("chat.attachments.image")

        return (
          <button
            aria-label={t("chat.imagen.viewFull")}
            className="block size-24 cursor-zoom-in overflow-hidden rounded-xl border border-border/60 bg-muted/40 p-0 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
            key={`${file.url}-${index}`}
            onClick={() => setExpandedIndex(index)}
            type="button"
          >
            <img alt={alt} className="size-full object-cover" src={file.url} />
          </button>
        )
      })}

      {expandedFile ? (
        <ImagenLightbox
          alt={expandedFile.filename ?? t("chat.attachments.image")}
          fileName={getImageFileName(expandedFile.filename ?? expandedFile.url)}
          onClose={() => setExpandedIndex(null)}
          src={expandedFile.url}
        />
      ) : null}
    </div>
  )
}
