import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger
} from "@etyon/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@etyon/ui/components/tooltip"
import { NoteEditIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

export const AppSidebar = () => {
  const { t } = useI18n({ keyPrefix: "home" })

  const searchButton = (
    <Button aria-label={t("sidebar.search")} size="icon-lg" variant="ghost">
      <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
    </Button>
  )

  const newChatButton = (
    <Button aria-label={t("actions.newChat")} size="icon-lg" variant="ghost">
      <HugeiconsIcon icon={NoteEditIcon} strokeWidth={2} />
    </Button>
  )

  return (
    <Sidebar collapsible="offcanvas" side="left">
      <SidebarHeader className="title-bar-drag ml-auto pt-1.5">
        <div className="title-bar-no-drag flex items-center gap-0.5 pl-[72px]">
          <SidebarTrigger aria-label={t("sidebar.toggleSidebar")} />

          <Tooltip>
            <TooltipTrigger render={searchButton} />
            <TooltipContent side="bottom">{t("sidebar.search")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger render={newChatButton} />
            <TooltipContent side="bottom">
              {t("actions.newChat")}
            </TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>

      <SidebarContent />

      <SidebarFooter />
    </Sidebar>
  )
}
