import type { QueryClient } from "@tanstack/react-query"
import { createHashHistory, createRouter } from "@tanstack/react-router"

import { routeTree } from "./routeTree.gen"

export interface RouterContext {
  queryClient: QueryClient
}

// The packaged renderer loads over `file://`, where the pathname is the app's
// filesystem path (…/index.html) and matches no route — a browser history would
// render NotFound. Hash history keeps the active route in the URL hash, so it
// resolves the same in dev (http) and in the packaged app (file://).
export const router = createRouter({
  defaultPreload: "intent",
  history: createHashHistory(),
  routeTree,
  scrollRestoration: true
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
