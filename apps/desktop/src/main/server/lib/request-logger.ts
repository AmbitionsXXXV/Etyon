import { randomUUID } from "node:crypto"

import type { MiddlewareHandler } from "hono"

import { logger } from "@/main/logger"

export interface AppServerEnv {
  Variables: {
    requestId: string
  }
}

const buildRequestLogLevel = (statusCode: number): "critical" | "info" =>
  statusCode >= 500 ? "critical" : "info"

const resolveEndpointKind = (path: string): "http" | "rpc" =>
  path.startsWith("/rpc") ? "rpc" : "http"

const buildUnknownErrorFields = (
  error: unknown
): Record<string, string | undefined> => {
  if (error instanceof Error) {
    return {
      error_message: error.message,
      error_name: error.name,
      error_stack: error.stack
    }
  }

  return {
    error_message: String(error),
    error_name: "UnknownError",
    error_stack: undefined
  }
}

export const requestLogger: MiddlewareHandler<AppServerEnv> = async (
  c,
  next
) => {
  const requestId = randomUUID()
  const requestLog = logger.startEvent("http_request", {
    endpoint_kind: resolveEndpointKind(c.req.path),
    host: c.req.header("host") ?? null,
    method: c.req.method,
    path: c.req.path,
    request_id: requestId
  })
  const origin = c.req.header("origin")
  const userAgent = c.req.header("user-agent")
  let statusCode = 500

  c.header("x-request-id", requestId)
  c.set("requestId", requestId)

  if (origin) {
    requestLog.set("origin", origin)
  }

  if (userAgent) {
    requestLog.set("user_agent", userAgent)
  }

  try {
    await next()
    statusCode = c.res.status
  } catch (error) {
    requestLog.merge(buildUnknownErrorFields(error))
    throw error
  } finally {
    requestLog.merge({
      outcome: statusCode >= 400 ? "error" : "success",
      status_code: statusCode
    })
    requestLog.end(buildRequestLogLevel(statusCode))
  }
}
