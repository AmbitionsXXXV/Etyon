import type { ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { convertToModelMessages, streamText } from "ai"
import { Hono } from "hono"

import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { buildMentionContext } from "@/main/project-snapshot"
import { resolveModel } from "@/main/server/lib/providers"

const chatRoute = new Hono()

chatRoute.post("/chat", async (c) => {
  const body = await c.req.json()
  const {
    mentions = [],
    messages,
    model: requestedModelId,
    sessionId
  } = body as {
    mentions?: ChatMention[]
    messages: UIMessage[]
    model?: string
    sessionId: string
  }
  const session = await getChatSessionById(getDb(), sessionId)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const { system } = buildMentionContext({
    mentions,
    projectPath: session.projectPath
  })
  const model = resolveModel(requestedModelId ?? session.modelId ?? undefined)
  const modelMessages = await convertToModelMessages(messages)
  const result = streamText({
    ...(system ? { system } : {}),
    messages: modelMessages,
    model
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages
  })
})

export { chatRoute }
