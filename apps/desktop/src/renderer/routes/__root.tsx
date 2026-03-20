import { TanStackDevtools } from "@tanstack/react-devtools"
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools"
import { useHotkey } from "@tanstack/react-hotkeys"
import { HotkeysDevtoolsPanel } from "@tanstack/react-hotkeys-devtools"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

import { TITLE_BAR_HEIGHT, TitleBar } from "../components/title-bar"

const RootComponent = () => {
  useHotkey("Mod+,", () => {
    window.electron.ipcRenderer.send("open-settings")
  })

  return (
    <>
      <TitleBar />

      <div style={{ paddingTop: TITLE_BAR_HEIGHT }}>
        <Outlet />
      </div>

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
    </>
  )
}

export const Route = createRootRoute({
  component: RootComponent
})
