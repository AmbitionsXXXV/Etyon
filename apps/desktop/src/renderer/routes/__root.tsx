import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from "@etyon/ui/components/sidebar"
import { TooltipProvider } from "@etyon/ui/components/tooltip"
import { cn } from "@etyon/ui/lib/utils"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools"
import { useHotkey } from "@tanstack/react-hotkeys"
import { HotkeysDevtoolsPanel } from "@tanstack/react-hotkeys-devtools"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

import { AppSidebar } from "../components/app-sidebar"
import { TITLE_BAR_HEIGHT, TitleBar } from "../components/title-bar"

const TRAFFIC_LIGHT_CLEARANCE = "pl-[76px]"

const InsetHeader = () => {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <header
      className={cn(
        "title-bar-drag flex h-10 shrink-0 pt-3.5 items-center gap-2 px-4 transition-[padding] duration-200 ease-linear",
        collapsed && TRAFFIC_LIGHT_CLEARANCE
      )}
    >
      <SidebarTrigger className="title-bar-no-drag" />
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
