import type { TranslationKey } from "@etyon/i18n"
import { ComputerIcon, Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { ThemeOption } from "@/renderer/components/settings/ui-tab"

type Translate = (key: TranslationKey) => string

export const buildThemeOptions = (t: Translate): ThemeOption[] => [
  {
    icon: <HugeiconsIcon icon={Sun02Icon} size={24} />,
    label: t("settings.theme.option.light"),
    value: "light"
  },
  {
    icon: <HugeiconsIcon icon={Moon02Icon} size={24} />,
    label: t("settings.theme.option.dark"),
    value: "dark"
  },
  {
    icon: <HugeiconsIcon icon={ComputerIcon} size={24} />,
    label: t("settings.theme.option.system"),
    value: "system"
  }
]
