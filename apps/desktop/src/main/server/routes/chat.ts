import type { UIMessage } from "ai"
import { convertToModelMessages, streamText } from "ai"
import { Hono } from "hono"

import { resolveModel } from "@/main/server/lib/providers"

const chatRoute = new Hono()

chatRoute.post("/chat", async (c) => {
  const body = await c.req.json()
  const { messages, model: modelId } = body as {
    messages: UIMessage[]
    model?: string
  }

  const model = resolveModel(modelId)
  const modelMessages = await convertToModelMessages(messages)
  const result = streamText({ messages: modelMessages, model })

  return result.toUIMessageStreamResponse()
})

export { chatRoute }
