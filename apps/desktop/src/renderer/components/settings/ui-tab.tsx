import { useI18n } from "@etyon/i18n/react"
import type {
  DarkColorSchema,
  LightColorSchema,
  SidebarMode,
  SidebarSettings,
  Theme
} from "@etyon/rpc"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue
} from "@etyon/ui/components/combobox"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Input, Switch } from "@heroui/react"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"

import { orpc } from "@/renderer/lib/rpc"
import { getSidebarWorktreeRules } from "@/renderer/lib/sidebar/worktree-summary"

const FALLBACK_FONTS = [
  "System Default",
  "Inter",
  "SF Pro",
  "Helvetica Neue",
  "Roboto",
  "Menlo",
  "Fira Code",
  "JetBrains Mono",
  "Source Code Pro"
]

const FONT_SIZE_MAX = 24
const FONT_SIZE_MIN = 12

interface FontItem {
  label: string
  value: string
}

type ColorSchemaValue = DarkColorSchema | LightColorSchema

export interface ColorSchemaOption<
  TValue extends ColorSchemaValue = ColorSchemaValue
> {
  label: string
  swatches: readonly string[]
  value: TValue
}

export interface ThemeOption {
  icon: React.ReactNode
  label: string
  value: Theme
}

export interface SidebarModeOption<TValue extends SidebarMode = SidebarMode> {
  description: string
  icon: React.ReactNode
  label: string
  value: TValue
}

const renderFontLabel = (item: FontItem) => (
  <span
    style={{
      fontFamily: item.value === "System Default" ? "inherit" : item.value
    }}
  >
    {item.label}
  </span>
)

const renderFontItem = (item: FontItem) => (
  <ComboboxItem key={item.value} value={item}>
    {renderFontLabel(item)}
  </ComboboxItem>
)

const renderFontValue = (selected: FontItem) => renderFontLabel(selected)

const ColorSchemaButton = <TValue extends ColorSchemaValue>({
  isActive,
  onChange,
  option
}: {
  isActive: boolean
  onChange: (value: TValue) => void
  option: ColorSchemaOption<TValue>
}) => {
  const handleClick = useCallback(
    () => onChange(option.value),
    [onChange, option.value]
  )
  const swatchOccurrences = new Map<string, number>()
  const swatchItems = option.swatches.map((swatch) => {
    const occurrenceCount = swatchOccurrences.get(swatch) ?? 0
    swatchOccurrences.set(swatch, occurrenceCount + 1)

    return {
      key: `${option.value}-${swatch}-${occurrenceCount}`,
      value: swatch
    }
  })

  return (
    <button
      aria-pressed={isActive}
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-all",
        isActive
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      )}
      onClick={handleClick}
      type="button"
    >
      <div className="flex items-center gap-1.5">
        {swatchItems.map((swatchItem) => (
          <span
            className="size-3 rounded-full border border-black/10"
            key={swatchItem.key}
            style={{ backgroundColor: swatchItem.value }}
          />
        ))}
      </div>
      <span className="text-sm font-medium text-foreground">
        {option.label}
      </span>
    </button>
  )
}

export const ColorSchemaSelector = <TValue extends ColorSchemaValue>({
  onChange,
  options,
  value
}: {
  onChange: (value: TValue) => void
  options: ColorSchemaOption<TValue>[]
  value: TValue
}) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {options.map((option) => (
      <ColorSchemaButton
        isActive={value === option.value}
        key={option.value}
        onChange={onChange}
        option={option}
      />
    ))}
  </div>
)

const ThemeButton = ({
  isActive,
  onChange,
  option
}: {
  isActive: boolean
  onChange: (theme: Theme) => void
  option: ThemeOption
}) => {
  const handleClick = useCallback(
    () => onChange(option.value),
    [onChange, option.value]
  )

  return (
    <button
      aria-pressed={isActive}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border p-4 transition-all",
        isActive
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      )}
      onClick={handleClick}
      type="button"
    >
      {option.icon}
      <span className="text-xs font-medium">{option.label}</span>
    </button>
  )
}

export const ThemeSelector = ({
  onChange,
  options,
  value
}: {
  onChange: (theme: Theme) => void
  options: ThemeOption[]
  value: Theme
}) => (
  <div className="grid grid-cols-3 gap-3">
    {options.map((option) => (
      <ThemeButton
        isActive={value === option.value}
        key={option.value}
        onChange={onChange}
        option={option}
      />
    ))}
  </div>
)

const SidebarModeButton = ({
  isActive,
  onChange,
  option
}: {
  isActive: boolean
  onChange: (mode: SidebarMode) => void
  option: SidebarModeOption
}) => {
  const handleClick = useCallback(
    () => onChange(option.value),
    [onChange, option.value]
  )

  return (
    <button
      aria-pressed={isActive}
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
        isActive
          ? "border-primary bg-primary/8"
          : "border-border hover:border-muted-foreground/30 hover:bg-default/40"
      )}
      onClick={handleClick}
      type="button"
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
          isActive ? "bg-primary/15 text-primary" : "bg-default text-foreground"
        )}
      >
        {option.icon}
      </span>
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-semibold text-foreground">
          {option.label}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {option.description}
        </span>
      </span>
    </button>
  )
}

export const SidebarModeSelector = ({
  onChange,
  options,
  value
}: {
  onChange: (mode: SidebarMode) => void
  options: SidebarModeOption[]
  value: SidebarMode
}) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {options.map((option) => (
      <SidebarModeButton
        isActive={value === option.value}
        key={option.value}
        onChange={onChange}
        option={option}
      />
    ))}
  </div>
)

export const FontFamilyCombobox = ({
  onChange,
  value
}: {
  onChange: (family: string) => void
  value: string
}) => {
  const { t } = useI18n()
  const fontsQuery = useQuery(orpc.fonts.list.queryOptions({}))

  const fonts = useMemo(() => {
    if (fontsQuery.data && fontsQuery.data.length > 0) {
      const systemFonts = fontsQuery.data.filter(
        (fontName) => !FALLBACK_FONTS.includes(fontName)
      )

      return ["System Default", ...systemFonts]
    }

    return FALLBACK_FONTS
  }, [fontsQuery.data])

  const items = useMemo<FontItem[]>(
    () =>
      fonts.map((fontName) => ({
        label:
          fontName === "System Default"
            ? t("settings.fonts.systemDefault")
            : fontName,
        value: fontName
      })),
    [fonts, t]
  )

  const selectedItem = useMemo(
    () => items.find((item) => item.value === value) ?? items[0],
    [items, value]
  )

  const handleValueChange = useCallback(
    (nextValue: FontItem | null) => {
      if (nextValue) {
        onChange(nextValue.value)
      }
    },
    [onChange]
  )

  return (
    <Combobox
      items={items}
      onValueChange={handleValueChange}
      value={selectedItem}
    >
      <ComboboxTrigger
        render={
          <Button
            className="w-full justify-between font-normal"
            variant="outline"
          >
            <ComboboxValue>{renderFontValue}</ComboboxValue>
          </Button>
        }
      />
      <ComboboxContent>
        <ComboboxInput
          placeholder={t("settings.fonts.search")}
          showTrigger={false}
        />
        <ComboboxEmpty>{t("settings.fonts.empty")}</ComboboxEmpty>
        <ComboboxList>{renderFontItem}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export const FontSizeInput = ({
  onChange,
  value
}: {
  onChange: (size: number) => void
  value: number
}) => {
  const { t } = useI18n()
  const [localValue, setLocalValue] = useState(String(value))

  useEffect(() => {
    setLocalValue(String(value))
  }, [value])

  const clamp = useCallback(
    (nextValue: number) =>
      Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, nextValue)),
    []
  )

  const commit = useCallback(() => {
    setLocalValue((previousValue) => {
      const parsed = Number.parseInt(previousValue, 10)

      if (Number.isNaN(parsed)) {
        return String(value)
      }

      const clamped = clamp(parsed)
      onChange(clamped)
      return String(clamped)
    })
  }, [clamp, onChange, value])

  const decrement = useCallback(() => {
    const nextValue = clamp(value - 1)
    onChange(nextValue)
  }, [clamp, onChange, value])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(event.target.value)
    },
    []
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        commit()
      }
    },
    [commit]
  )

  const increment = useCallback(() => {
    const nextValue = clamp(value + 1)
    onChange(nextValue)
  }, [clamp, onChange, value])

  return (
    <div>
      <div className="flex items-center gap-1">
        <Button
          isDisabled={value <= FONT_SIZE_MIN}
          isIconOnly
          onPress={decrement}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={14} />
        </Button>
        <div className="relative w-16">
          <Input
            className="[appearance:textfield] text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            max={FONT_SIZE_MAX}
            min={FONT_SIZE_MIN}
            onBlur={commit}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            type="number"
            value={localValue}
          />
        </div>
        <Button
          isDisabled={value >= FONT_SIZE_MAX}
          isIconOnly
          onPress={increment}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={14} />
        </Button>
        <span className="ml-1 text-xs text-muted-foreground">px</span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("settings.fonts.size.range", {
          max: FONT_SIZE_MAX,
          min: FONT_SIZE_MIN
        })}
      </p>
    </div>
  )
}

const PreviewRow = ({
  depth = 0,
  isActive = false,
  trailing,
  width
}: {
  depth?: 0 | 1
  isActive?: boolean
  trailing?: React.ReactNode
  width: string
}) => (
  <div
    className={cn(
      "flex h-7 items-center gap-2 rounded-lg px-2",
      depth === 1 && "ml-4 border-l border-border pl-3",
      isActive && "bg-default"
    )}
  >
    <span
      className={cn(
        "h-2 rounded-full",
        isActive ? "bg-foreground/70" : "bg-surface-tertiary"
      )}
      style={{ width }}
    />
    <span className="flex-1" />
    {trailing}
  </div>
)

const PreviewCandidateBadge = () => (
  <span className="rounded-md bg-accent-soft px-1.5 font-mono text-[10px] text-accent-soft-foreground">
    2/3
  </span>
)

const PreviewKeptDot = () => (
  <span className="size-1.5 rounded-full bg-warning" />
)

/**
 * A language-neutral sketch of the sidebar in the selected mode, showing where
 * Best-of-N candidates and kept workspaces appear with the current switches.
 */
export const SidebarModePreview = ({
  mode,
  nestWorktrees,
  showWorktreeBadges
}: {
  mode: SidebarMode
  nestWorktrees: boolean
  showWorktreeBadges: boolean
}) => {
  const { t } = useI18n()
  const isProjects = mode === "projects"
  return (
    <figure
      aria-label={t("settings.sidebar.preview.label")}
      className="flex min-h-64 flex-col gap-1 rounded-2xl border border-border bg-background p-3"
    >
      {isProjects ? (
        <>
          <div className="flex h-7 items-center gap-2 px-2 text-muted-foreground">
            <span className="size-3 rounded-sm border border-current" />
            <span className="h-2 w-16 rounded-full bg-surface-tertiary" />
          </div>
          <PreviewRow isActive width="55%" />
          {nestWorktrees ? (
            <>
              <PreviewRow
                depth={1}
                trailing={
                  <span className="rounded-md bg-accent-soft px-1.5 text-[10px] text-accent-soft-foreground">
                    {t("home.sidebar.worktrees.pick")}
                  </span>
                }
                width="35%"
              />
              <PreviewRow depth={1} width="45%" />
              <PreviewRow
                depth={1}
                trailing={
                  <span className="size-2.5 animate-spin rounded-full border border-accent border-r-transparent motion-reduce:animate-none" />
                }
                width="30%"
              />
            </>
          ) : null}
          <PreviewRow width="62%" />
          <PreviewRow width="48%" />
          {nestWorktrees ? (
            <PreviewRow depth={1} trailing={<PreviewKeptDot />} width="40%" />
          ) : null}
          <div className="mt-1 flex h-7 items-center gap-2 px-2 text-muted-foreground">
            <span className="size-3 rounded-sm border border-current" />
            <span className="h-2 w-12 rounded-full bg-surface-tertiary" />
          </div>
        </>
      ) : (
        <>
          <PreviewRow
            isActive
            trailing={showWorktreeBadges ? <PreviewCandidateBadge /> : null}
            width="55%"
          />
          <PreviewRow width="62%" />
          <PreviewRow
            trailing={showWorktreeBadges ? <PreviewKeptDot /> : null}
            width="48%"
          />
          <PreviewRow width="70%" />
          <PreviewRow width="40%" />
          <p className="mt-auto rounded-lg bg-surface px-2.5 py-2 text-xs leading-5 text-muted-foreground">
            {t("settings.sidebar.preview.simpleHint")}
          </p>
        </>
      )}
    </figure>
  )
}

/** The worktree switches that apply to the selected sidebar mode. */
export const SidebarWorktreeRules = ({
  onChange,
  sidebar
}: {
  onChange: (patch: Partial<SidebarSettings>) => void
  sidebar: SidebarSettings
}) => {
  const { t } = useI18n()
  return (
    <div className="space-y-1 border-t border-separator pt-4">
      <h3 className="pb-1 text-xs font-medium text-muted-foreground">
        {t(
          sidebar.mode === "projects"
            ? "settings.sidebar.worktrees.projectsTitle"
            : "settings.sidebar.worktrees.simpleTitle"
        )}
      </h3>
      {getSidebarWorktreeRules(sidebar).map((rule) => (
        <div
          className="flex items-center justify-between gap-4 py-2"
          key={rule.key}
        >
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">{t(rule.labelKey)}</div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t(rule.descriptionKey)}
            </p>
          </div>
          <Switch
            aria-label={t(rule.labelKey)}
            isSelected={sidebar[rule.key]}
            onChange={(isSelected) => onChange({ [rule.key]: isSelected })}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      ))}
    </div>
  )
}
