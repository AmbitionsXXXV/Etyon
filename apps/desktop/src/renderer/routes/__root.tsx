import { TooltipProvider } from "@etyon/ui/components/tooltip"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools"
import { useHotkey } from "@tanstack/react-hotkeys"
import { HotkeysDevtoolsPanel } from "@tanstack/react-hotkeys-devtools"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

import { TITLE_BAR_HEIGHT, TitleBar } from "../components/title-bar"

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
        <div className="box-border flex h-svh min-h-0 flex-col">
          <Outlet />
        </div>
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
