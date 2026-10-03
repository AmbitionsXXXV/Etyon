import type { TranslationKey } from "@etyon/i18n"
import {
  BrainIcon,
  BubbleChatIcon,
  CalendarClockIcon,
  ChartLineData02Icon,
  CloudServerIcon,
  ComputerIcon,
  InformationCircleIcon,
  InternetIcon,
  PackageOpenIcon,
  PaintBrush01Icon,
  PuzzleIcon,
  PlugSocketIcon,
  RobotIcon,
  SentIcon,
  ScreenShareIcon,
  WebDesignIcon,
  Settings02Icon
} from "@hugeicons/core-free-icons"

export type SettingsSectionId =
  | "about"
  | "automation"
  | "agents"
  | "channels"
  | "chat"
  | "color-schema"
  | "general"
  | "mcp"
  | "memory"
  | "network"
  | "plugins"
  | "providers"
  | "screen-awareness"
  | "skills"
  | "token-savings"
  | "web-tools"
  | "user-interface"

export const SETTINGS_NAV_LABEL_KEY_BY_SECTION = {
  about: "settings.nav.about",
  automation: "settings.nav.automation",
  agents: "settings.nav.agents",
  channels: "settings.nav.channels",
  chat: "settings.nav.chat",
  "color-schema": "settings.nav.colorSchema",
  general: "settings.nav.general",
  mcp: "settings.nav.mcp",
  memory: "settings.nav.memory",
  network: "settings.nav.network",
  plugins: "settings.nav.plugins",
  providers: "settings.nav.providers",
  "screen-awareness": "settings.nav.screenAwareness",
  skills: "settings.nav.skills",
  "token-savings": "settings.nav.tokenSavings",
  "web-tools": "settings.nav.webTools",
  "user-interface": "settings.nav.userInterface"
} as const satisfies Record<SettingsSectionId, TranslationKey>

export const SETTINGS_NAV_ENTRIES: readonly {
  icon: typeof Settings02Icon
  id: SettingsSectionId
}[] = [
  { icon: CalendarClockIcon, id: "automation" },
  { icon: WebDesignIcon, id: "web-tools" },
  { icon: PlugSocketIcon, id: "mcp" },
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
  { icon: ScreenShareIcon, id: "screen-awareness" },
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
  },
  {
    icon: InformationCircleIcon,
    id: "about"
  }
]
