import { useI18n } from "@etyon/i18n/react"
import type { CustomTheme } from "@etyon/rpc"
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
import { useCallback, useState } from "react"

import { CreateCustomThemeDialog } from "./components/create-theme-dialog"
import { DeleteCustomThemeDialog } from "./components/delete-theme-dialog"
import { CustomThemeCard } from "./components/theme-card"

export const CustomThemesTab = ({
  onCreateTheme,
  onDeleteTheme,
  themes
}: {
  onCreateTheme: (theme: CustomTheme) => void
  onDeleteTheme: (themeId: string) => void
  themes: CustomTheme[]
}) => {
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
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full border border-border bg-muted/60">
                <HugeiconsIcon icon={PaintBrush01Icon} size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold">
                  {t("settings.customThemes.title")}
                </h2>
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
