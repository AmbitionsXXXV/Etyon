import { Hono } from "hono"
import { cors } from "hono/cors"

import { chatRoute } from "@/main/server/routes/chat"

const app = new Hono()

app.use(cors({ origin: "http://localhost:*" }))

app.get("/health", (c) => c.json({ ok: true }))
app.route("/api", chatRoute)

export { app }
