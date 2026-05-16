import type { TranslationKey } from "@etyon/i18n"
import type { DarkColorSchema, LightColorSchema } from "@etyon/rpc"

interface HeroUiProColorSchemaPreset {
  darkColorSchema: DarkColorSchema
  id: string
  labelKey: TranslationKey
  lightColorSchema: LightColorSchema
}

export const HEROUI_PRO_COLOR_SCHEMA_PRESETS = [
  {
    darkColorSchema: "brutalism-dark",
    id: "brutalism",
    labelKey: "settings.colorScheme.option.brutalism",
    lightColorSchema: "brutalism-light"
  },
  {
    darkColorSchema: "glass-dark",
    id: "glass",
    labelKey: "settings.colorScheme.option.glass",
    lightColorSchema: "glass-light"
  },
  {
    darkColorSchema: "mouve-dark",
    id: "mouve",
    labelKey: "settings.colorScheme.option.mouve",
    lightColorSchema: "mouve-light"
  }
] as const satisfies readonly HeroUiProColorSchemaPreset[]

export type HeroUiProThemeName =
  (typeof HEROUI_PRO_COLOR_SCHEMA_PRESETS)[number]["id"]

export const resolveHeroUiProThemeName = (
  themeName: string
): HeroUiProThemeName | null => {
  const preset = HEROUI_PRO_COLOR_SCHEMA_PRESETS.find(
    ({ darkColorSchema, lightColorSchema }) =>
      themeName === darkColorSchema || themeName === lightColorSchema
  )

  return preset?.id ?? null
}
