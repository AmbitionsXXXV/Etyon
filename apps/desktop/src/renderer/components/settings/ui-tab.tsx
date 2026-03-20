import { useI18n } from "@etyon/i18n/react"
import type { DarkColorSchema, LightColorSchema, Theme } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
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
import { Input } from "@etyon/ui/components/input"
import { cn } from "@etyon/ui/lib/utils"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"

import { orpc } from "@/renderer/lib/rpc"

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
          disabled={value <= FONT_SIZE_MIN}
          onClick={decrement}
          size="icon"
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
          disabled={value >= FONT_SIZE_MAX}
          onClick={increment}
          size="icon"
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
