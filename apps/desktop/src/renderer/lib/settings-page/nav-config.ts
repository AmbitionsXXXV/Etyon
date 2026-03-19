import type { TranslationKey } from "@etyon/i18n"
import {
  ComputerIcon,
  PaintBrush01Icon,
  Settings02Icon
} from "@hugeicons/core-free-icons"

export type SettingsSectionId = "color-schema" | "general" | "user-interface"

export const SETTINGS_NAV_LABEL_KEY_BY_SECTION = {
  "color-schema": "settings.nav.colorSchema",
  general: "settings.nav.general",
  "user-interface": "settings.nav.userInterface"
} as const satisfies Record<SettingsSectionId, TranslationKey>

export const SETTINGS_NAV_ENTRIES: readonly {
  icon: typeof Settings02Icon
  id: SettingsSectionId
}[] = [
  {
    icon: Settings02Icon,
    id: "general"
  },
  {
    icon: PaintBrush01Icon,
    id: "color-schema"
  },
  {
    icon: ComputerIcon,
    id: "user-interface"
  }
]
