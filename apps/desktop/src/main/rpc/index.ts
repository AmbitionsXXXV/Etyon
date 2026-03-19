import { onError } from "@orpc/server"
import { RPCHandler } from "@orpc/server/message-port"
import { ipcMain } from "electron"

import { initLogger } from "../logger"
import { router } from "./router"

export type { AppRouter } from "./router"

const logRpcError = (error: unknown) => {
  console.error("[oRPC]", error)
}

const handler = new RPCHandler(router, {
  interceptors: [onError(logRpcError)]
})

export const registerRpcHandler = () => {
  initLogger()

  ipcMain.on("start-orpc-server", (event) => {
    const [serverPort] = event.ports
    handler.upgrade(serverPort)
    serverPort.start()
  })
}
