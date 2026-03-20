import type { LocalePreference } from "@etyon/i18n"
import { useI18n } from "@etyon/i18n/react"
import type { AppIcon } from "@etyon/rpc"
import { Checkbox } from "@etyon/ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@etyon/ui/components/select"
import { cn } from "@etyon/ui/lib/utils"
import { Tick01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback, useMemo } from "react"

import trayImage from "../../../../resources/tray.png"

export const LanguageSelect = ({
  onChange,
  value
}: {
  onChange: (locale: LocalePreference) => void
  value: LocalePreference
}) => {
  const { t } = useI18n()

  const options = useMemo(
    () => [
      { label: t("settings.language.option.system"), value: "system" },
      { label: t("settings.language.option.english"), value: "en-US" },
      {
        label: t("settings.language.option.simplifiedChinese"),
        value: "zh-CN"
      },
      { label: t("settings.language.option.japanese"), value: "ja-JP" }
    ],
    [t]
  )

  const handleValueChange = useCallback(
    (nextValue: string) => {
      onChange(nextValue as LocalePreference)
    },
    [onChange]
  )

  return (
    <Select onValueChange={handleValueChange} value={value}>
      <SelectTrigger className="w-full">
        <SelectValue>
          {(selectedValue) =>
            options.find((option) => option.value === selectedValue)?.label ??
            selectedValue
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

const AppIconButton = ({
  icon,
  isActive,
  label,
  onChange
}: {
  icon: AppIcon
  isActive: boolean
  label: string
  onChange: (icon: AppIcon) => void
}) => {
  const handleClick = useCallback(() => onChange(icon), [onChange, icon])

  return (
    <button
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-lg border p-3 transition-all",
        isActive
          ? "border-primary bg-primary/10"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      )}
      onClick={handleClick}
      type="button"
    >
      {isActive && (
        <div className="absolute -top-1.5 -right-1.5 text-primary bg-primary rounded-full">
          <HugeiconsIcon
            icon={Tick01Icon}
            size={14}
            className="text-background"
          />
        </div>
      )}
      <div className="flex size-14 items-center justify-center rounded-xl bg-muted">
        <img
          alt={label}
          className="size-11 rounded-[0.95rem] object-cover"
          src={APP_ICON_PREVIEW_BY_ICON[icon]}
        />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

const APP_ICONS: AppIcon[] = ["default", "alt"]
const APP_ICON_PREVIEW_BY_ICON: Record<AppIcon, string> = {
  alt: trayImage,
  default: trayImage
}

export const AppIconSelector = ({
  onChange,
  value
}: {
  onChange: (icon: AppIcon) => void
  value: AppIcon
}) => {
  const { t } = useI18n()

  const labels: Record<AppIcon, string> = useMemo(
    () => ({
      alt: t("settings.appIcon.alt"),
      default: t("settings.appIcon.default")
    }),
    [t]
  )

  return (
    <div className="flex gap-3">
      {APP_ICONS.map((icon) => (
        <AppIconButton
          icon={icon}
          isActive={value === icon}
          key={icon}
          label={labels[icon]}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

const SettingsCheckbox = ({
  label,
  onChange,
  value
}: {
  label: string
  onChange: (checked: boolean) => void
  value: boolean
}) => {
  const handleChange = useCallback(
    (checked: boolean) => onChange(checked),
    [onChange]
  )

  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <Checkbox
        checked={value}
        className="size-4 cursor-pointer rounded border-border accent-primary"
        onCheckedChange={handleChange}
      />
      <span className="text-sm">{label}</span>
    </label>
  )
}

export const AutoStartCheckbox = ({
  onChange,
  value
}: {
  onChange: (checked: boolean) => void
  value: boolean
}) => {
  const { t } = useI18n()

  return (
    <SettingsCheckbox
      label={t("settings.startup.autoStart")}
      onChange={onChange}
      value={value}
    />
  )
}

export const StartMinimizedToTrayCheckbox = ({
  onChange,
  value
}: {
  onChange: (checked: boolean) => void
  value: boolean
}) => {
  const { t } = useI18n()

  return (
    <SettingsCheckbox
      label={t("settings.startup.startMinimizedToTray")}
      onChange={onChange}
      value={value}
    />
  )
}

export const CloseToTrayCheckbox = ({
  onChange,
  value
}: {
  onChange: (checked: boolean) => void
  value: boolean
}) => {
  const { t } = useI18n()

  return (
    <SettingsCheckbox
      label={t("settings.windowBehavior.closeToTray")}
      onChange={onChange}
      value={value}
    />
  )
}

export const MinimizeToTrayCheckbox = ({
  onChange,
  value
}: {
  onChange: (checked: boolean) => void
  value: boolean
}) => {
  const { t } = useI18n()

  return (
    <SettingsCheckbox
      label={t("settings.windowBehavior.minimizeToTray")}
      onChange={onChange}
      value={value}
    />
  )
}
