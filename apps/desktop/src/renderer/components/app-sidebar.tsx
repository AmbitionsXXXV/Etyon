import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarTrigger,
  useSidebar
} from "@etyon/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@etyon/ui/components/tooltip"
import { cn } from "@etyon/ui/lib/utils"
import { NoteEditIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

const EXPAND_EASE = [0.25, 1, 0.5, 1] as const
const EXPAND_RESET_DELAY_MS = 520

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
}: AppSidebarShellProps) => {
  const { state } = useSidebar()
  const expandResetTimeoutRef = useRef<number | null>(null)
  const prevStateRef = useRef(state)
  const [expanding, setExpanding] = useState(false)

  useEffect(() => {
    if (expandResetTimeoutRef.current !== null) {
      window.clearTimeout(expandResetTimeoutRef.current)
      expandResetTimeoutRef.current = null
    }

    if (prevStateRef.current === "collapsed" && state === "expanded") {
      setExpanding(true)
      expandResetTimeoutRef.current = window.setTimeout(() => {
        setExpanding(false)
        expandResetTimeoutRef.current = null
      }, EXPAND_RESET_DELAY_MS)
    }

    prevStateRef.current = state

    return () => {
      if (expandResetTimeoutRef.current !== null) {
        window.clearTimeout(expandResetTimeoutRef.current)
        expandResetTimeoutRef.current = null
      }
    }
  }, [state])

  const headerVariants = {
    collapsed: { opacity: 0 },
    expanded: {
      opacity: 1,
      transition: { delay: 0.08, duration: 0.35, ease: EXPAND_EASE }
    }
  }

  const contentVariants = {
    collapsed: { opacity: 0 },
    expanded: {
      opacity: 1,
      transition: { delay: 0.14, duration: 0.38, ease: EXPAND_EASE }
    }
  }

  return (
    <Sidebar collapsible="offcanvas" side="left">
      <SidebarHeader
        className={cn("title-bar-drag ml-auto pt-1", headerClassName)}
      >
        <motion.div
          animate={expanding ? "expanded" : undefined}
          className="title-bar-no-drag flex items-center gap-0.5"
          initial={false}
          variants={headerVariants}
        >
          {headerContent}
        </motion.div>
      </SidebarHeader>

      <SidebarContent className={cn("title-bar-drag", contentClassName)}>
        <motion.div
          animate={expanding ? "expanded" : undefined}
          className="flex min-h-0 flex-1 flex-col"
          initial={false}
          variants={contentVariants}
        >
          {children}
        </motion.div>
      </SidebarContent>
    </Sidebar>
  )
}

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
