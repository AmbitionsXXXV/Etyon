import type { TranslationKey } from "@etyon/i18n"
import type { DarkColorSchema, LightColorSchema } from "@etyon/rpc"

import type { ColorSchemaOption } from "@/renderer/components/settings/ui-tab"
import { HEROUI_PRO_COLOR_SCHEMA_PRESETS } from "@/renderer/lib/color-schema/heroui-pro-themes"

import {
  DARK_COLOR_SCHEMA_SWATCHES,
  LIGHT_COLOR_SCHEMA_SWATCHES
} from "./color-schema-swatches"

type Translate = (key: TranslationKey) => string

export interface ColorSchemaPairOption {
  darkColorSchema: DarkColorSchema
  darkSwatches: readonly string[]
  id: string
  label: string
  lightColorSchema: LightColorSchema
  lightSwatches: readonly string[]
}

export const buildHeroUiProColorSchemaPairOptions = (
  t: Translate
): ColorSchemaPairOption[] =>
  HEROUI_PRO_COLOR_SCHEMA_PRESETS.map((preset) => ({
    darkColorSchema: preset.darkColorSchema,
    darkSwatches:
      DARK_COLOR_SCHEMA_SWATCHES[
        preset.darkColorSchema as keyof typeof DARK_COLOR_SCHEMA_SWATCHES
      ],
    id: preset.id,
    label: t(preset.labelKey),
    lightColorSchema: preset.lightColorSchema,
    lightSwatches:
      LIGHT_COLOR_SCHEMA_SWATCHES[
        preset.lightColorSchema as keyof typeof LIGHT_COLOR_SCHEMA_SWATCHES
      ]
  }))

export const buildDarkColorSchemaOptions = (
  t: Translate
): ColorSchemaOption<DarkColorSchema>[] => [
  {
    label: t("settings.colorScheme.option.default"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES.default,
    value: "default"
  },
  {
    label: t("settings.colorScheme.option.aquarium"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES.aquarium,
    value: "aquarium"
  },
  {
    label: t("settings.colorScheme.option.brutalism"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES["brutalism-dark"],
    value: "brutalism-dark"
  },
  {
    label: t("settings.colorScheme.option.chadraculaEvondev"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES["chadracula-evondev"],
    value: "chadracula-evondev"
  },
  {
    label: t("settings.colorScheme.option.glass"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES["glass-dark"],
    value: "glass-dark"
  },
  {
    label: t("settings.colorScheme.option.mouve"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES["mouve-dark"],
    value: "mouve-dark"
  },
  {
    label: t("settings.colorScheme.option.poimandres"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES.poimandres,
    value: "poimandres"
  },
  {
    label: t("settings.colorScheme.option.tokyoNight"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES["tokyo-night"],
    value: "tokyo-night"
  }
]

export const buildLightColorSchemaOptions = (
  t: Translate
): ColorSchemaOption<LightColorSchema>[] => [
  {
    label: t("settings.colorScheme.option.default"),
    swatches: LIGHT_COLOR_SCHEMA_SWATCHES.default,
    value: "default"
  },
  {
    label: t("settings.colorScheme.option.brutalism"),
    swatches: LIGHT_COLOR_SCHEMA_SWATCHES["brutalism-light"],
    value: "brutalism-light"
  },
  {
    label: t("settings.colorScheme.option.glass"),
    swatches: LIGHT_COLOR_SCHEMA_SWATCHES["glass-light"],
    value: "glass-light"
  },
  {
    label: t("settings.colorScheme.option.mouve"),
    swatches: LIGHT_COLOR_SCHEMA_SWATCHES["mouve-light"],
    value: "mouve-light"
  },
  {
    label: t("settings.colorScheme.option.oneLight"),
    swatches: LIGHT_COLOR_SCHEMA_SWATCHES["one-light"],
    value: "one-light"
  },
  {
    label: t("settings.colorScheme.option.paper"),
    swatches: LIGHT_COLOR_SCHEMA_SWATCHES.paper,
    value: "paper"
  }
]
