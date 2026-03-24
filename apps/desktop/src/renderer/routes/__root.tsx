import { useI18n } from "@etyon/i18n/react"
import { Button } from "@etyon/ui/components/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from "@etyon/ui/components/sidebar"
import { Toaster } from "@etyon/ui/components/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@etyon/ui/components/tooltip"
import { cn } from "@etyon/ui/lib/utils"
import { NoteEditIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools"
import { useHotkey } from "@tanstack/react-hotkeys"
import { HotkeysDevtoolsPanel } from "@tanstack/react-hotkeys-devtools"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { AnimatePresence, motion } from "motion/react"

import { AppSidebar } from "@/renderer/components/app-sidebar"
import { TITLE_BAR_HEIGHT, TitleBar } from "@/renderer/components/title-bar"

const TRAFFIC_LIGHT_CLEARANCE = "pl-[76px]"

const InsetHeader = () => {
  const { state } = useSidebar()
  const { t } = useI18n({ keyPrefix: "home" })
  const collapsed = state === "collapsed"

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
    <header
      className={cn(
        "title-bar-drag flex h-10 shrink-0 pt-3.5 items-center gap-2 px-4 transition-[padding] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
        collapsed && TRAFFIC_LIGHT_CLEARANCE
      )}
    >
      <AnimatePresence>
        {collapsed && (
          <motion.div
            className="title-bar-no-drag flex items-center gap-0.5"
            initial={{ opacity: 0, x: 180 }}
            animate={{
              opacity: 1,
              transition: {
                duration: 0.35,
                ease: [0.25, 1, 0.5, 1]
              },
              x: 0
            }}
            exit={{
              opacity: 0,
              transition: { duration: 0.2, ease: [0.25, 1, 0.5, 1] },
              x: 180
            }}
          >
            <SidebarTrigger aria-label={t("sidebar.toggleSidebar")} />

            <Tooltip>
              <TooltipTrigger render={searchButton} />
              <TooltipContent side="bottom">
                {t("sidebar.search")}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger render={newChatButton} />
              <TooltipContent side="bottom">
                {t("actions.newChat")}
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

const RootComponent = () => {
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  })
  const isHomeRoute = pathname === "/"

  useHotkey("Mod+,", () => {
    window.electron.ipcRenderer.send("open-settings")
  })

  return (
    <TooltipProvider>
      {isHomeRoute ? (
        <SidebarProvider>
          <AppSidebar />

          <SidebarInset>
            <InsetHeader />

            <div className="flex min-h-0 flex-1 flex-col">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      ) : (
        <>
          <TitleBar />

          <div style={{ paddingTop: TITLE_BAR_HEIGHT }}>
            <Outlet />
          </div>

          <Toaster />
        </>
      )}

      <TanStackDevtools
        plugins={[
          {
            name: "TanStack Query",
            render: <ReactQueryDevtoolsPanel />
          },
          {
            name: "TanStack Router",
            render: <TanStackRouterDevtoolsPanel />
          },
          {
            name: "TanStack Hotkeys",
            render: <HotkeysDevtoolsPanel />
          },
          {
            name: "TanStack Form",
            render: <FormDevtoolsPanel />
          }
        ]}
      />
    </TooltipProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent
})
