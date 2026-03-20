import { useI18n } from "@etyon/i18n/react"
import type { CustomTheme } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@etyon/ui/components/dialog"
import { useCallback } from "react"

export const DeleteCustomThemeDialog = ({
  onConfirm,
  onOpenChange,
  open,
  theme
}: {
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  theme: CustomTheme | null
}) => {
  const { t } = useI18n()

  const handleCancel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("settings.customThemes.delete.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.customThemes.delete.description", {
              name: theme?.name ?? ""
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleCancel} type="button" variant="outline">
            {t("settings.common.cancel")}
          </Button>
          <Button onClick={onConfirm} type="button" variant="destructive">
            {t("settings.customThemes.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
