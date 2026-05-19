import { useI18n } from "@etyon/i18n/react"
import type { CustomTheme, DarkColorSchema, LightColorSchema } from "@etyon/rpc"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@etyon/ui/components/empty"
import { Button } from "@heroui/react"
import { PaintBrush01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useCallback, useState } from "react"

import type { ColorSchemaPairOption } from "@/renderer/lib/settings-page/build-color-schema-options"
import { settingsPageSectionMotion } from "@/renderer/lib/settings-page/motion"

import { ColorSchemaSelector } from "../ui-tab"
import type { ColorSchemaOption } from "../ui-tab"
import { CreateCustomThemeDialog } from "./components/create-theme-dialog"
import { DeleteCustomThemeDialog } from "./components/delete-theme-dialog"
import { CustomThemeCard } from "./components/theme-card"

type ColorSchemaValue = DarkColorSchema | LightColorSchema

interface ColorSchemaBlockProps<TValue extends ColorSchemaValue> {
  description: string
  label: string
  onChange: (value: TValue) => void
  options: ColorSchemaOption<TValue>[]
  value: TValue
}

interface ColorSchemaTabProps {
  darkColorSchema: DarkColorSchema
  darkColorSchemaOptions: ColorSchemaOption<DarkColorSchema>[]
  heroUiProColorSchemaPairOptions: ColorSchemaPairOption[]
  lightColorSchema: LightColorSchema
  lightColorSchemaOptions: ColorSchemaOption<LightColorSchema>[]
  onColorSchemaPairChange: (value: {
    darkColorSchema: DarkColorSchema
    lightColorSchema: LightColorSchema
  }) => void
  onCreateTheme: (theme: CustomTheme) => void
  onDarkColorSchemaChange: (value: DarkColorSchema) => void
  onDeleteTheme: (themeId: string) => void
  onLightColorSchemaChange: (value: LightColorSchema) => void
  themes: CustomTheme[]
}

const ColorSchemaBlock = <TValue extends ColorSchemaValue>({
  description,
  label,
  onChange,
  options,
  value
}: ColorSchemaBlockProps<TValue>) => (
  <div className="space-y-4 rounded-lg border border-border bg-card p-5">
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">{label}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>

    <ColorSchemaSelector onChange={onChange} options={options} value={value} />
  </div>
)

interface ColorSchemaPairButtonProps {
  isActive: boolean
  onChange: (value: ColorSchemaPairOption) => void
  option: ColorSchemaPairOption
}

const buildSwatchItems = (swatches: readonly string[]) => {
  const swatchOccurrences = new Map<string, number>()

  return swatches.map((swatch) => {
    const occurrenceCount = swatchOccurrences.get(swatch) ?? 0
    swatchOccurrences.set(swatch, occurrenceCount + 1)

    return {
      key: `${swatch}-${occurrenceCount}`,
      value: swatch
    }
  })
}

const ColorSchemaSwatchRow = ({
  swatches
}: {
  swatches: readonly string[]
}) => (
  <div className="flex min-w-0 items-center gap-1.5">
    {buildSwatchItems(swatches).map((swatchItem) => (
      <span
        className="size-3 rounded-full border border-black/10"
        key={swatchItem.key}
        style={{ backgroundColor: swatchItem.value }}
      />
    ))}
  </div>
)

const ColorSchemaPairButton = ({
  isActive,
  onChange,
  option
}: ColorSchemaPairButtonProps) => {
  const handleClick = useCallback(() => {
    onChange(option)
  }, [onChange, option])

  return (
    <button
      aria-pressed={isActive}
      className={[
        "flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        isActive
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      ].join(" ")}
      onClick={handleClick}
      type="button"
    >
      <span className="text-sm font-medium text-foreground">
        {option.label}
      </span>

      <div className="grid w-full grid-cols-2 gap-3">
        <ColorSchemaSwatchRow swatches={option.lightSwatches} />
        <ColorSchemaSwatchRow swatches={option.darkSwatches} />
      </div>
    </button>
  )
}

const ColorSchemaPairSelector = ({
  darkColorSchema,
  lightColorSchema,
  onChange,
  options
}: {
  darkColorSchema: DarkColorSchema
  lightColorSchema: LightColorSchema
  onChange: (value: ColorSchemaPairOption) => void
  options: ColorSchemaPairOption[]
}) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {options.map((option) => (
      <ColorSchemaPairButton
        isActive={
          darkColorSchema === option.darkColorSchema &&
          lightColorSchema === option.lightColorSchema
        }
        key={option.id}
        onChange={onChange}
        option={option}
      />
    ))}
  </div>
)

export const ColorSchemaTab = ({
  darkColorSchema,
  darkColorSchemaOptions,
  heroUiProColorSchemaPairOptions,
  lightColorSchema,
  lightColorSchemaOptions,
  onColorSchemaPairChange,
  onCreateTheme,
  onDarkColorSchemaChange,
  onDeleteTheme,
  onLightColorSchemaChange,
  themes
}: ColorSchemaTabProps) => {
  const { t } = useI18n()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [themePendingDelete, setThemePendingDelete] =
    useState<CustomTheme | null>(null)

  const handleCreateDialogOpen = useCallback(() => {
    setIsCreateDialogOpen(true)
  }, [])

  const handleColorSchemaPairChange = useCallback(
    (option: ColorSchemaPairOption) => {
      onColorSchemaPairChange({
        darkColorSchema: option.darkColorSchema,
        lightColorSchema: option.lightColorSchema
      })
    },
    [onColorSchemaPairChange]
  )

  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setThemePendingDelete(null)
    }
  }, [])

  const handleDeleteConfirm = useCallback(() => {
    if (themePendingDelete) {
      onDeleteTheme(themePendingDelete.id)
      setThemePendingDelete(null)
    }
  }, [onDeleteTheme, themePendingDelete])

  return (
    <>
      <div className="space-y-8">
        <motion.section
          {...settingsPageSectionMotion(0.15)}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={PaintBrush01Icon} size={18} />
                    <h2 className="text-lg font-semibold">
                      {t("settings.customThemes.title")}
                    </h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.customThemes.description")}
                  </p>
                </div>
              </div>
            </div>

            <Button
              className="self-start"
              onPress={handleCreateDialogOpen}
              type="button"
            >
              <HugeiconsIcon icon={PlusSignIcon} />
              {t("settings.customThemes.actions.create")}
            </Button>
          </div>

          <div className="mt-6">
            {themes.length === 0 ? (
              <Empty className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 text-center">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={PaintBrush01Icon} />
                  </EmptyMedia>
                  <EmptyTitle className="text-accent">
                    {t("settings.customThemes.empty.title")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("settings.customThemes.empty.description")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="space-y-4">
                {themes.map((theme) => (
                  <CustomThemeCard
                    key={theme.id}
                    onDeleteTheme={setThemePendingDelete}
                    theme={theme}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.section>

        <motion.section {...settingsPageSectionMotion(0.2)}>
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">
                {t("settings.colorScheme.proPresets.label")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings.colorScheme.proPresets.description")}
              </p>
            </div>

            <ColorSchemaPairSelector
              darkColorSchema={darkColorSchema}
              lightColorSchema={lightColorSchema}
              onChange={handleColorSchemaPairChange}
              options={heroUiProColorSchemaPairOptions}
            />
          </div>
        </motion.section>

        <motion.section {...settingsPageSectionMotion(0.25)}>
          <ColorSchemaBlock
            description={t("settings.colorScheme.dark.description")}
            label={t("settings.colorScheme.dark.label")}
            onChange={onDarkColorSchemaChange}
            options={darkColorSchemaOptions}
            value={darkColorSchema}
          />
        </motion.section>

        <motion.section {...settingsPageSectionMotion(0.35)}>
          <ColorSchemaBlock
            description={t("settings.colorScheme.light.description")}
            label={t("settings.colorScheme.light.label")}
            onChange={onLightColorSchemaChange}
            options={lightColorSchemaOptions}
            value={lightColorSchema}
          />
        </motion.section>
      </div>

      <CreateCustomThemeDialog
        existingThemes={themes}
        onCreateTheme={onCreateTheme}
        onOpenChange={setIsCreateDialogOpen}
        open={isCreateDialogOpen}
      />

      <DeleteCustomThemeDialog
        onConfirm={handleDeleteConfirm}
        onOpenChange={handleDeleteDialogOpenChange}
        open={themePendingDelete !== null}
        theme={themePendingDelete}
      />
    </>
  )
}
