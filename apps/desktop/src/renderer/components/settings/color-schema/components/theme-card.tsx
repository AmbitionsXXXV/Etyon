import { useI18n } from "@etyon/i18n/react"
import type { CustomTheme } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import { useCallback, useMemo } from "react"

import { buildPresetLabelMap, buildTypeLabelMap } from "../utils/theme-labels"
import { ThemePreview } from "./theme-preview"

export const CustomThemeCard = ({
  onDeleteTheme,
  theme
}: {
  onDeleteTheme: (theme: CustomTheme) => void
  theme: CustomTheme
}) => {
  const { t } = useI18n()
  const presetLabels = useMemo(() => buildPresetLabelMap(t), [t])
  const typeLabels = useMemo(() => buildTypeLabelMap(t), [t])

  const handleDelete = useCallback(() => {
    onDeleteTheme(theme)
  }, [onDeleteTheme, theme])

  return (
    <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_180px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{theme.name}</div>
            <div className="text-xs text-muted-foreground">
              {presetLabels[theme.preset]} · {typeLabels[theme.type]}
            </div>
          </div>
          <Button onClick={handleDelete} type="button" variant="destructive">
            {t("settings.customThemes.actions.delete")}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {Object.values(theme.colors).map((color) => (
            <span
              className="size-4 rounded-full border border-border"
              key={`${theme.id}-${color}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      <ThemePreview compact colors={theme.colors} />
    </div>
  )
}
