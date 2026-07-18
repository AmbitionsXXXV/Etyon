import { useI18n } from "@etyon/i18n/react"
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
import { Button } from "@heroui/react"
import { NoteEditIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools"
import { useHotkey } from "@tanstack/react-hotkeys"
import { HotkeysDevtoolsPanel } from "@tanstack/react-hotkeys-devtools"
import { PacerDevtoolsPanel } from "@tanstack/react-pacer-devtools"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { AnimatePresence, motion } from "motion/react"
import type { ComponentProps } from "react"

import { AppSidebar } from "@/renderer/components/app-sidebar"
import { TITLE_BAR_HEIGHT, TitleBar } from "@/renderer/components/title-bar"
import { useChatSessionActions } from "@/renderer/lib/sidebar/use-chat-session-actions"
import { useProjectSidebarState } from "@/renderer/lib/sidebar/use-project-sidebar-state"

const TRAFFIC_LIGHT_CLEARANCE = "pl-[76px]"
type TanStackDevtoolsPlugin = NonNullable<
  ComponentProps<typeof TanStackDevtools>["plugins"]
>[number]

const renderHotkeysDevtoolsPanel: TanStackDevtoolsPlugin["render"] = (
  _element,
  props
) => <HotkeysDevtoolsPanel {...props} />

const renderPacerDevtoolsPanel: TanStackDevtoolsPlugin["render"] = (
  _element,
  props
) => <PacerDevtoolsPanel {...props} />

const InsetHeader = () => {
  const { state } = useSidebar()
  const { t } = useI18n({ keyPrefix: "home" })
  const { handleCreateChatSession, isCreatingChatSession } =
    useChatSessionActions()
  const collapsed = state === "collapsed"

  const searchButton = (
    <Button
      aria-label={t("sidebar.search")}
      isIconOnly
      size="lg"
      variant="ghost"
    >
      <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
    </Button>
  )

  const newChatButton = (
    <Button
      aria-label={t("actions.newChat")}
      isDisabled={isCreatingChatSession}
      isIconOnly
      onPress={handleCreateChatSession}
      size="lg"
      variant="ghost"
    >
      <HugeiconsIcon icon={NoteEditIcon} strokeWidth={2} />
    </Button>
  )

  return (
    <header
      className={cn(
        "pointer-events-none absolute top-0 right-0 left-0 z-30 flex h-10 items-center gap-2 px-4 pt-3.5 transition-[padding] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
        collapsed && TRAFFIC_LIGHT_CLEARANCE
      )}
    >
      <div className="title-bar-drag pointer-events-auto absolute inset-x-0 top-0 h-4" />
      <AnimatePresence>
        {collapsed && (
          <motion.div
            className="title-bar-no-drag pointer-events-auto flex items-center gap-0.5"
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

            {isCreatingChatSession ? (
              newChatButton
            ) : (
              <Tooltip>
                <TooltipTrigger render={newChatButton} />
                <TooltipContent side="bottom">
                  {t("actions.newChat")}
                </TooltipContent>
              </Tooltip>
            )}
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
  const { sidebarWidthPx } = useProjectSidebarState()
  const isAppShellRoute =
    pathname === "/" ||
    pathname.startsWith("/agents/") ||
    pathname.startsWith("/chat/")

  useHotkey("Mod+,", () => {
    window.electron.ipcRenderer.send("open-settings")
  })

  return (
    <TooltipProvider>
      {isAppShellRoute ? (
        <SidebarProvider
          style={
            {
              "--sidebar-width": `${sidebarWidthPx}px`
            } as React.CSSProperties
          }
        >
          <div data-first-light-region="">
            <AppSidebar />
          </div>

          <SidebarInset
            className="relative min-h-0 overflow-hidden"
            data-first-light-region=""
          >
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
            render: renderHotkeysDevtoolsPanel
          },
          {
            name: "TanStack Form",
            render: <FormDevtoolsPanel />
          },
          {
            name: "TanStack Pacer",
            render: renderPacerDevtoolsPanel
          }
        ]}
      />
    </TooltipProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent
})
