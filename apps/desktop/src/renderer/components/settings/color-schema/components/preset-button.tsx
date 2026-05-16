import { Button } from "@heroui/react"
import { useCallback } from "react"

import type { CustomThemePresetRow } from "../constants/presets"

export const PresetButton = ({
  active,
  label,
  onSelect,
  preset
}: {
  active: boolean
  label: string
  onSelect: (preset: CustomThemePresetRow) => void
  preset: CustomThemePresetRow
}) => {
  const handleClick = useCallback(() => onSelect(preset), [onSelect, preset])

  return (
    <Button
      className="h-auto gap-2 rounded-lg px-3 py-2"
      onPress={handleClick}
      type="button"
      variant={active ? "secondary" : "outline"}
    >
      <span className="flex items-center gap-1">
        {Object.values(preset.colors.dark).map((swatch) => (
          <span
            className="size-2.5 rounded-full border border-black/10"
            key={`${preset.key}-${swatch}`}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </span>
      <span>{label}</span>
    </Button>
  )
}
