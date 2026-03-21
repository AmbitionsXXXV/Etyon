import { once } from "node:events"
import type { AddressInfo } from "node:net"

import type { ServerType } from "@hono/node-server"
import { serve } from "@hono/node-server"

import { app } from "./app"

let server: ServerType | undefined
let serverUrl = ""

export const getServerUrl = (): string => serverUrl

export const startServer = async (): Promise<string> => {
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  await once(server, "listening")
  const address = server.address() as AddressInfo
  serverUrl = `http://127.0.0.1:${address.port}`
  console.log(`[Hono] Local server started at ${serverUrl}`)
  return serverUrl
}

export const stopServer = (): void => {
  if (!server) {
    return
  }
  server.close()
  server = undefined
  serverUrl = ""
  console.log("[Hono] Local server stopped")
}
