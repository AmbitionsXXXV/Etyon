import { TanStackDevtools } from "@tanstack/react-devtools"
import { useHotkey } from "@tanstack/react-hotkeys"
import { hotkeysDevtoolsPlugin } from "@tanstack/react-hotkeys-devtools"
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
          hotkeysDevtoolsPlugin()
        ]}
      />
    </>
  )
}

export const Route = createRootRoute({
  component: RootComponent
})
