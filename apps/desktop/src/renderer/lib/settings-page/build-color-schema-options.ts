import type { TranslationKey } from "@etyon/i18n"
import type { DarkColorSchema, LightColorSchema } from "@etyon/rpc"

import type { ColorSchemaOption } from "@/renderer/components/settings/ui-tab"

import {
  DARK_COLOR_SCHEMA_SWATCHES,
  LIGHT_COLOR_SCHEMA_SWATCHES
} from "./color-schema-swatches"

type Translate = (key: TranslationKey) => string

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
    label: t("settings.colorScheme.option.chadraculaEvondev"),
    swatches: DARK_COLOR_SCHEMA_SWATCHES["chadracula-evondev"],
    value: "chadracula-evondev"
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
