import type { TranslationKey } from "@etyon/i18n"
import type { SidebarMode } from "@etyon/rpc"
import { FoldersIcon, ListViewIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { SidebarModeOption } from "@/renderer/components/settings/ui-tab"

type Translate = (key: TranslationKey) => string

export const buildSidebarModeOptions = (
  t: Translate
): SidebarModeOption<SidebarMode>[] => [
  {
    description: t("settings.sidebar.mode.option.projects.description"),
    icon: <HugeiconsIcon icon={FoldersIcon} size={28} />,
    label: t("settings.sidebar.mode.option.projects.label"),
    value: "projects"
  },
  {
    description: t("settings.sidebar.mode.option.simple.description"),
    icon: <HugeiconsIcon icon={ListViewIcon} size={28} />,
    label: t("settings.sidebar.mode.option.simple.label"),
    value: "simple"
  }
]
