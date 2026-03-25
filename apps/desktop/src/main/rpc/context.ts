import type { LoggerApi } from "@etyon/logger/core"
import { os } from "@orpc/server"

import type { AppDatabase } from "@/main/db"
import { getDb } from "@/main/db"
import { logger } from "@/main/logger"

export type RpcTransport = "http" | "message-port"

export interface AppRpcContext {
  db: AppDatabase
  headers?: Headers
  logger: LoggerApi
  requestId?: string
  transport: RpcTransport
}

export const RPC_HTTP_PREFIX = "/rpc" as const

export const rpc = os.$context<AppRpcContext>()

const buildBaseRpcContext = (
  transport: RpcTransport
): Omit<AppRpcContext, "headers" | "requestId"> => ({
  db: getDb(),
  logger,
  transport
})

export const createHttpRpcContext = (options: {
  headers: Headers
  requestId?: string
}): AppRpcContext => ({
  ...buildBaseRpcContext("http"),
  headers: options.headers,
  requestId: options.requestId
})

export const createMessagePortRpcContext = (): AppRpcContext =>
  buildBaseRpcContext("message-port")
