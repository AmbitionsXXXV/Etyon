import { useI18n } from "@etyon/i18n/react"
import type { CustomTheme, DarkColorSchema, LightColorSchema } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@etyon/ui/components/empty"
import { PaintBrush01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useCallback, useState } from "react"

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
  lightColorSchema: LightColorSchema
  lightColorSchemaOptions: ColorSchemaOption<LightColorSchema>[]
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

export const ColorSchemaTab = ({
  darkColorSchema,
  darkColorSchemaOptions,
  lightColorSchema,
  lightColorSchemaOptions,
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
              onClick={handleCreateDialogOpen}
              type="button"
            >
              <HugeiconsIcon icon={PlusSignIcon} />
              {t("settings.customThemes.actions.create")}
            </Button>
          </div>

          <div className="mt-6">
            {themes.length === 0 ? (
              <Empty className="min-h-56 rounded-2xl border border-dashed border-border bg-background/40">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={PaintBrush01Icon} />
                  </EmptyMedia>
                  <EmptyTitle>
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
