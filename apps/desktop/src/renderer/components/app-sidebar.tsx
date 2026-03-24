import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarTrigger
} from "@etyon/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@etyon/ui/components/tooltip"
import { cn } from "@etyon/ui/lib/utils"
import { NoteEditIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"

interface AppSidebarShellProps {
  children?: ReactNode
  contentClassName?: string
  headerClassName?: string
  headerContent: ReactNode
}

export const AppSidebarShell = ({
  children,
  contentClassName,
  headerClassName,
  headerContent
}: AppSidebarShellProps) => (
  <Sidebar collapsible="offcanvas" side="left">
    <SidebarHeader
      className={cn("title-bar-drag ml-auto pt-1", headerClassName)}
    >
      <div className="title-bar-no-drag flex items-center gap-0.5">
        {headerContent}
      </div>
    </SidebarHeader>

    <SidebarContent className={cn("title-bar-drag", contentClassName)}>
      {children}
    </SidebarContent>
  </Sidebar>
)

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
    <AppSidebarShell
      headerContent={
        <>
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
        </>
      }
    />
  )
}
