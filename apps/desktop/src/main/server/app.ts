import { Hono } from "hono"
import { cors } from "hono/cors"

import { isAuthorizedLocalRequest } from "@/main/local-connection"
import { handleHttpRpcRequest } from "@/main/rpc"
import { createHttpRpcContext } from "@/main/rpc/context"
import type { AppServerEnv } from "@/main/server/lib/request-logger"
import { requestLogger } from "@/main/server/lib/request-logger"
import { chatRoute } from "@/main/server/routes/chat"

const app = new Hono<AppServerEnv>()

app.use(requestLogger)
app.use(cors({ origin: "http://localhost:*" }))

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
