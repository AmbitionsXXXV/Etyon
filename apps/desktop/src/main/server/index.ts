import { once } from "node:events"
import type { AddressInfo } from "node:net"

import type { ServerType } from "@hono/node-server"
import { serve } from "@hono/node-server"

import { logger } from "@/main/logger"
import { app } from "@/main/server/app"
import { getServerUrl, setServerUrl } from "@/main/server/server-url"

let server: ServerType | undefined
export { getServerUrl } from "@/main/server/server-url"

export const startServer = async (): Promise<string> => {
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  await once(server, "listening")
  const address = server.address() as AddressInfo
  const serverUrl = `http://127.0.0.1:${address.port}`
  setServerUrl(serverUrl)
  logger.info("local_server_started", {
    host: "127.0.0.1",
    port: address.port,
    server_url: serverUrl
  })
  return serverUrl
}

export const stopServer = (): void => {
  if (!server) {
    return
  }

  const previousServerUrl = getServerUrl()

  server.close()
  server = undefined
  setServerUrl("")
  logger.info("local_server_stopped", { server_url: previousServerUrl })
}
