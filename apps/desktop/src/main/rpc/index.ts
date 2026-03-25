import { onError } from "@orpc/server"
import { RPCHandler as FetchRPCHandler } from "@orpc/server/fetch"
import { RPCHandler as MessagePortRPCHandler } from "@orpc/server/message-port"
import { ipcMain } from "electron"

import { initLogger, logger } from "@/main/logger"
import type { AppRpcContext } from "@/main/rpc/context"
import {
  createHttpRpcContext,
  createMessagePortRpcContext,
  RPC_HTTP_PREFIX
} from "@/main/rpc/context"

import { router } from "./router"

export type { AppRouter } from "./router"
export type { AppRpcContext } from "./context"
export {
  createHttpRpcContext,
  createMessagePortRpcContext,
  RPC_HTTP_PREFIX
} from "./context"

const logRpcError = (error: unknown) => {
  logger.error("orpc_handler_failed", { error })
}

const fetchHandler = new FetchRPCHandler(router, {
  interceptors: [onError(logRpcError)]
})

const messagePortHandler = new MessagePortRPCHandler(router, {
  interceptors: [onError(logRpcError)]
})

export const handleHttpRpcRequest = (
  request: Request,
  context: AppRpcContext
) => fetchHandler.handle(request, { context, prefix: RPC_HTTP_PREFIX })

export const registerRpcHandler = () => {
  initLogger()

  ipcMain.on("start-orpc-server", (event) => {
    const [serverPort] = event.ports
    messagePortHandler.upgrade(serverPort, {
      context: createMessagePortRpcContext()
    })
    serverPort.start()
  })
}
