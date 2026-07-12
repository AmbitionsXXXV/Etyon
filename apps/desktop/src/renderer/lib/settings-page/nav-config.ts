import type { TranslationKey } from "@etyon/i18n"
import {
  BrainIcon,
  BubbleChatIcon,
  ChartLineData02Icon,
  CloudServerIcon,
  ComputerIcon,
  InternetIcon,
  PackageOpenIcon,
  PaintBrush01Icon,
  PuzzleIcon,
  RobotIcon,
  SentIcon,
  Settings02Icon
} from "@hugeicons/core-free-icons"

export type SettingsSectionId =
  | "agents"
  | "channels"
  | "chat"
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
  agents: "settings.nav.agents",
  channels: "settings.nav.channels",
  chat: "settings.nav.chat",
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
    icon: CloudServerIcon,
    id: "providers"
  },
  {
    icon: RobotIcon,
    id: "agents"
  },
  {
    icon: BubbleChatIcon,
    id: "chat"
  },
  {
    icon: SentIcon,
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
