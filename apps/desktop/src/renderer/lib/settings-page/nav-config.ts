import type { TranslationKey } from "@etyon/i18n"
import {
  BrainIcon,
  ChatBotIcon,
  ComputerIcon,
  InternetIcon,
  NoteEditIcon,
  PaintBrush01Icon,
  Settings02Icon
} from "@hugeicons/core-free-icons"

export type SettingsSectionId =
  | "color-schema"
  | "general"
  | "memory"
  | "network"
  | "providers"
  | "telegram"
  | "user-interface"

export const SETTINGS_NAV_LABEL_KEY_BY_SECTION = {
  "color-schema": "settings.nav.colorSchema",
  general: "settings.nav.general",
  memory: "settings.nav.memory",
  network: "settings.nav.network",
  providers: "settings.nav.providers",
  telegram: "settings.nav.telegram",
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
    icon: NoteEditIcon,
    id: "providers"
  },
  {
    icon: ChatBotIcon,
    id: "telegram"
  },
  {
    icon: BrainIcon,
    id: "memory"
  },
  {
    icon: PaintBrush01Icon,
    id: "color-schema"
  },
  {
    icon: ComputerIcon,
    id: "user-interface"
  },
  {
    icon: InternetIcon,
    id: "network"
  }
]
