import { Hono } from "hono"
import { cors } from "hono/cors"

import { isAuthorizedLocalRequest } from "@/main/local-connection"
import { handleHttpRpcRequest } from "@/main/rpc"
import { createHttpRpcContext } from "@/main/rpc/context"
import type { AppServerEnv } from "@/main/server/lib/request-logger"
import { requestLogger } from "@/main/server/lib/request-logger"
import { chatRoute } from "@/main/server/routes/chat"

const app = new Hono<AppServerEnv>()

const LOCAL_CORS_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"])
const isAllowedLocalCorsOrigin = (origin: string): boolean => {
  if (origin === "null") {
    return true
  }

  try {
    const url = new URL(origin)

    return url.protocol === "http:" && LOCAL_CORS_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}
const resolveLocalCorsOrigin = (origin: string): string | null =>
  isAllowedLocalCorsOrigin(origin) ? origin : null

app.use(requestLogger)
app.use(
  cors({
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: resolveLocalCorsOrigin
  })
)

const unauthorizedLocalRequest = (): Response =>
  Response.json({ error: "unauthorized" }, { status: 401 })

app.all("/rpc/*", async (c) => {
  if (!isAuthorizedLocalRequest(c.req.raw)) {
    return unauthorizedLocalRequest()
  }

  const requestId = c.get("requestId")
  const result = await handleHttpRpcRequest(
    c.req.raw,
    createHttpRpcContext({
      headers: c.req.raw.headers,
      requestId
    })
  )

  if (!result.matched) {
    return c.notFound()
  }

  const headers = new Headers(result.response.headers)
  headers.set("x-request-id", requestId)

  return new Response(result.response.body, {
    headers,
    status: result.response.status,
    statusText: result.response.statusText
  })
})

app.get("/health", (c) => c.json({ ok: true }))
app.use("/api/*", async (c, next) => {
  if (!isAuthorizedLocalRequest(c.req.raw)) {
    return unauthorizedLocalRequest()
  }

  await next()
})
app.route("/api", chatRoute)

export { app }
