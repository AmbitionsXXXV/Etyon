import type { TranslationKey } from "@etyon/i18n"
import {
  BrainIcon,
  ChatBotIcon,
  ChartLineData02Icon,
  ComputerIcon,
  InternetIcon,
  NoteEditIcon,
  PackageOpenIcon,
  PaintBrush01Icon,
  PuzzleIcon,
  Settings02Icon
} from "@hugeicons/core-free-icons"

export type SettingsSectionId =
  | "channels"
  | "color-schema"
  | "general"
  | "memory"
  | "network"
  | "plugins"
  | "providers"
  | "skills"
  | "token-savings"
  | "user-interface"

export const SETTINGS_NAV_LABEL_KEY_BY_SECTION = {
  channels: "settings.nav.channels",
  "color-schema": "settings.nav.colorSchema",
  general: "settings.nav.general",
  memory: "settings.nav.memory",
  network: "settings.nav.network",
  plugins: "settings.nav.plugins",
  providers: "settings.nav.providers",
  skills: "settings.nav.skills",
  "token-savings": "settings.nav.tokenSavings",
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
    id: "channels"
  },
  {
    icon: BrainIcon,
    id: "memory"
  },
  {
    icon: PackageOpenIcon,
    id: "plugins"
  },
  {
    icon: PuzzleIcon,
    id: "skills"
  },
  {
    icon: ChartLineData02Icon,
    id: "token-savings"
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
