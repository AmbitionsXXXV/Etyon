import { once } from "node:events"
import type { Server } from "node:http"

export const listenHttpServer = async (server: Server): Promise<number> => {
  const listening = once(server, "listening")
  server.listen(0, "127.0.0.1")
  await listening
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Expected server port")
  }
  return address.port
}

export const closeHttpServer = async (server: Server): Promise<void> => {
  if (!server.listening) {
    return
  }
  const closed = once(server, "close")
  server.close()
  await closed
}
