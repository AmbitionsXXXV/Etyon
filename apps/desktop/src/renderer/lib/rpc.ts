import type { AppRouter } from "@main/rpc/router"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/message-port"
import type { RouterClient } from "@orpc/server"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"

const { port1: clientPort, port2: serverPort } = new MessageChannel()
window.postMessage("start-orpc-client", "*", [serverPort])

const link = new RPCLink({ port: clientPort })
clientPort.start()

export const rpcClient: RouterClient<AppRouter> = createORPCClient(link)

export const orpc = createTanstackQueryUtils(rpcClient)
