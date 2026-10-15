import type { TranslationKey } from "@etyon/i18n"
import {
  BrainIcon,
  BubbleChatIcon,
  CalendarClockIcon,
  ChartLineData02Icon,
  CloudServerIcon,
  CreditCardIcon,
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
  | "subscriptions"
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
  subscriptions: "settings.nav.subscriptions",
  "token-savings": "settings.nav.tokenSavings",
  "web-tools": "settings.nav.webTools",
  "user-interface": "settings.nav.userInterface"
} as const satisfies Record<SettingsSectionId, TranslationKey>

export type SettingsNavGroupId = "app" | "assistant" | "tools"

export const SETTINGS_NAV_GROUP_LABEL_KEY = {
  app: "settings.navGroup.app",
  assistant: "settings.navGroup.assistant",
  tools: "settings.navGroup.tools"
} as const satisfies Record<SettingsNavGroupId, TranslationKey>

/** Display order of the groups; entries keep their order inside a group. */
export const SETTINGS_NAV_GROUP_ORDER = [
  "assistant",
  "tools",
  "app"
] as const satisfies readonly SettingsNavGroupId[]

export const SETTINGS_NAV_ENTRIES: readonly {
  group: SettingsNavGroupId
  icon: typeof Settings02Icon
  id: SettingsSectionId
}[] = [
  { group: "assistant", icon: BubbleChatIcon, id: "chat" },
  { group: "assistant", icon: RobotIcon, id: "agents" },
  { group: "assistant", icon: CloudServerIcon, id: "providers" },
  { group: "assistant", icon: CreditCardIcon, id: "subscriptions" },
  { group: "assistant", icon: BrainIcon, id: "memory" },
  { group: "assistant", icon: PuzzleIcon, id: "skills" },
  { group: "tools", icon: WebDesignIcon, id: "web-tools" },
  { group: "tools", icon: PlugSocketIcon, id: "mcp" },
  { group: "tools", icon: PackageOpenIcon, id: "plugins" },
  { group: "tools", icon: ScreenShareIcon, id: "screen-awareness" },
  { group: "tools", icon: CalendarClockIcon, id: "automation" },
  { group: "app", icon: Settings02Icon, id: "general" },
  { group: "app", icon: ComputerIcon, id: "user-interface" },
  { group: "app", icon: PaintBrush01Icon, id: "color-schema" },
  { group: "app", icon: SentIcon, id: "channels" },
  { group: "app", icon: ChartLineData02Icon, id: "token-savings" },
  { group: "app", icon: InternetIcon, id: "network" },
  { group: "app", icon: InformationCircleIcon, id: "about" }
]
