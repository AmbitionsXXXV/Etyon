import type { TranslationKey, TranslationValues } from "@etyon/i18n"
import type { CustomThemePreset, CustomThemeType } from "@etyon/rpc"

type TranslateFn = (key: TranslationKey, values?: TranslationValues) => string

export const buildPresetLabelMap = (
  t: TranslateFn
): Record<CustomThemePreset, string> => ({
  custom: t("settings.customThemes.presets.option.custom"),
  forest: t("settings.customThemes.presets.option.forest"),
  monokai: t("settings.customThemes.presets.option.monokai"),
  nord: t("settings.customThemes.presets.option.nord"),
  ocean: t("settings.customThemes.presets.option.ocean"),
  sunset: t("settings.customThemes.presets.option.sunset")
})

export const buildTypeLabelMap = (
  t: TranslateFn
): Record<CustomThemeType, string> => ({
  dark: t("settings.customThemes.type.dark"),
  light: t("settings.customThemes.type.light")
})

export const buildTypeFieldOptions = (t: TranslateFn) => {
  const labels = buildTypeLabelMap(t)

  return [
    { label: labels.dark, value: "dark" as const },
    { label: labels.light, value: "light" as const }
  ]
}
