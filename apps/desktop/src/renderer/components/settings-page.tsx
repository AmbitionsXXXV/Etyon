import type { AppSettings, Theme } from "@etyon/rpc"
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
import { Skeleton } from "@etyon/ui/components/skeleton"
import { cn } from "@etyon/ui/lib/utils"
import {
  ComputerIcon,
  MinusSignIcon,
  Moon02Icon,
  PlusSignIcon,
  Sun02Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { orpc, rpcClient } from "../lib/rpc"
import { applySettings, applyThemePreview } from "../lib/settings"

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

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 24

interface ThemeOption {
  icon: React.ReactNode
  label: string
  value: Theme
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    icon: <HugeiconsIcon icon={Sun02Icon} size={24} />,
    label: "Light",
    value: "light"
  },
  {
    icon: <HugeiconsIcon icon={Moon02Icon} size={24} />,
    label: "Dark",
    value: "dark"
  },
  {
    icon: <HugeiconsIcon icon={ComputerIcon} size={24} />,
    label: "System",
    value: "system"
  }
]

const NAV_ITEMS = [{ id: "user-interface", label: "User Interface" }]

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

const ThemeSelector = ({
  onChange,
  value
}: {
  onChange: (theme: Theme) => void
  value: Theme
}) => (
  <div className="grid grid-cols-3 gap-3">
    {THEME_OPTIONS.map((option) => (
      <ThemeButton
        isActive={value === option.value}
        key={option.value}
        onChange={onChange}
        option={option}
      />
    ))}
  </div>
)

interface FontItem {
  label: string
  value: string
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

const renderFontValue = (selected: FontItem) => renderFontLabel(selected)

const renderFontItem = (item: FontItem) => (
  <ComboboxItem key={item.value} value={item}>
    {renderFontLabel(item)}
  </ComboboxItem>
)

const FontFamilyCombobox = ({
  onChange,
  value
}: {
  onChange: (family: string) => void
  value: string
}) => {
  const fontsQuery = useQuery(orpc.fonts.list.queryOptions({}))
  const fonts = useMemo(() => {
    if (fontsQuery.data && fontsQuery.data.length > 0) {
      const systemFonts = fontsQuery.data.filter(
        (f) => !FALLBACK_FONTS.includes(f)
      )
      return ["System Default", ...systemFonts]
    }
    return FALLBACK_FONTS
  }, [fontsQuery.data])

  const items = useMemo<FontItem[]>(
    () => fonts.map((f) => ({ label: f, value: f })),
    [fonts]
  )

  const selectedItem = useMemo(
    () => items.find((i) => i.value === value) ?? items[0],
    [items, value]
  )

  const handleValueChange = useCallback(
    (val: FontItem | null) => {
      if (val) {
        onChange(val.value)
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
        <ComboboxInput placeholder="Search fonts..." showTrigger={false} />
        <ComboboxEmpty>No fonts found</ComboboxEmpty>
        <ComboboxList>{renderFontItem}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

const FontSizeInput = ({
  onChange,
  value
}: {
  onChange: (size: number) => void
  value: number
}) => {
  const [localValue, setLocalValue] = useState(String(value))

  useEffect(() => {
    setLocalValue(String(value))
  }, [value])

  const clamp = useCallback(
    (n: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n)),
    []
  )

  const commit = useCallback(() => {
    setLocalValue((prev) => {
      const parsed = Number.parseInt(prev, 10)
      if (Number.isNaN(parsed)) {
        return String(value)
      }
      const clamped = clamp(parsed)
      onChange(clamped)
      return String(clamped)
    })
  }, [clamp, onChange, value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commit()
      }
    },
    [commit]
  )

  const decrement = useCallback(() => {
    const next = clamp(value - 1)
    onChange(next)
  }, [clamp, onChange, value])

  const increment = useCallback(() => {
    const next = clamp(value + 1)
    onChange(next)
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
            className="text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
        {FONT_SIZE_MIN} - {FONT_SIZE_MAX} px
      </p>
    </div>
  )
}

export const SettingsPage = () => {
  const queryClient = useQueryClient()
  const [activeSection] = useState("user-interface")

  const settingsQuery = useQuery(orpc.settings.get.queryOptions({}))
  const settingsQueryKey = orpc.settings.get.queryOptions({}).queryKey
  const saved = settingsQuery.data

  const [draft, setDraft] = useState<AppSettings | null>(null)

  useEffect(() => {
    if (saved && !draft) {
      setDraft(saved)
    }
  }, [saved, draft])

  const isDirty = useMemo(() => {
    if (!saved || !draft) {
      return false
    }
    return (
      saved.theme !== draft.theme ||
      saved.fontFamily !== draft.fontFamily ||
      saved.fontSize !== draft.fontSize
    )
  }, [saved, draft])

  const updateMutation = useMutation<AppSettings, Error, AppSettings>({
    mutationFn: (next) => rpcClient.settings.update(next),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsQueryKey, data)
      setDraft(data)
      applySettings(data)
    }
  })

  // Live-preview theme changes
  const draftTheme = draft?.theme
  useEffect(() => {
    if (draftTheme) {
      applyThemePreview(draftTheme)
    }
  }, [draftTheme])

  const handleThemeChange = useCallback(
    (theme: Theme) => setDraft((prev) => (prev ? { ...prev, theme } : prev)),
    []
  )

  const handleFontFamilyChange = useCallback(
    (fontFamily: string) =>
      setDraft((prev) => (prev ? { ...prev, fontFamily } : prev)),
    []
  )

  const handleFontSizeChange = useCallback(
    (fontSize: number) =>
      setDraft((prev) => (prev ? { ...prev, fontSize } : prev)),
    []
  )

  const handleSave = useCallback(() => {
    if (draft) {
      updateMutation.mutate(draft)
    }
  }, [draft, updateMutation])

  const handleCancel = useCallback(() => {
    if (saved) {
      setDraft(saved)
      applyThemePreview(saved.theme)
    }
  }, [saved])

  if (!draft) {
    return (
      <div className="flex h-svh">
        <aside className="w-[160px] shrink-0 border-r border-border bg-background p-3 pt-10">
          <Skeleton className="h-7 w-full rounded-md" />
        </aside>

        <main className="flex-1 overflow-y-auto pt-8">
          <div className="mx-auto p-6">
            <Skeleton className="mb-6 h-6 w-36" />

            <div className="space-y-8">
              <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-16" />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-[72px] rounded-lg" />
                  <Skeleton className="h-[72px] rounded-lg" />
                  <Skeleton className="h-[72px] rounded-lg" />
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-28" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-svh">
      <motion.aside
        animate={{ opacity: 1, x: 0 }}
        className="shrink-0 border-r border-border bg-background p-3 pt-10"
        initial={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <nav className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              className={cn(
                "flex w-full items-center rounded-md px-3 py-1.5 text-sm transition-colors",
                activeSection === item.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              key={item.id}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </motion.aside>

      <main className="flex-1 overflow-y-auto pt-8">
        <div className="mx-auto p-6">
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 text-lg font-semibold"
            initial={{ opacity: 0, y: -8 }}
            transition={{
              delay: 0.1,
              duration: 0.3,
              ease: [0.25, 0.1, 0.25, 1]
            }}
          >
            User Interface
          </motion.h1>

          <div className="space-y-8">
            <motion.section
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4 rounded-lg border border-border bg-card p-5"
              initial={{ opacity: 0, y: 10 }}
              transition={{
                delay: 0.15,
                duration: 0.35,
                ease: [0.25, 0.1, 0.25, 1]
              }}
            >
              <h2 className="text-sm font-semibold">Theme</h2>

              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Appearance
                </h3>
                <ThemeSelector
                  onChange={handleThemeChange}
                  value={draft.theme}
                />
              </div>
            </motion.section>

            <motion.section
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4 rounded-lg border border-border bg-card p-5"
              initial={{ opacity: 0, y: 10 }}
              transition={{
                delay: 0.25,
                duration: 0.35,
                ease: [0.25, 0.1, 0.25, 1]
              }}
            >
              <h2 className="text-sm font-semibold">Font Settings</h2>

              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Font Family
                </h3>
                <FontFamilyCombobox
                  onChange={handleFontFamilyChange}
                  value={draft.fontFamily}
                />
                <p className="text-xs text-muted-foreground">
                  Select a font for the application interface. Leave as System
                  Default to use your OS font.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Font Size
                </h3>
                <FontSizeInput
                  onChange={handleFontSizeChange}
                  value={draft.fontSize}
                />
              </div>
            </motion.section>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {isDirty && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
            exit={{ opacity: 0, y: 8 }}
            initial={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <Button
              disabled={updateMutation.isPending}
              onClick={handleCancel}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
