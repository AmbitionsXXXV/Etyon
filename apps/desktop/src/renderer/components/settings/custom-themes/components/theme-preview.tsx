import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"

import type { CustomThemeColorFields } from "../types"
import { createPreviewPalette } from "../utils/preview"

export const ThemePreview = ({
  colors,
  compact = false
}: {
  colors: CustomThemeColorFields
  compact?: boolean
}) => {
  const { t } = useI18n()
  const palette = createPreviewPalette(colors)

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border shadow-xs",
        compact ? "min-h-32" : "min-h-72"
      )}
      style={{
        backgroundColor: palette.background,
        borderColor: palette.border,
        color: palette.text
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{
          backgroundColor: palette.chrome,
          borderColor: palette.border
        }}
      >
        <span className="size-2.5 rounded-full bg-red-400" />
        <span className="size-2.5 rounded-full bg-yellow-400" />
        <span className="size-2.5 rounded-full bg-green-400" />
        {!compact && (
          <span
            className="ml-2 text-[11px] font-medium"
            style={{ color: palette.mutedText }}
          >
            {t("settings.customThemes.preview.title")}
          </span>
        )}
      </div>
      <div
        className={cn(
          "grid",
          compact
            ? "grid-cols-[84px_minmax(0,1fr)]"
            : "grid-cols-[96px_minmax(0,1fr)]"
        )}
      >
        <div
          className={cn(
            "border-r px-3 py-3",
            compact ? "space-y-2" : "space-y-3"
          )}
          style={{
            backgroundColor: palette.sidebar,
            borderColor: palette.border
          }}
        >
          <div
            className="rounded-md px-2 py-1.5 text-[11px] font-medium"
            style={{
              backgroundColor: palette.accentSurface,
              color: palette.text
            }}
          >
            {t("settings.customThemes.preview.selected")}
          </div>
          <div
            className="space-y-1 text-[11px]"
            style={{ color: palette.mutedText }}
          >
            <div>{t("settings.customThemes.preview.menuItemOne")}</div>
            <div>{t("settings.customThemes.preview.menuItemTwo")}</div>
          </div>
        </div>
        <div
          className={cn("space-y-3 p-3", compact ? "text-[11px]" : "text-xs")}
        >
          <div
            className="rounded-lg border p-3"
            style={{
              backgroundColor: palette.card,
              borderColor: palette.border
            }}
          >
            <div className="font-medium" style={{ color: palette.text }}>
              {t("settings.customThemes.preview.cardTitle")}
            </div>
            <div className="mt-1" style={{ color: palette.mutedText }}>
              {t("settings.customThemes.preview.cardDescription")}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className="rounded-md px-3 py-1.5 text-[11px] font-medium"
              style={{
                backgroundColor: palette.accent,
                color: palette.accentText
              }}
            >
              {t("settings.customThemes.preview.primary")}
            </span>
            <span
              className="rounded-md px-3 py-1.5 text-[11px] font-medium"
              style={{
                backgroundColor: palette.secondary,
                color: palette.secondaryText
              }}
            >
              {t("settings.customThemes.preview.secondary")}
            </span>
          </div>
          {!compact && (
            <div
              className="rounded-lg border px-3 py-2 font-mono text-[11px]"
              style={{
                backgroundColor: palette.code,
                borderColor: palette.border
              }}
            >
              <span style={{ color: palette.accent }}>const</span>{" "}
              <span style={{ color: palette.text }}>message</span>{" "}
              <span style={{ color: palette.mutedText }}>=</span>{" "}
              <span style={{ color: palette.secondary }}>
                &quot;Hello&quot;
              </span>
              <span style={{ color: palette.mutedText }}>;</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
